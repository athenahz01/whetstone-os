import type { PrismaClient } from "@prisma/client";
import { WHETSTONE_ORG_ID } from "./organization";

/**
 * Cole's five KPIs.
 *
 * Each is split in two on purpose: a repository function that issues exactly
 * one indexed read, and a pure function that turns those rows into the number.
 * The split is what makes the definitions auditable, because the arithmetic can
 * be recomputed by hand from a fixture without a database in the way.
 *
 * Definitions are pinned to the KPI doc's wording, not to a plausible
 * paraphrase. Where a clause is not yet buildable it is named as absent rather
 * than quietly dropped.
 */

/**
 * Frozen in docs/BASELINES.md before any real approval existed. Exactly 0.20 is
 * not a minor edit, so the comparison is strict. Never revise this after real
 * acceptance data exists; a change creates a new versioned definition.
 * tests/kpi-fixture.test.ts asserts this constant still matches the document.
 */
export const MINOR_EDIT_THRESHOLD = 0.2;

export interface KpiWindow {
  from: Date;
  to: Date;
}

type Decimalish = number | { toString(): string };

function toNumber(value: Decimalish | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value.toString());
}

/* KPI #1 - working workflows -------------------------------------------- */

export interface WorkflowIdRow {
  workflowId: string;
}

/**
 * One entry in the workflow registry that had at least one attempted run in the
 * window. Counted from `runs`, not from intent. The unit is a registry id, so
 * the number is unambiguous.
 */
export function computeWorkingWorkflows(rows: WorkflowIdRow[]): number {
  return new Set(rows.map((row) => row.workflowId)).size;
}

/* KPI #2 - human time saved ---------------------------------------------- */

export interface RunTimeRow {
  status: string;
  baselineMinutes: number;
  humanMinutes: number;
}

export interface HumanTimeSaved {
  baselineMinutes: number;
  humanMinutes: number;
  savedMinutes: number;
}

/**
 * BASELINES.md minutes for equivalent output, minus recorded human minutes.
 *
 * Baseline minutes are credited only for runs that produced equivalent output,
 * which means runs that succeeded. Human minutes are subtracted for every run
 * in the window including failed ones, because time spent on a run that failed
 * was still spent. Both choices push the number down rather than up.
 *
 * Human minutes are timed by the application. Self-report is never a source.
 */
export function computeHumanTimeSaved(rows: RunTimeRow[]): HumanTimeSaved {
  const baselineMinutes = rows
    .filter((row) => row.status === "succeeded")
    .reduce((total, row) => total + row.baselineMinutes, 0);
  const humanMinutes = rows.reduce((total, row) => total + row.humanMinutes, 0);
  return {
    baselineMinutes,
    humanMinutes,
    savedMinutes: baselineMinutes - humanMinutes,
  };
}

/* KPI #3 - output acceptance rate ---------------------------------------- */

export interface ApprovalRow {
  editDistance: Decimalish;
  requiredNewResearch: boolean;
}

export interface OutputAcceptance {
  accepted: number;
  reviewed: number;
  rate: number | null;
}

/**
 * Approvals where edit distance is under the threshold AND
 * `required_new_research` is false, over total outputs reviewed. Both clauses,
 * because the KPI doc's definition has both.
 *
 * Every YELLOW output writes an `approvals` row, so this covers outreach
 * drafts, research briefs and content alike rather than drafts only.
 */
export function computeOutputAcceptance(
  rows: ApprovalRow[],
  threshold = MINOR_EDIT_THRESHOLD,
): OutputAcceptance {
  const accepted = rows.filter(
    (row) => toNumber(row.editDistance) < threshold && !row.requiredNewResearch,
  ).length;
  return {
    accepted,
    reviewed: rows.length,
    rate: rows.length === 0 ? null : accepted / rows.length,
  };
}

/* KPI #4 - workflow success rate ----------------------------------------- */

export interface RunOutcomeRow {
  status: string;
  humanRescue: boolean;
}

export interface WorkflowSuccess {
  succeeded: number;
  attempted: number;
  rate: number | null;
}

/**
 * Runs reaching the intended final state AND with `human_rescue = false`, over
 * total attempted runs.
 *
 * The denominator is every run row in the window, including a run that failed
 * at its first step: the run row is written before the first step is attempted
 * precisely so those cannot go missing.
 *
 * The numerator excludes a run someone quietly fixed by hand. Status alone
 * cannot tell a clean run from a rescued one, which is the entire reason
 * `runs.human_rescue` exists.
 */
export function computeWorkflowSuccess(rows: RunOutcomeRow[]): WorkflowSuccess {
  const succeeded = rows.filter(
    (row) => row.status === "succeeded" && !row.humanRescue,
  ).length;
  return {
    succeeded,
    attempted: rows.length,
    rate: rows.length === 0 ? null : succeeded / rows.length,
  };
}

/* KPI #5 - qualified sales output ---------------------------------------- */

export interface QualifiedSalesOutput {
  readyForApproval: number;
  /**
   * The `qualify.verdict = pass` clause lands in Phase 3 and the KPI completes
   * in Phase 5. Until then this number counts prepared-and-ready only, and says
   * so rather than presenting itself as the finished definition.
   */
  verdictClauseImplemented: false;
}

export function describeQualifiedSalesOutput(
  readyForApproval: number,
): QualifiedSalesOutput {
  return { readyForApproval, verdictClauseImplemented: false };
}

/* Repository - one indexed read per KPI ---------------------------------- */

export class KpiRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {}

  private window(window: KpiWindow) {
    return {
      orgId: this.orgId,
      startedAt: { gte: window.from, lt: window.to },
    };
  }

  /** Index: runs(org_id, started_at, workflow_id). */
  async workingWorkflows(window: KpiWindow): Promise<number> {
    const rows = await this.client.run.findMany({
      where: this.window(window),
      select: { workflowId: true },
      distinct: ["workflowId"],
    });
    return computeWorkingWorkflows(rows);
  }

  /** Index: runs(org_id, started_at, status, human_rescue). */
  async humanTimeSaved(window: KpiWindow): Promise<HumanTimeSaved> {
    const rows = await this.client.run.findMany({
      where: this.window(window),
      select: { status: true, baselineMinutes: true, humanMinutes: true },
    });
    return computeHumanTimeSaved(rows);
  }

  /** Index: approvals(org_id, decided_at, decision). */
  async outputAcceptance(window: KpiWindow): Promise<OutputAcceptance> {
    const rows = await this.client.approval.findMany({
      where: {
        orgId: this.orgId,
        decidedAt: { gte: window.from, lt: window.to },
        artifactKind: {
          in: ["research-brief", "outreach-draft", "marketing-content"],
        },
      },
      select: { editDistance: true, requiredNewResearch: true },
    });
    return computeOutputAcceptance(rows);
  }

  /** Index: runs(org_id, started_at, status, human_rescue). */
  async workflowSuccess(window: KpiWindow): Promise<WorkflowSuccess> {
    const rows = await this.client.run.findMany({
      where: this.window(window),
      select: { status: true, humanRescue: true },
    });
    return computeWorkflowSuccess(rows);
  }

  /** Index: leads(org_id, channel, posted_at) with drafts(org_id, lead_id). */
  async qualifiedSalesOutput(window: KpiWindow): Promise<QualifiedSalesOutput> {
    const readyForApproval = await this.client.lead.count({
      where: {
        orgId: this.orgId,
        createdAt: { gte: window.from, lt: window.to },
        drafts: { some: {} },
      },
    });
    return describeQualifiedSalesOutput(readyForApproval);
  }
}
