import type { PrismaClient } from "@prisma/client";
import { WHETSTONE_ORG_ID } from "./organization";

export type RunStatus = "running" | "succeeded" | "failed";
export type StepStatus = "succeeded" | "failed";
export type ApprovalDecision = "accept" | "accept-with-edits" | "reject";

/**
 * The decisions that permit an external action, as an allowlist.
 *
 * A denylist ("anything that is not reject") would let a value nobody has
 * thought of yet, such as "pending", grant. Exported so the test double reads
 * the same constant rather than restating it and drifting.
 */
export const GRANTING_DECISIONS: readonly ApprovalDecision[] = [
  "accept",
  "accept-with-edits",
];

export interface CreateRunInput {
  workflowId: string;
  trigger: string;
  baselineMinutes: number;
}

export interface FinishRunInput {
  status: RunStatus;
  endedAt: Date;
  humanMinutes: number;
  costUsd: number;
}

export interface RecordStepInput {
  runId: string;
  step: string;
  status: StepStatus;
  inputHash?: string;
  outputRef?: string;
  error?: string;
  durationMs: number;
  startedAt: Date;
  endedAt: Date;
}

export interface RecordMeasurementInput {
  runId: string;
  kpi: string;
  value: number;
  unit: string;
}

export interface RecordExceptionInput {
  runId?: string;
  workflowId?: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface ApprovalRecord {
  level: string;
  artifactKind: string;
  approvedBy: string;
  decision: ApprovalDecision;
}

/**
 * The KPI substrate. Every workflow execution writes through this, which is
 * what makes KPI #4's denominator complete: a run that fails at step one has
 * already written its `runs` row before the step is attempted.
 */
export interface RunStore {
  createRun(input: CreateRunInput): Promise<string>;
  finishRun(runId: string, input: FinishRunInput): Promise<void>;
  recordStep(input: RecordStepInput): Promise<void>;
  recordMeasurement(input: RecordMeasurementInput): Promise<void>;
  recordException(input: RecordExceptionInput): Promise<void>;
  /** Approvals carrying a human `approved_by` that permit external action. */
  findGrantingApproval(runId: string): Promise<ApprovalRecord | null>;
  costUsdSince(since: Date): Promise<number>;
  runCountSince(workflowId: string, since: Date): Promise<number>;
}

export class PrismaRunStore implements RunStore {
  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {}

  async createRun(input: CreateRunInput): Promise<string> {
    const run = await this.client.run.create({
      data: {
        orgId: this.orgId,
        workflowId: input.workflowId,
        trigger: input.trigger,
        baselineMinutes: input.baselineMinutes,
        status: "running",
      },
      select: { id: true },
    });
    return run.id;
  }

  async finishRun(runId: string, input: FinishRunInput): Promise<void> {
    await this.client.run.update({
      where: { id: runId },
      data: {
        status: input.status,
        endedAt: input.endedAt,
        humanMinutes: input.humanMinutes,
        costUsd: input.costUsd,
      },
    });
  }

  async recordStep(input: RecordStepInput): Promise<void> {
    await this.client.runStep.create({
      data: { orgId: this.orgId, ...input },
    });
  }

  async recordMeasurement(input: RecordMeasurementInput): Promise<void> {
    await this.client.measurement.create({
      data: { orgId: this.orgId, ...input },
    });
  }

  async recordException(input: RecordExceptionInput): Promise<void> {
    await this.client.exception.create({
      data: { orgId: this.orgId, ...input },
    });
  }

  /**
   * `approved_by` is TEXT, so `approved_by <> ''` is TRUE for a whitespace-only
   * value: SQL does no trimming here, and only char(n) would ignore trailing
   * spaces. That row comes back from this query. It is refused a layer up by
   * the trim in `workflow.ts`, and it cannot be written in the first place
   * because of the `approvals_approved_by_not_blank` CHECK constraint. Three
   * independent layers, each verified on its own.
   */
  async findGrantingApproval(runId: string): Promise<ApprovalRecord | null> {
    const approval = await this.client.approval.findFirst({
      where: {
        orgId: this.orgId,
        runId,
        decision: { in: [...GRANTING_DECISIONS] },
        approvedBy: { not: "" },
      },
      orderBy: { decidedAt: "desc" },
      select: {
        level: true,
        artifactKind: true,
        approvedBy: true,
        decision: true,
      },
    });
    return approval as ApprovalRecord | null;
  }

  async costUsdSince(since: Date): Promise<number> {
    const total = await this.client.run.aggregate({
      where: { orgId: this.orgId, startedAt: { gte: since } },
      _sum: { costUsd: true },
    });
    return Number(total._sum.costUsd ?? 0);
  }

  async runCountSince(workflowId: string, since: Date): Promise<number> {
    return this.client.run.count({
      where: { orgId: this.orgId, workflowId, startedAt: { gte: since } },
    });
  }
}
