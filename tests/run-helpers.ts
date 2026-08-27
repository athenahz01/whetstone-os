import type { FlagStore } from "../lib/core/governor";
import {
  GRANTING_DECISIONS,
  type ApprovalRecord,
  type CreateRunInput,
  type FinishRunInput,
  type RecordExceptionInput,
  type RecordApprovalInput,
  type RecordMeasurementInput,
  type RecordStepInput,
  type RunStore,
} from "../lib/core/run-store";
import type { Step, Workflow } from "../lib/core/workflow";

export interface StoredRun extends CreateRunInput {
  id: string;
  status: string;
  humanMinutes: number;
  costUsd: number;
  humanRescue: boolean;
  startedAt: Date;
  endedAt?: Date;
}

/**
 * An in-memory RunStore so the workflow contract can be exercised without a
 * database. It records, it does not interpret: the assertions in the suite read
 * these arrays directly, so a test cannot pass by agreeing with a fake.
 */
export class MemoryRunStore implements RunStore {
  readonly runs: StoredRun[] = [];
  readonly steps: RecordStepInput[] = [];
  readonly measurements: RecordMeasurementInput[] = [];
  readonly exceptions: RecordExceptionInput[] = [];
  readonly approvals: RecordApprovalInput[] = [];
  private counter = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  async createRun(input: CreateRunInput): Promise<string> {
    const id = `run-${++this.counter}`;
    this.runs.push({
      ...input,
      id,
      status: "running",
      humanMinutes: 0,
      costUsd: 0,
      humanRescue: false,
      startedAt: this.now(),
    });
    return id;
  }

  async finishRun(runId: string, input: FinishRunInput): Promise<void> {
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`no such run: ${runId}`);
    run.status = input.status;
    run.endedAt = input.endedAt;
    run.humanMinutes = input.humanMinutes;
    run.costUsd = input.costUsd;
  }

  async recordStep(input: RecordStepInput): Promise<void> {
    this.steps.push(input);
  }

  async recordMeasurement(input: RecordMeasurementInput): Promise<void> {
    this.measurements.push(input);
  }

  async recordException(input: RecordExceptionInput): Promise<void> {
    this.exceptions.push(input);
  }

  async recordApproval(input: RecordApprovalInput): Promise<void> {
    this.approvals.push(input);
  }

  /**
   * Mirrors `PrismaRunStore.findGrantingApproval` exactly, including where that
   * is more permissive than it reads.
   *
   * It must NOT trim. `approved_by` is TEXT, so the SQL `approved_by <> ''` is
   * TRUE for a whitespace-only value and the row is returned. A fake that
   * trimmed would be stricter than the store, and the suite would prove a
   * property production does not have: the trim in `workflow.ts` is what
   * actually refuses that row, and it has to be reachable from here to be
   * tested.
   *
   * `decision` uses the same exported allowlist rather than a restated
   * denylist, so the two cannot drift apart again.
   */
  async findGrantingApproval(runId: string): Promise<ApprovalRecord | null> {
    const approval = this.approvals.find(
      (candidate) =>
        candidate.runId === runId &&
        candidate.approvedBy !== "" &&
        GRANTING_DECISIONS.includes(candidate.decision),
    );
    return approval ?? null;
  }

  async costUsdSince(since: Date): Promise<number> {
    return this.runs
      .filter((run) => run.startedAt >= since)
      .reduce((total, run) => total + run.costUsd, 0);
  }

  async runCountSince(workflowId: string, since: Date): Promise<number> {
    return this.runs.filter(
      (run) => run.workflowId === workflowId && run.startedAt >= since,
    ).length;
  }

  /** Stands in for a human approving in the review surface Phase 7 builds. */
  approve(runId: string, approval: Partial<ApprovalRecord> = {}): void {
    this.approvals.push({
      runId,
      level: "YELLOW",
      artifactKind: "outreach-draft",
      approvedBy: "Athena Huo",
      decision: "accept",
      editDistance: 0,
      requiredNewResearch: false,
      ...approval,
    });
  }

  stepsFor(runId: string): RecordStepInput[] {
    return this.steps.filter((step) => step.runId === runId);
  }
}

export class MemoryFlagStore implements FlagStore {
  private readonly flags = new Map<string, boolean>();

  async isEnabled(key: string): Promise<boolean> {
    return this.flags.get(key) ?? false;
  }

  async setEnabled(key: string, enabled: boolean): Promise<void> {
    this.flags.set(key, enabled);
  }
}

/** A registrable workflow with every required field, for tests to vary. */
export function testWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "T1.mock",
    goal: "Exercise the workflow contract end to end.",
    approvalLevel: "GREEN",
    owner: "Athena Huo",
    inputs: [{ doc: "ICP.md", why: "qualification criteria" }],
    tools: [{ name: "table:leads", access: "read", why: "read fixtures" }],
    steps: [step("prepare", async () => ({ prepared: true }))],
    outputs: [{ kind: "note", destination: "table:runs" }],
    qaGates: [
      {
        id: "always-passes",
        describe: "A gate that passes so handoff is reachable.",
        check: () => true,
      },
    ],
    handoff: { to: "Athena Huo", state: "ready for review" },
    escalation: [
      { when: "a step fails", who: "Athena Huo", how: "exceptions row" },
    ],
    measures: [{ kpi: "t1.items", unit: "items" }],
    baseline: { taskId: "H-02", minutes: 5 },
    ...overrides,
  };
}

export function step(
  id: string,
  run: Step["run"] | (() => Promise<unknown>),
): Step {
  return { id, run: run as Step["run"] };
}
