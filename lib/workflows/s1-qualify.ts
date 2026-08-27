import { loadAgentContext, type AgentContext } from "../core/context";
import { dedupeAcrossAdapters } from "../core/prospect-dedupe";
import { qualifyLead, readQualification } from "../core/qualification";
import type { ChannelAdapter, Lead } from "../core/types";
import type { StepContext, Workflow } from "../core/workflow";

export const S1_QUALIFY_ID = "S1.qualify";

export interface QualifyWorkflowOptions {
  adapters: ChannelAdapter[];
  loadContext?: () => Promise<AgentContext>;
}

export interface QualificationBatch {
  leads: Lead[];
  polled: number;
  dedupedAcrossAdapters: number;
  verdictCounts: Record<
    "icp_pass" | "icp_fail" | "out_of_scope" | "needs_human_review",
    number
  >;
}

export function createQualifyWorkflow(
  options: QualifyWorkflowOptions,
): Workflow {
  return {
    id: S1_QUALIFY_ID,
    goal: "Judge normalized prospects against the written ICP with cited evidence.",
    approvalLevel: "GREEN",
    owner: "Athena Huo",
    inputs: [
      { doc: "ICP.md", why: "The sole authority for source and fit criteria." },
      {
        doc: "FACTS.md",
        why: "Records the standing online and remote decision.",
      },
    ],
    tools: [
      {
        name: "channel-adapters",
        access: "read",
        why: "Poll normalized prospects from permitted sources.",
      },
      {
        name: "table:runs",
        access: "write",
        why: "Record qualification attempts and measurements.",
      },
    ],
    outputs: [{ kind: "qualified-leads", destination: "S1.ingest" }],
    steps: [
      {
        id: "poll-dedupe-qualify",
        async run(context: StepContext): Promise<QualificationBatch> {
          const rawLeads: Lead[] = [];
          for (const adapter of options.adapters) {
            try {
              rawLeads.push(...(await adapter.poll()));
            } catch (error) {
              await context.recordException({
                kind: "AdapterPollFailed",
                severity: "warning",
                message: `${adapter.name}: ${error instanceof Error ? error.name : "UnknownError"}`,
              });
            }
          }
          const deduped = dedupeAcrossAdapters(rawLeads);
          const agentContext = await (
            options.loadContext ?? loadAgentContext
          )();
          const leads = deduped.leads.map((lead) =>
            qualifyLead(lead, agentContext),
          );
          const verdictCounts: QualificationBatch["verdictCounts"] = {
            icp_pass: 0,
            icp_fail: 0,
            out_of_scope: 0,
            needs_human_review: 0,
          };
          for (const lead of leads) {
            const qualification = readQualification(lead);
            if (qualification) verdictCounts[qualification.verdict] += 1;
          }
          context.measure("s1.prospects_qualified", leads.length, "prospects");
          context.measure(
            "s1.icp_pass_leading_indicator",
            verdictCounts.icp_pass,
            "prospects",
          );
          return {
            leads,
            polled: rawLeads.length,
            dedupedAcrossAdapters: deduped.deduped,
            verdictCounts,
          };
        },
      },
    ],
    qaGates: [
      {
        id: "every-prospect-has-evidence",
        describe:
          "Every prospect has one of four verdicts, rationale, evidence, and confidence.",
        check({ outputs }) {
          const batch = outputs.get("poll-dedupe-qualify") as
            QualificationBatch | undefined;
          return Boolean(
            batch?.leads.every((lead) => {
              const qualification = readQualification(lead);
              return (
                qualification &&
                qualification.rationale.trim().length > 0 &&
                qualification.evidence.length > 0 &&
                qualification.evidence.every((item) =>
                  item.ref.startsWith("ICP.md#"),
                ) &&
                qualification.confidence >= 0 &&
                qualification.confidence <= 1
              );
            }),
          );
        },
      },
    ],
    handoff: {
      to: "S1.ingest",
      state: "deduped prospects carry an evidence-backed ICP verdict",
    },
    escalation: [
      {
        when: "evidence is incomplete but no exclusion is proven",
        who: "Athena Huo",
        how: "needs_human_review verdict in the decision queue",
      },
    ],
    measures: [
      { kpi: "s1.prospects_qualified", unit: "prospects" },
      { kpi: "s1.icp_pass_leading_indicator", unit: "prospects" },
    ],
    baseline: { taskId: "H-02", minutes: 5 },
  };
}
