import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { loadAgentContext, type AgentContext } from "../lib/core/context";
import { computeOutputAcceptance } from "../lib/core/kpi";
import {
  citationGateIssues,
  DeterministicResearchAgent,
  publicSentenceHasMinorPersonalData,
  renderResearchBrief,
  selectIcpFact,
  scopePublicSources,
  type PublicSourcePage,
  type ResearchBrief,
  type ResearchSourceProvider,
} from "../lib/core/research";
import {
  normalizedEditDistance,
  PrismaResearchBriefRepository,
  reviewResearchBrief,
  type ResearchBriefRepository,
  type SavedResearchBrief,
} from "../lib/core/research-store";
import { PrismaRunStore, type ApprovalDecision } from "../lib/core/run-store";
import type { Lead } from "../lib/core/types";
import { runWorkflow } from "../lib/core/workflow";
import { createResearchWorkflow } from "../lib/workflows/s2-research";
import { MemoryRunStore } from "./run-helpers";

class MemoryResearchBriefRepository implements ResearchBriefRepository {
  readonly saved: SavedResearchBrief[] = [];

  async save(runId: string, brief: ResearchBrief): Promise<SavedResearchBrief> {
    const saved = { id: `brief-${this.saved.length + 1}`, runId, brief };
    this.saved.push(saved);
    return saved;
  }
}

function qualifiedLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "qualified-prospect",
    channel: "wyzant",
    author: "Prospect",
    subject: "SAT Reading",
    text: "Grade 11 student wants a focused SAT Reading plan this fall.",
    url: "https://www.wyzant.com/tutor/jobs/qualified-prospect",
    postedAt: "2026-08-26T12:00:00.000Z",
    raw: {
      grade: 11,
      qualification: {
        verdict: "icp_pass",
        rationale: "The request satisfies the written ICP screen.",
        evidence: [
          {
            ref: "ICP.md#wyzant-screen",
            observation: "The approved subject, grade, and context matched.",
          },
        ],
        confidence: 0.96,
        contextHash: "fixture-context",
      },
    },
    ...overrides,
  };
}

function richPublicSources(): PublicSourcePage[] {
  return [
    {
      url: "https://program.example/reading-workshop",
      title: "Reading workshop",
      content:
        "The fall workshop emphasizes evidence-based reading strategies.",
      access: "public",
      acquisition: "direct-public-page",
    },
    {
      url: "https://library.example/test-prep",
      title: "Test preparation",
      content:
        "The public library offers a weekly test preparation study room.",
      access: "public",
      acquisition: "direct-public-page",
    },
    {
      url: "https://calendar.example/fall-schedule",
      title: "Fall schedule",
      content: "The published fall calendar lists study sessions on Saturdays.",
      access: "public",
      acquisition: "direct-public-page",
    },
  ];
}

function sourceProvider(
  pages: PublicSourcePage[],
  fetch = vi.fn(async () => pages),
): ResearchSourceProvider & { fetchPublicSources: typeof fetch } {
  return { fetchPublicSources: fetch };
}

