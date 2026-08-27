import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { loadAgentContext } from "../lib/core/context";
import { parseFactsRegister } from "../lib/core/facts";
import {
  computeOutputAcceptance,
  describeQualifiedSalesOutput,
  MINOR_EDIT_THRESHOLD,
} from "../lib/core/kpi";
import {
  buildOutreachPrompt,
  buildQaPrompt,
  ClaudeQaReviewer,
  DeterministicOutreachAgent,
  IneligibleOutreachProspectError,
  OUTREACH_QA_RULES,
  OUTREACH_VARIANTS,
  outreachVoiceGate,
  renderOutreachDraft,
  selectOutreachVariant,
  sourceEcho,
  type OutreachDraft,
} from "../lib/core/outreach";
import {
  OutreachNotApprovedError,
  prepareApprovedPrefill,
  reviewOutreachDraft,
  type OutreachDraftRepository,
  type SavedOutreachDraft,
} from "../lib/core/outreach-store";
import { normalizedEditDistance } from "../lib/core/research-store";
import type { Lead } from "../lib/core/types";
import { assertRegistrable } from "../lib/core/registry";
import { runWorkflow } from "../lib/core/workflow";
import { createDraftWorkflow } from "../lib/workflows/s3-draft";
import { MemoryRunStore } from "./run-helpers";

const context = await loadAgentContext();
const facts = parseFactsRegister(context.documents["FACTS.md"]);

class MemoryOutreachRepository implements OutreachDraftRepository {
  readonly saved: SavedOutreachDraft[] = [];
  readonly markedReady: string[] = [];

  async save(runId: string, draft: OutreachDraft): Promise<SavedOutreachDraft> {
    const record = { id: `draft-${this.saved.length + 1}`, runId, draft };
    this.saved.push(record);
    this.markedReady.push(draft.leadId);
    return record;
  }
}

function qualifiedLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "qualified-prospect",
    channel: "wyzant",
    author: "Prospect",
    subject: "SAT Reading",
    location: "Manhattan",
    text: "My daughter keeps running out of time on the reading section before the November test.",
    url: "https://www.wyzant.com/tutor/jobs/qualified-prospect",
    postedAt: "2026-08-27T12:00:00.000Z",
    raw: {
      grade: 11,
      qualification: {
        verdict: "icp_pass",
        rationale: "The request satisfies the written ICP screen.",
        evidence: [
          { ref: "ICP.md#wyzant-screen", observation: "Approved subject." },
        ],
        confidence: 0.94,
        contextHash: context.hash,
      },
    },
    ...overrides,
  };
}

async function draftFor(lead: Lead): Promise<OutreachDraft> {
  return new DeterministicOutreachAgent().create({
    lead,
    context,
    channel: "wyzant-inquiry-reply",
    tutorId: "tutor-admissions",
  });
}

describe("S3 draft agent v2", () => {
  it("keeps v1's variant names so the scoreboard still works", () => {
    expect([...OUTREACH_VARIANTS]).toEqual([
      "specific-first",
      "question-led",
      "plan-first",
    ]);
  });

  it("produces a lint-clean draft for every variant", async () => {
    const seen = new Set<string>();
    for (let index = 0; index < 24 && seen.size < 3; index += 1) {
      const lead = qualifiedLead({ id: `prospect-${index}` });
      const draft = await draftFor(lead);
      seen.add(draft.variant);
      const gate = outreachVoiceGate(draft, facts, [sourceEcho(lead, facts)]);
      expect(gate.issues, `${draft.variant}: ${gate.rendered}`).toEqual([]);
    }
    expect(seen.size).toBe(3);
  });

  it("picks the variant deterministically from the lead id", () => {
    expect(selectOutreachVariant("qualified-prospect")).toBe(
      selectOutreachVariant("qualified-prospect"),
    );
  });

  it("refuses a prospect that is not an icp_pass", async () => {
    await expect(
      draftFor(
        qualifiedLead({ raw: { qualification: { verdict: "icp_fail" } } }),
      ),
    ).rejects.toBeInstanceOf(IneligibleOutreachProspectError);
  });

  it("echoes the prospect's own words, and refuses to echo an unsafe one", () => {
    const safe = qualifiedLead();
    expect(sourceEcho(safe, facts)).toContain("running out of time");

    // A parent may write this without doing anything wrong. Quoting it would
    // put a promised outcome in Cole's mouth, so the echo falls back.
    const unsafe = qualifiedLead({
      text: "She will definitely get her score up before the deadline in autumn.",
    });
    expect(sourceEcho(unsafe, facts)).toBe("SAT Reading");
  });

  it("sends no temperature field, from either production agent", async () => {
    const source = await readFile(
      new URL("../lib/core/outreach.ts", import.meta.url),
      "utf8",
    );
    // The field, not the word. The file explains in prose why it is absent.
    expect(source).not.toMatch(/temperature\s*[:=]/i);
  });
});

