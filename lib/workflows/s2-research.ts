import { loadAgentContext, type AgentContext } from "../core/context";
import {
  citationGateIssues,
  DeterministicResearchAgent,
  ResearchBriefGateError,
  scopePublicSources,
  type ResearchAgent,
  type ResearchBrief,
  type ResearchSourceProvider,
} from "../core/research";
import type {
  ResearchBriefRepository,
  SavedResearchBrief,
} from "../core/research-store";
import type { Lead } from "../core/types";
import type { StepContext, Workflow } from "../core/workflow";

export const S2_RESEARCH_ID = "S2.research";

export interface ResearchWorkflowOptions {
  lead: Lead;
  sources: ResearchSourceProvider;
  repository: ResearchBriefRepository;
  agent?: ResearchAgent;
  loadContext?: () => Promise<AgentContext>;
}

interface ResearchStepResult {
  brief: ResearchBrief;
  trustedBrief: ResearchBrief;
}

export function createResearchWorkflow(
  options: ResearchWorkflowOptions,
): Workflow {
  const agent = options.agent ?? new DeterministicResearchAgent();
  return {
    id: S2_RESEARCH_ID,
    goal: "Produce a short source-backed brief for one qualified prospect.",
    approvalLevel: "YELLOW",
    owner: "Athena Huo",
    inputs: [
      {
        doc: "ICP.md",
        why: "Ground why-fit reasoning in the approved prospect definition.",
      },
    ],
    tools: [
      {
        name: "public-web-sources",
        access: "read",
        why: "Read direct public pages through the YELLOW approval boundary.",
      },
      {
        name: "table:research_briefs",
        access: "write",
        why: "Persist only briefs that pass citation QA.",
      },
      {
        name: "table:approvals",
        access: "write",
        why: "Record the later human review for KPI 3.",
      },
      {
        name: "table:exceptions",
        access: "write",
        why: "Name rejected claims and excluded sources without logging PII.",
      },
    ],
    outputs: [
      {
        kind: "research-brief",
        destination: "table:research_briefs and Athena Huo review queue",
      },
    ],
    steps: [
      {
        id: "research",
        async run(context: StepContext): Promise<ResearchStepResult> {
          const pages = await context.external({
            name: "fetch-public-research-sources",
            perform: () => options.sources.fetchPublicSources(options.lead),
          });
          const scoped = scopePublicSources(pages);
          for (const exclusion of scoped.exclusions) {
            await context.recordException({
              kind: "ResearchSourceExcluded",
              severity: "warning",
              message: `Source ${exclusion.sourceRef}: excluded ${exclusion.reason}.`,
            });
          }
          const agentInput = {
            lead: options.lead,
            context: await (options.loadContext ?? loadAgentContext)(),
            publicSources: scoped.allowed,
            exclusions: scoped.exclusions,
          };
          const trustedBrief = await new DeterministicResearchAgent().create(
            agentInput,
          );
          const brief = options.agent
            ? await agent.create(agentInput)
            : trustedBrief;
          return { brief, trustedBrief };
        },
      },
      {
        id: "citation-check-and-save",
        async run(context: StepContext): Promise<SavedResearchBrief> {
          const research = context.outputs.get("research") as
            ResearchStepResult | undefined;
          if (!research?.brief)
            throw new Error("Research step produced no brief.");
          const { brief, trustedBrief } = research;
          const issues = citationGateIssues(brief, trustedBrief);
          for (const issue of issues) {
            await context.recordException({
              kind: "ResearchCitationGateFailed",
              severity: "critical",
              message: `Claim ${issue.claimId}: ${issue.reason}.`,
            });
          }
          if (issues[0]) throw new ResearchBriefGateError(issues[0]);
          const saved = await options.repository.save(context.runId, brief);
          context.measure("s2.briefs_ready_for_review", 1, "briefs");
          return saved;
        },
      },
    ],
    qaGates: [
      {
        id: "citation-check",
        describe:
          "Every factual claim cites recorded evidence that textually supports it, and unknowns are declared.",
        check({ outputs }) {
          const saved = outputs.get("citation-check-and-save") as
            SavedResearchBrief | undefined;
          const research = outputs.get("research") as
            ResearchStepResult | undefined;
          return Boolean(
            saved &&
            research &&
            citationGateIssues(saved.brief, research.trustedBrief).length === 0,
          );
        },
      },
    ],
    handoff: {
      to: "Athena Huo",
      state: "source-backed research brief ready for human review",
    },
    escalation: [
      {
        when: "a claim is uncited or its citation does not support it",
        who: "Athena Huo",
        how: "named ResearchCitationGateFailed exception",
      },
      {
        when: "a fetched page contains personal data about a minor",
        who: "Athena Huo",
        how: "source exclusion row without the personal detail",
      },
    ],
    measures: [{ kpi: "s2.briefs_ready_for_review", unit: "briefs" }],
    baseline: { taskId: "H-03", minutes: 15 },
  };
}