async function readJsonFixture<T>(name: string): Promise<T> {
  return JSON.parse(
    await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as T;
}

async function makeValidBrief(context?: AgentContext): Promise<ResearchBrief> {
  const resolvedContext = context ?? (await loadAgentContext());
  return new DeterministicResearchAgent().create({
    lead: qualifiedLead(),
    context: resolvedContext,
    publicSources: richPublicSources(),
    exclusions: [],
  });
}

describe("Phase 4 S2 research workflow", () => {
  it("ships three hooks only when every factual claim has supporting recorded evidence", async () => {
    const store = new MemoryRunStore();
    store.approve("run-1", { artifactKind: "research-source-access" });
    const repository = new MemoryResearchBriefRepository();
    const result = await runWorkflow(
      createResearchWorkflow({
        lead: qualifiedLead(),
        sources: sourceProvider(richPublicSources()),
        repository,
      }),
      { store, trigger: "phase-4-complete-fixture" },
    );

    expect(result.status).toBe("succeeded");
    expect(result.handedOff).toBe(true);
    expect(repository.saved).toHaveLength(1);
    const brief = repository.saved[0].brief;
    expect(brief.hooks).toHaveLength(3);
    expect(brief.unknowns.length).toBeGreaterThan(0);
    expect(brief.whyFit.claims).toHaveLength(2);
    expect(
      brief.whyFit.claims.find((item) => item.id === "fit-icp")?.text,
    ).toBe(
      "The subject matches one of the four approved subjects above, and no part of the request falls in the out-of-scope list.",
    );
    expect(brief.disqualifier.basis.text).toContain("Fit risk for SAT Reading");
    expect(brief.unknowns.map((item) => item.text)).not.toContain(
      brief.disqualifier.basis.text,
    );
    expect(citationGateIssues(brief)).toEqual([]);
    expect(renderResearchBrief(brief)).toContain(
      "https://program.example/reading-workshop",
    );
    expect(store.measurements).toContainEqual(
      expect.objectContaining({
        kpi: "s2.briefs_ready_for_review",
        value: 1,
        unit: "briefs",
      }),
    );
  });

  it("refuses S2 public-source access without a human approval row", async () => {
    const store = new MemoryRunStore();
    const repository = new MemoryResearchBriefRepository();
    const fetch = vi.fn(async () => richPublicSources());
    const result = await runWorkflow(
      createResearchWorkflow({
        lead: qualifiedLead(),
        sources: sourceProvider(richPublicSources(), fetch),
        repository,
      }),
      { store, trigger: "yellow-bypass-probe" },
    );

    expect(result.status).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
    expect(repository.saved).toEqual([]);
    expect(store.exceptions).toContainEqual(
      expect.objectContaining({ kind: "ApprovalRequiredError" }),
    );
  });

  it("fails a deliberately uncited fixture and names the offending claim in exceptions", async () => {
    const store = new MemoryRunStore();
    store.approve("run-1", { artifactKind: "research-source-access" });
    const repository = new MemoryResearchBriefRepository();
    const uncited = await readJsonFixture<ResearchBrief>(
      "research-brief.uncited.json",
    );
    const result = await runWorkflow(
      createResearchWorkflow({
        lead: qualifiedLead(),
        sources: sourceProvider([]),
        repository,
        agent: {
          async create() {
            return uncited;
          },
        },
      }),
      { store, trigger: "deliberately-uncited-fixture" },
    );

    expect(result.status).toBe("failed");
    expect(result.failedSteps).toContain("citation-check-and-save");
    expect(repository.saved).toEqual([]);
    expect(store.exceptions).toContainEqual(
      expect.objectContaining({
        kind: "ResearchCitationGateFailed",
        message: expect.stringContaining("hook-deliberately-uncited"),
      }),
    );
  });

  it("rejects a citation that exists but does not support its claim", async () => {
    const uncited = await readJsonFixture<ResearchBrief>(
      "research-brief.uncited.json",
    );
    uncited.hooks[1].claim.evidenceIds = ["evidence-supported"];
    expect(citationGateIssues(uncited)).toContainEqual({
      claimId: "hook-deliberately-uncited",
      reason: "every citation must textually support the claim",
    });
  });

  it("rejects a claim that cites a source not recorded in evidence", async () => {
    const brief = await makeValidBrief();
    brief.hooks[0].claim.evidenceIds = ["evidence-not-recorded"];
    expect(citationGateIssues(brief)).toContainEqual({
      claimId: "hook-1",
      reason: "claim cites evidence not recorded in evidence[]",
    });
  });

  it("rejects an irrelevant extra citation even when another citation supports the claim", async () => {
    const brief = await makeValidBrief();
    brief.hooks[0].claim.evidenceIds.push(brief.hooks[1].claim.evidenceIds[0]);
    expect(citationGateIssues(brief)).toContainEqual({
      claimId: "hook-1",
      reason: "every citation must textually support the claim",
    });
  });

  it("rejects free prose injected into a hook angle alone", async () => {
    const trusted = await makeValidBrief();
    const tampered = structuredClone(trusted);
    const hook = tampered.hooks[0] as ResearchBrief["hooks"][0] & {
      angle: string;
    };
    hook.angle = "The mother is a Stanford admissions officer.";
    expect(citationGateIssues(tampered, trusted)).toContainEqual({
      claimId: "hook-1.angle",
      reason: "free-text hook angles are forbidden",
    });
    expect(renderResearchBrief(tampered)).not.toContain("Stanford");
  });

  it("rejects free prose injected into the why-fit label alone", async () => {
    const trusted = await makeValidBrief();
    const tampered = structuredClone(trusted) as ResearchBrief & {
      whyFit: ResearchBrief["whyFit"] & { label: string };
    };
    tampered.whyFit.label = "The family already paid a competitor.";
    expect(citationGateIssues(tampered, trusted)).toContainEqual({
      claimId: "brief.whyFit.label",
      reason: "free-text why-fit labels are forbidden",
    });
    expect(renderResearchBrief(tampered)).not.toContain("competitor");
  });

  it("rejects free prose injected into the disqualifier label alone", async () => {
    const trusted = await makeValidBrief();
    const tampered = structuredClone(trusted) as ResearchBrief & {
      disqualifier: ResearchBrief["disqualifier"] & { label: string };
    };
    tampered.disqualifier.label = "No real risk identified.";
    expect(citationGateIssues(tampered, trusted)).toContainEqual({
      claimId: "brief.disqualifier.label",
      reason: "free-text disqualifier labels are forbidden",
    });
    expect(renderResearchBrief(tampered)).not.toContain("No real risk");
  });

  it("does not save a swapped agent brief with fabrication in all three former prose fields", async () => {
    const tampered = structuredClone(await makeValidBrief());
    const hook = tampered.hooks[0] as ResearchBrief["hooks"][0] & {
      angle: string;
    };
    const whyFit = tampered.whyFit as ResearchBrief["whyFit"] & {
      label: string;
    };
    const disqualifier =
      tampered.disqualifier as ResearchBrief["disqualifier"] & {
        label: string;
      };
    hook.angle = "The mother is a Stanford admissions officer.";
    whyFit.label = "The family already paid a competitor.";
    disqualifier.label = "No real risk identified.";

    const store = new MemoryRunStore();
    store.approve("run-1", { artifactKind: "research-source-access" });
    const repository = new MemoryResearchBriefRepository();
    const result = await runWorkflow(
      createResearchWorkflow({
        lead: qualifiedLead(),
        sources: sourceProvider(richPublicSources()),
        repository,
        agent: {
          async create() {
            return tampered;
          },
        },
      }),
      { store, trigger: "free-prose-agent-swap-probe" },
    );

    expect(result.status).toBe("failed");
    expect(repository.saved).toEqual([]);
    const messages = store.exceptions.map((item) => item.message).join("\n");
    expect(messages).toContain("hook-1.angle");
    expect(messages).toContain("brief.whyFit.label");
    expect(messages).toContain("brief.disqualifier.label");
  });

  it("rejects a hook kind outside the closed vocabulary", async () => {
    const trusted = await makeValidBrief();
    const tampered = structuredClone(trusted);
    tampered.hooks[0].kind =
      "family-budget" as (typeof tampered.hooks)[0]["kind"];
    expect(citationGateIssues(tampered, trusted)).toContainEqual({
      claimId: "hook-1.kind",
      reason: "hook kind is outside the closed vocabulary",
    });
  });

  it("rejects a supported claim placed under the wrong hook role", async () => {
    const trusted = await makeValidBrief();
    const tampered = structuredClone(trusted);
    tampered.hooks[0].claim = structuredClone(trusted.hooks[1].claim);
    expect(citationGateIssues(tampered, trusted)).toContainEqual({
      claimId: "hook-1.claim",
      reason: "hook claim does not match the scoped evidence role",
    });
  });

  it("rejects an invented claim paired with self-authored matching evidence", async () => {
    const fabricated = await makeValidBrief();
    fabricated.evidence.push({
      id: "evidence-fabricated",
      kind: "public-web",
      sourceUrl: "https://public.example/fabricated",
      title: "Fabricated page",
      excerpt: "The prospect won a national essay prize.",
      fact: "The prospect won a national essay prize.",
    });
    fabricated.hooks[0].claim = {
      id: "hook-fabricated",
      text: "The prospect won a national essay prize.",
      evidenceIds: ["evidence-fabricated"],
    };
    expect(citationGateIssues(fabricated)).toEqual([]);

    const store = new MemoryRunStore();
    store.approve("run-1", { artifactKind: "research-source-access" });
    const repository = new MemoryResearchBriefRepository();
    const result = await runWorkflow(
      createResearchWorkflow({
        lead: qualifiedLead(),
        sources: sourceProvider(richPublicSources()),
        repository,
        agent: {
          async create() {
            return fabricated;
          },
        },
      }),
      { store, trigger: "self-authored-evidence-probe" },
    );

    expect(result.status).toBe("failed");
    expect(repository.saved).toEqual([]);
    expect(store.exceptions).toContainEqual(
      expect.objectContaining({
        kind: "ResearchCitationGateFailed",
        message: expect.stringContaining(
          "evidence was not produced from the scoped source registry",
        ),
      }),
    );
  });

  it("treats a brief with no declared unknowns as a gate failure", async () => {
    const brief = await makeValidBrief();
    brief.unknowns = [];
    expect(citationGateIssues(brief)).toContainEqual({
      claimId: "brief.unknowns",
      reason: "at least one unknown is required",
    });
  });

  it("returns low confidence and declared unknowns for deliberately thin public information", async () => {
    const context = await loadAgentContext();
    const thinSources = await readJsonFixture<PublicSourcePage[]>(
      "research-sources.thin.json",
    );
    const brief = await new DeterministicResearchAgent().create({
      lead: qualifiedLead({
        text: "Grade 11 student wants SAT Reading help.",
        location: undefined,
      }),
      context,
      publicSources: thinSources,
      exclusions: [],
    });

    expect(brief.confidence).toBeLessThanOrEqual(0.3);
    expect(brief.unknowns.map((item) => item.text)).toEqual(
      expect.arrayContaining([
        "Deadline: Not provided",
        "Relevant public research facts recorded: 0",
      ]),
    );
    expect(brief.hooks).toHaveLength(3);
    expect(citationGateIssues(brief)).toEqual([]);
  });

  it("does not raise confidence for an irrelevant public page", async () => {
    const brief = await new DeterministicResearchAgent().create({
      lead: qualifiedLead(),
      context: await loadAgentContext(),
      publicSources: [
        {
          url: "https://public.example/unrelated",
          title: "Unrelated public page",
          content:
            "The community garden publishes its tomato harvest calendar.",
          access: "public",
          acquisition: "direct-public-page",
        },
      ],
      exclusions: [],
    });

    expect(brief.confidence).toBe(0.3);
    expect(brief.evidence.map((item) => item.sourceUrl)).not.toContain(
      "https://public.example/unrelated",
    );
    expect(brief.unknowns.map((item) => item.text)).toContain(
      "Relevant public research facts recorded: 0",
    );
  });

  it("rejects all ten audited minor-detail phrasings at sentence scope", () => {
    const phrasings = [
      "Jordan Lee is age 16 and attends North Example School.",
      "Jordan Lee is 16 years old and studies SAT Reading.",
      "She's 15 and studies SAT Reading.",
      "Jordan is in 10th grade and studies SAT Reading.",
      "Jordan is a sophomore studying SAT Reading.",
      "Their daughter studies SAT Reading and uses jordan@example.test.",
      "Jordan is a junior at North Example High School studying SAT Reading.",
      "Jordan was born March 2010 and studies SAT Reading.",
      "student@example.test is the email for their daughter studying SAT Reading.",
      "Jordan is turning 17 next month and studies SAT Reading.",
    ];
    for (const sentence of phrasings) {
      expect(publicSentenceHasMinorPersonalData(sentence), sentence).toBe(true);
      const scoped = scopePublicSources([
        {
          url: `https://school.example/${phrasings.indexOf(sentence)}`,
          title: "Public profile",
          content: sentence,
          access: "public",
          acquisition: "direct-public-page",
        },
      ]);
      expect(scoped.allowed, sentence).toEqual([]);
      expect(scoped.exclusions, sentence).toEqual([
        expect.objectContaining({ reason: "minor-personal-data" }),
      ]);
    }
  });

  it("removes a minor-detail sentence while preserving a safe sentence on the same page", () => {
    const scoped = scopePublicSources([
      {
        url: "https://library.example/mixed-page",
        title: "Library reading program",
        content:
          "The public library offers SAT Reading workshops every Saturday. Jordan is a sophomore at North Example High School.",
        access: "public",
        acquisition: "direct-public-page",
      },
    ]);

    expect(scoped.allowed).toHaveLength(1);
    expect(scoped.allowed[0].content).toBe(
      "The public library offers SAT Reading workshops every Saturday.",
    );
    expect(scoped.exclusions).toEqual([
      expect.objectContaining({ reason: "minor-personal-data" }),
    ]);
  });

  it("allows a public program page with no personal minor detail", () => {
    const page = {
      url: "https://library.example/safe-program",
      title: "Library reading program",
      content:
        "The public library offers SAT Reading workshops every Saturday.",
      access: "public" as const,
      acquisition: "direct-public-page" as const,
    };
    const scoped = scopePublicSources([page]);
    expect(scoped.allowed).toEqual([page]);
    expect(scoped.exclusions).toEqual([]);
  });

  it("excludes a fetched minor detail before evidence assembly and logs only the source exclusion", async () => {
    const minorPage = await readJsonFixture<PublicSourcePage>(
      "research-source.minor-detail.json",
    );
    const store = new MemoryRunStore();
    store.approve("run-1", { artifactKind: "research-source-access" });
    const repository = new MemoryResearchBriefRepository();
    const result = await runWorkflow(
      createResearchWorkflow({
        lead: qualifiedLead(),
        sources: sourceProvider([richPublicSources()[0], minorPage]),
        repository,
      }),
      { store, trigger: "minor-detail-scope-probe" },
    );

    expect(result.status).toBe("succeeded");
    const brief = repository.saved[0].brief;
    expect(brief.evidence.map((item) => item.sourceUrl)).not.toContain(
      minorPage.url,
    );
    expect(brief.exclusions).toContainEqual({
      sourceRef: expect.stringMatching(/^source-[a-f0-9]{12}$/),
      reason: "minor-personal-data",
    });
    expect(renderResearchBrief(brief)).not.toContain("Jordan Lee");
    expect(JSON.stringify(store.exceptions)).not.toContain("Jordan Lee");
    expect(store.exceptions).toContainEqual(
      expect.objectContaining({
        kind: "ResearchSourceExcluded",
        message: expect.stringMatching(
          /^Source source-[a-f0-9]{12}: excluded minor-personal-data\.$/,
        ),
      }),
    );
  });

  it("excludes enrichment vendors and non-public source acquisitions", () => {
    const vendor: PublicSourcePage = {
      url: "https://app.apollo.io/person/example",
      title: "Vendor profile",
      content: "Purchased contact record.",
      access: "public",
      acquisition: "direct-public-page",
    };
    const privatePage = {
      url: "https://private.example/profile",
      title: "Private profile",
      content: "Account-only page.",
      access: "private",
      acquisition: "vendor-export",
    } as unknown as PublicSourcePage;
    const scoped = scopePublicSources([
      richPublicSources()[0],
      vendor,
      privatePage,
    ]);

    expect(scoped.allowed).toHaveLength(1);
    expect(scoped.exclusions.map((item) => item.reason)).toEqual([
      "enrichment-vendor",
      "not-public",
    ]);
  });

  it("derives different cited disqualifiers for different prospect risks", async () => {
    const firstBase = qualifiedLead();
    const secondBase = qualifiedLead({
      id: "english-prospect",
      subject: "English",
      text: "Grade 10 student wants analytical English reading support this fall.",
    });
    const first = await new DeterministicResearchAgent().create({
      lead: {
        ...firstBase,
        location: "New York, NY",
        raw: {
          ...(firstBase.raw as Record<string, unknown>),
          preferredNextStep: "Schedule an introductory call",
        },
      },
      context: await loadAgentContext(),
      publicSources: richPublicSources(),
      exclusions: [],
    });
    const second = await new DeterministicResearchAgent().create({
      lead: {
        ...secondBase,
        location: undefined,
        raw: {
          ...(secondBase.raw as Record<string, unknown>),
          deadline: "2026-12-01",
          preferredNextStep: "Review tutoring options",
        },
      },
      context: await loadAgentContext(),
      publicSources: richPublicSources(),
      exclusions: [],
    });

    expect(first.disqualifier.basis.text).toContain(
      "deadline was not provided",
    );
    expect(second.disqualifier.basis.text).toContain(
      "location was not provided",
    );
    expect(first.disqualifier.basis.text).not.toBe(
      second.disqualifier.basis.text,
    );
    expect(first.unknowns.map((item) => item.text)).not.toContain(
      first.disqualifier.basis.text,
    );
    expect(second.unknowns.map((item) => item.text)).not.toContain(
      second.disqualifier.basis.text,
    );
    expect(citationGateIssues(first)).toEqual([]);
    expect(citationGateIssues(second)).toEqual([]);
  });

  it("states when no genuine fit risk is identified and cites that review", async () => {
    const base = qualifiedLead({ location: "New York, NY" });
    const brief = await new DeterministicResearchAgent().create({
      lead: {
        ...base,
        raw: {
          ...(base.raw as Record<string, unknown>),
          deadline: "2026-12-01",
          preferredNextStep: "Schedule a tutoring session",
        },
      },
      context: await loadAgentContext(),
      publicSources: richPublicSources(),
      exclusions: [],
    });

    expect(brief.disqualifier.basis.text).toBe(
      "Fit risk for SAT Reading: none identified in the scoped evidence.",
    );
    expect(brief.disqualifier.basis.evidenceIds).toHaveLength(1);
    expect(citationGateIssues(brief)).toEqual([]);
  });

  it("rejoins wrapped ICP bullet continuations before selecting a fit fact", () => {
    const wrapped = [
      "### Wyzant screen",
      "",
      "- The subject matches one of the four approved subjects above, and no part of",
      "  the request falls in the out-of-scope list.",
    ].join("\n");
    expect(selectIcpFact(wrapped, qualifiedLead())).toBe(
      "The subject matches one of the four approved subjects above, and no part of the request falls in the out-of-scope list.",
    );
  });
});

describe("Phase 4 research brief persistence and review", () => {
  it("records accept, accept-with-edits, and reject reviews as KPI 3 approval rows", async () => {
    const brief = await makeValidBrief();
    const generated = renderResearchBrief(brief);
    const decisions: ApprovalDecision[] = [
      "accept",
      "accept-with-edits",
      "reject",
    ];
    const rows = [];
    for (const decision of decisions) {
      const store = new MemoryRunStore();
      await reviewResearchBrief(store, {
        runId: `run-${decision}`,
        brief,
        reviewedArtifact:
          decision === "accept-with-edits"
            ? `${generated}\nHuman clarification added.`
            : generated,
        approvedBy: "Athena Huo",
        decision,
        requiredNewResearch: decision === "reject",
      });
      const row = store.approvals[0];
      rows.push(row);
      expect(row).toMatchObject({
        artifactKind: "research-brief",
        level: "YELLOW",
        approvedBy: "Athena Huo",
        decision,
      });
      expect(row.editDistance).toBeGreaterThanOrEqual(0);
    }
    expect(rows[0].editDistance).toBe(0);
    expect(rows[1].editDistance).toBeGreaterThan(0);
    expect(computeOutputAcceptance(rows)).toMatchObject({
      reviewed: 3,
      accepted: 2,
    });
  });

  it("uses the frozen normalized character edit-distance formula", () => {
    expect(normalizedEditDistance("A  short\r\nbrief", "A short\nbrief")).toBe(
      0,
    );
    expect(normalizedEditDistance("", "abc")).toBe(1);
    expect(normalizedEditDistance("abc", "axc")).toBeCloseTo(1 / 3);
  });

  it("writes a tenant-scoped durable brief through the Prisma repository", async () => {
    const brief = await makeValidBrief();
    const create = vi.fn<
      (query: { data: Record<string, unknown> }) => Promise<{ id: string }>
    >(async () => ({ id: "brief-db" }));
    const client = { researchBrief: { create } } as unknown as PrismaClient;
    await expect(
      new PrismaResearchBriefRepository(client).save("run-db", brief),
    ).resolves.toMatchObject({ id: "brief-db", runId: "run-db" });

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].data).toMatchObject({
      orgId: "00000000-0000-0000-0000-000000000001",
      runId: "run-db",
      leadId: brief.leadId,
      confidence: brief.confidence,
    });
  });

  it("writes a review row through the production RunStore", async () => {
    const create = vi.fn<
      (query: { data: Record<string, unknown> }) => Promise<{ id: string }>
    >(async () => ({ id: "approval-db" }));
    const client = { approval: { create } } as unknown as PrismaClient;
    const input = {
      runId: "3b27c49f-59e6-4d6f-a665-9e58bc0f1f23",
      level: "YELLOW",
      artifactKind: "research-brief",
      approvedBy: "Athena Huo",
      decision: "accept-with-edits" as const,
      editDistance: 0.12,
      requiredNewResearch: false,
    };
    await new PrismaRunStore(client).recordApproval(input);
    expect(create.mock.calls[0][0].data).toEqual({
      orgId: "00000000-0000-0000-0000-000000000001",
      ...input,
    });
  });

  it("creates research_briefs with RLS and structural checks in the same migration", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/202608260005_phase_4_research_briefs/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toMatch(/CREATE TABLE "research_briefs"/);
    expect(migration).toMatch(
      /ALTER TABLE public\.research_briefs ENABLE ROW LEVEL SECURITY/,
    );
    expect(migration).toMatch(/research_briefs_unknowns_required/);
    expect(migration).toMatch(/research_briefs_hook_count/);
    expect(migration).toMatch(/research_briefs_confidence_range/);
  });
});