describe("S3 model QA runs second and cannot agree with itself", () => {
  it("is shown the rendered draft and the register, and nothing the agent chose", async () => {
    const draft = await draftFor(qualifiedLead());
    const rendered = renderOutreachDraft(draft);
    const prompt = buildQaPrompt({
      renderedDraft: rendered,
      factsRegister: context.documents["FACTS.md"],
    });
    const whole = `${prompt.system}\n${prompt.user}`;

    expect(whole).toContain(rendered);
    expect(whole).toContain("F-005");
    // Nothing the drafting step decided about itself.
    expect(whole).not.toContain(draft.variant);
    expect(whole).not.toContain(draft.contextHash);
    for (const rule of OUTREACH_QA_RULES) expect(whole).toContain(rule);
  });

  it("fails the draft when the reviewer scores any rule at zero", async () => {
    const scores = OUTREACH_QA_RULES.map(() => 2);
    scores[6] = 0;
    const client = {
      messages: {
        create: vi.fn<
          (request: Record<string, unknown>) => Promise<{
            content: { type: string; text: string }[];
          }>
        >(async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({ scores, failures: ["superlatives"] }),
            },
          ],
        })),
      },
    };
    const verdict = await new ClaudeQaReviewer({ client }).review({
      renderedDraft: "a draft",
      factsRegister: "a register",
    });
    expect(verdict.passed).toBe(false);
    expect(client.messages.create.mock.calls[0][0]).not.toHaveProperty(
      "temperature",
    );
  });

  it("refuses a reviewer that scores a different number of rules", async () => {
    const client = {
      messages: {
        create: async () => ({
          content: [{ type: "text", text: '{"scores":[2,2],"failures":[]}' }],
        }),
      },
    };
    await expect(
      new ClaudeQaReviewer({ client }).review({
        renderedDraft: "a draft",
        factsRegister: "a register",
      }),
    ).rejects.toThrow(/2 scores for 16 rules/);
  });

  it("loads VOICE.md and FACTS.md into the drafting prompt", () => {
    const prompt = buildOutreachPrompt({
      lead: qualifiedLead(),
      context,
      variant: "specific-first",
      channel: "wyzant-inquiry-reply",
    });
    expect(prompt.system).toContain("# VOICE.md");
    expect(prompt.system).toContain("# FACTS.md");
  });
});

