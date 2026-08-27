import { loadAgentContext, type AgentContext } from "../core/context";
import { parseFactsRegister } from "../core/facts";
import {
  DeterministicOutreachAgent,
  OutreachQaGateError,
  OutreachVoiceGateError,
  outreachVoiceGate,
  sourceEcho,
  type OutreachAgent,
  type OutreachDraft,
  type QaReviewer,
} from "../core/outreach";
import type {
  OutreachDraftRepository,
  SavedOutreachDraft,
} from "../core/outreach-store";
import type { Lead } from "../core/types";
import type { OutreachChannel } from "../core/voice";
import type { StepContext, Workflow } from "../core/workflow";

export const S3_DRAFT_ID = "S3.draft";

export class UpstreamGateNotPassedError extends Error {
  constructor(step: string) {
    super(`Step "${step}" did not pass, so nothing downstream of it may run.`);
    this.name = "UpstreamGateNotPassedError";
  }
}

/**
 * runWorkflow isolates per-step failure on purpose: one failing step does not
 * stop the steps after it. That is right for a tick, and wrong for a gate.
 * Without this check the save step ran after the voice lint had already
 * rejected the draft, so a reply naming a BLOCKED fact was written to the
 * table while the run was correctly recorded as failed. The run being honest
 * is not enough when the row is real.
 */
function requirePassed(context: StepContext, step: string): unknown {
  const output = context.outputs.get(step);
  if (output === undefined) throw new UpstreamGateNotPassedError(step);
  return output;
}

export interface DraftWorkflowOptions {
  lead: Lead;
  repository: OutreachDraftRepository;
  channel?: OutreachChannel;
  tutorId?: string;
  agent?: OutreachAgent;
  /** Optional. Absent means the deterministic lint is the only gate. */
  qa?: QaReviewer;
  loadContext?: () => Promise<AgentContext>;
}

interface DraftStepResult {
  draft: OutreachDraft;
  rendered: string;
}

export function createDraftWorkflow(options: DraftWorkflowOptions): Workflow {
  const agent = options.agent ?? new DeterministicOutreachAgent();
  const channel = options.channel ?? "wyzant-inquiry-reply";
  return {
    id: S3_DRAFT_ID,
    goal: "Prepare one reply a human can send with a minor edit or none.",
    approvalLevel: "YELLOW",
    owner: "Athena Huo",
    inputs: [
      {
        doc: "VOICE.md",
        why: "Every voice rule, ban, length and structural law.",
      },
      {
        doc: "FACTS.md",
        why: "Only VERIFIED facts may appear, and no BLOCKED subject.",
      },
      { doc: "ICP.md", why: "Ground the reply in the approved subjects." },
    ],
    tools: [
      {
        name: "anthropic-messages",
        access: "read",
        why: "Draft and review copy. No temperature field is sent.",
      },
      {
        name: "table:outreach_drafts",
        access: "write",
        why: "Persist only drafts that pass the voice gate and the model QA.",
      },
      {
        name: "table:leads",
        access: "write",
        why: "Mark the prospect as ready for human approval, for KPI 5.",
      },
      {
        name: "table:approvals",
        access: "write",
        why: "Record the human decision and its edit distance, for KPI 3.",
      },
      {
        name: "table:exceptions",
        access: "write",
        why: "Name the offending clause without logging the family's words.",
      },
    ],
    outputs: [
      {
        kind: "outreach-draft",
        destination: "table:outreach_drafts and Athena Huo review queue",
      },
    ],
    steps: [
      {
        id: "draft",
        async run(): Promise<DraftStepResult> {
          const context = await (options.loadContext ?? loadAgentContext)();
          const draft = await agent.create({
            lead: options.lead,
            context,
            channel,
            tutorId: options.tutorId ?? options.lead.tutorId ?? "unassigned",
          });
          const facts = parseFactsRegister(context.documents["FACTS.md"]);
          const gate = outreachVoiceGate(draft, facts, [
            sourceEcho(options.lead, facts),
          ]);
          return { draft, rendered: gate.rendered };
        },
      },
      {
        id: "voice-lint",
        async run(context: StepContext): Promise<string[]> {
          const previous = context.outputs.get("draft") as
            DraftStepResult | undefined;
          if (!previous) throw new Error("The draft step produced nothing.");
          const agentContext = await (
            options.loadContext ?? loadAgentContext
          )();
          const facts = parseFactsRegister(agentContext.documents["FACTS.md"]);
          const gate = outreachVoiceGate(previous.draft, facts, [
            sourceEcho(options.lead, facts),
          ]);
          for (const issue of gate.issues) {
            await context.recordException({
              kind: "OutreachVoiceGateFailed",
              severity: "critical",
              // The rule and the matched fragment, never the whole draft.
              message: `${issue.rule}: ${issue.reason} (${issue.evidence})`,
            });
          }
          if (gate.issues[0]) throw new OutreachVoiceGateError(gate.issues[0]);
          return gate.issues.map((issue) => issue.rule);
        },
      },
      {
        id: "model-qa",
        async run(context: StepContext): Promise<string[]> {
          const previous = context.outputs.get("draft") as
            DraftStepResult | undefined;
          if (!previous) throw new Error("The draft step produced nothing.");
          requirePassed(context, "voice-lint");
          if (!options.qa) return [];
          const agentContext = await (
            options.loadContext ?? loadAgentContext
          )();
          // The reviewer sees the rendered draft and the register. It does not
          // see the variant, the citations the drafting step chose, or any of
          // its reasoning, so it cannot agree with the step it is checking.
          const verdict = await options.qa.review({
            renderedDraft: previous.rendered,
            factsRegister: agentContext.documents["FACTS.md"],
          });
          if (!verdict.passed) {
            for (const failure of verdict.failures) {
              await context.recordException({
                kind: "OutreachQaGateFailed",
                severity: "critical",
                message: failure,
              });
            }
            throw new OutreachQaGateError(verdict.failures);
          }
          return verdict.failures;
        },
      },
      {
        id: "save",
        async run(context: StepContext): Promise<SavedOutreachDraft> {
          const previous = context.outputs.get("draft") as
            DraftStepResult | undefined;
          if (!previous) throw new Error("The draft step produced nothing.");
          requirePassed(context, "voice-lint");
          requirePassed(context, "model-qa");
          const saved = await options.repository.save(
            context.runId,
            previous.draft,
          );
          context.measure("s3.drafts_ready_for_review", 1, "drafts");
          return saved;
        },
      },
    ],
    qaGates: [
      {
        id: "voice-and-facts",
        describe:
          "The saved draft passed the deterministic voice lint and the model QA, and states one honest limitation and one question.",
        check({ outputs, failedSteps }) {
          const saved = outputs.get("save") as SavedOutreachDraft | undefined;
          return Boolean(
            saved &&
            failedSteps.length === 0 &&
            saved.draft.disqualifier.trim() &&
            saved.draft.ask.trim().endsWith("?"),
          );
        },
      },
    ],
    handoff: {
      to: "Athena Huo",
      state: "prepared reply ready for human review, nothing sent",
    },
    escalation: [
      {
        when: "the draft breaks a voice rule or states a blocked fact",
        who: "Athena Huo",
        how: "named OutreachVoiceGateFailed exception carrying the rule id",
      },
      {
        when: "the model QA scores a rule at zero",
        who: "Athena Huo",
        how: "named OutreachQaGateFailed exception",
      },
    ],
    measures: [{ kpi: "s3.drafts_ready_for_review", unit: "drafts" }],
    baseline: { taskId: "H-04", minutes: 10 },
  };
}