describe("S3 workflow", () => {
  async function run(overrides: Parameters<typeof createDraftWorkflow>[0]) {
    const store = new MemoryRunStore();
    const result = await runWorkflow(createDraftWorkflow(overrides), {
      store,
      trigger: "phase-5-test",
    });
    return { store, result };
  }

  it("satisfies the workflow contract, so KPI 1 can count it", () => {
    assertRegistrable(
      createDraftWorkflow({
        lead: qualifiedLead(),
        repository: new MemoryOutreachRepository(),
      }),
    );
  });

  it("is YELLOW, because it produces something that goes outside", () => {
    expect(
      createDraftWorkflow({
        lead: qualifiedLead(),
        repository: new MemoryOutreachRepository(),
      }).approvalLevel,
    ).toBe("YELLOW");
  });

  it("prepares, lints, reviews and saves one draft", async () => {
    const repository = new MemoryOutreachRepository();
    const qa = {
      review: vi.fn(async () => ({
        scores: OUTREACH_QA_RULES.map(() => 2),
        failures: [],
        passed: true,
      })),
    };
    const { store, result } = await run({
      lead: qualifiedLead(),
      repository,
      qa,
      loadContext: async () => context,
    });

    expect(result.status).toBe("succeeded");
    expect(repository.saved).toHaveLength(1);
    expect(qa.review).toHaveBeenCalledOnce();
    expect(store.stepsFor(result.runId).map((step) => step.step)).toEqual([
      "draft",
      "voice-lint",
      "model-qa",
      "save",
      "handoff",
    ]);
    expect(store.measurements).toEqual([
      {
        runId: result.runId,
        kpi: "s3.drafts_ready_for_review",
        value: 1,
        unit: "drafts",
      },
    ]);
  });

  it("saves nothing when the voice lint fails, and names the rule not the copy", async () => {
    const repository = new MemoryOutreachRepository();
    const { store, result } = await run({
      lead: qualifiedLead(),
      repository,
      loadContext: async () => context,
      agent: {
        async create() {
          const base = await draftFor(qualifiedLead());
          return {
            ...base,
            substance:
              "Cole is a Harvard graduate and I can guarantee her score will improve.",
          };
        },
      },
    });

    expect(result.status).toBe("failed");
    expect(repository.saved).toEqual([]);
    const messages = store.exceptions.map((item) => item.message).join("\n");
    expect(messages).toContain("blocked.harvard-oxford-credential");
    expect(messages).toContain("promise.outcome");
  });

  it("runs the lint before the model QA, so the model never judges a regex call", async () => {
    const repository = new MemoryOutreachRepository();
    const qa = { review: vi.fn() };
    const { result } = await run({
      lead: qualifiedLead(),
      repository,
      qa,
      loadContext: async () => context,
      agent: {
        async create() {
          const base = await draftFor(qualifiedLead());
          return { ...base, substance: "We offer a free consultation first." };
        },
      },
    });
    expect(result.status).toBe("failed");
    expect(qa.review).not.toHaveBeenCalled();
  });

  it("records the variant so reply rate by variant is computable later", async () => {
    const repository = new MemoryOutreachRepository();
    await run({
      lead: qualifiedLead(),
      repository,
      loadContext: async () => context,
    });
    expect(OUTREACH_VARIANTS).toContain(repository.saved[0].draft.variant);
  });

  it("marks the prospect as ready for approval, which is what KPI 5 counts", async () => {
    const repository = new MemoryOutreachRepository();
    await run({
      lead: qualifiedLead(),
      repository,
      loadContext: async () => context,
    });
    expect(repository.markedReady).toEqual(["qualified-prospect"]);
  });
});

describe("G1: prefill only, and only after a human approved", () => {
  it("refuses to open a compose box without an approval row", async () => {
    const store = new MemoryRunStore();
    const send = vi.fn();
    await expect(
      prepareApprovedPrefill(store, {
        runId: "run-1",
        lead: qualifiedLead(),
        adapter: { name: "wyzant", send },
        approvedMessage: "An approved reply.",
      }),
    ).rejects.toBeInstanceOf(OutreachNotApprovedError);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns a prefill and nothing else once a human approved", async () => {
    const store = new MemoryRunStore();
    store.approve("run-1", { artifactKind: "outreach-draft" });
    const result = await prepareApprovedPrefill(store, {
      runId: "run-1",
      lead: qualifiedLead(),
      adapter: {
        name: "wyzant",
        async send() {
          return { prefillUrl: "https://www.wyzant.com/tutor/jobs/x" };
        },
      },
      approvedMessage: "An approved reply.",
    });
    expect(result).toEqual({
      prefillUrl: "https://www.wyzant.com/tutor/jobs/x",
      approvedBy: "Athena Huo",
    });
  });

  it("has no auto-submit path anywhere in the phase, provable by grep", async () => {
    const files = ["outreach.ts", "outreach-store.ts", "voice.ts", "facts.ts"];
    for (const file of files) {
      const source = await readFile(
        new URL(`../lib/core/${file}`, import.meta.url),
        "utf8",
      );
      // Code shapes, not prose. outreach-store.ts states in a comment that
      // sent_by is never written here, and that sentence is the point.
      expect(source, file).not.toMatch(
        /\bautoSend\b|\bsubmit\s*\(|\bsentBy\s*[:=]|sent_by\s*[:=]/,
      );
      expect(source, file).not.toMatch(/\.(click|press|fill)\s*\(/);
    }
    const workflow = await readFile(
      new URL("../lib/workflows/s3-draft.ts", import.meta.url),
      "utf8",
    );
    expect(workflow).not.toMatch(/\bsend\s*\(/);
  });
});

describe("KPI 3 and KPI 5 from real rows", () => {
  it("stores an edit distance on every approval, by the frozen formula", async () => {
    const store = new MemoryRunStore();
    const draft = await draftFor(qualifiedLead());
    const rendered = renderOutreachDraft(draft);
    const edited = rendered.replace(
      "Thanks for the note",
      "Thanks for writing",
    );

    const distance = await reviewOutreachDraft(store, {
      runId: "run-1",
      draft,
      reviewedArtifact: edited,
      approvedBy: "Athena Huo",
      decision: "accept-with-edits",
      requiredNewResearch: false,
    });

    expect(distance).toBe(normalizedEditDistance(rendered, edited));
    expect(store.approvals[0]).toMatchObject({
      artifactKind: "outreach-draft",
      decision: "accept-with-edits",
      requiredNewResearch: false,
    });
    expect(store.approvals[0].editDistance).toBe(distance);
  });

  it("refuses a review with no named human reviewer", async () => {
    const store = new MemoryRunStore();
    await expect(
      reviewOutreachDraft(store, {
        runId: "run-1",
        draft: await draftFor(qualifiedLead()),
        reviewedArtifact: "anything",
        approvedBy: "   ",
        decision: "accept",
        requiredNewResearch: false,
      }),
    ).rejects.toThrow(/named human reviewer/);
  });

  it("computes KPI 3 from outreach approvals using the frozen definition", async () => {
    const store = new MemoryRunStore();
    const draft = await draftFor(qualifiedLead());
    const rendered = renderOutreachDraft(draft);

    await reviewOutreachDraft(store, {
      runId: "run-1",
      draft,
      reviewedArtifact: rendered,
      approvedBy: "Athena Huo",
      decision: "accept",
      requiredNewResearch: false,
    });
    await reviewOutreachDraft(store, {
      runId: "run-2",
      draft,
      reviewedArtifact: rendered,
      approvedBy: "Athena Huo",
      decision: "accept-with-edits",
      // A small diff that still sent the reviewer back to a source is a
      // rewrite. This row is what the second clause exists for.
      requiredNewResearch: true,
    });

    const acceptance = computeOutputAcceptance(
      store.approvals.map((approval) => ({
        editDistance: approval.editDistance,
        requiredNewResearch: approval.requiredNewResearch,
      })),
    );
    expect(acceptance).toEqual({ accepted: 1, reviewed: 2, rate: 0.5 });
  });

  it("leaves the minor-edit threshold exactly where BASELINES.md froze it", async () => {
    expect(MINOR_EDIT_THRESHOLD).toBe(0.2);
    const baselines = await readFile(
      new URL("../docs/BASELINES.md", import.meta.url),
      "utf8",
    );
    expect(baselines).toMatch(
      /normalized_distance\s*<\s*0\.20\s+AND\s+required_new_research\s*=\s*false/,
    );
    // Exactly the threshold is not a minor edit.
    expect(
      computeOutputAcceptance([
        { editDistance: 0.2, requiredNewResearch: false },
      ]).accepted,
    ).toBe(0);
  });

  it("reports KPI 5 and its leading indicator as separate numbers", () => {
    expect(describeQualifiedSalesOutput(4, 9)).toEqual({
      readyForApproval: 4,
      qualifiedNotYetPrepared: 9,
      verdictClauseImplemented: true,
    });
  });
});

describe("the Phase 5 table ships with row level security", () => {
  it("creates outreach_drafts and enables RLS in the same migration", async () => {
    const dir = new URL("../prisma/migrations/", import.meta.url);
    const entries = await readdir(dir, { withFileTypes: true });
    const sql = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) =>
            readFile(new URL(`${entry.name}/migration.sql`, dir), "utf8"),
          ),
      )
    ).join("\n");
    expect(sql).toMatch(/CREATE TABLE "outreach_drafts"/);
    expect(sql).toMatch(
      /ALTER TABLE public\.outreach_drafts ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(/outreach_drafts_disqualifier_not_blank/);
    expect(sql).toMatch(/outreach_drafts_ask_is_question/);
  });
});
