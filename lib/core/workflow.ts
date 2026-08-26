import { createHash } from "node:crypto";
import type {
  ApprovalRecord,
  RecordExceptionInput,
  RunStatus,
  RunStore,
} from "./run-store";

/**
 * Cole's spine as a code contract:
 *
 *   Goal -> Agent/Automation -> Task -> Output -> QA -> Handoff -> Action -> Measurement
 *
 * Two levels exist and only two. GREEN runs unattended because nothing leaves
 * the building. YELLOW cannot touch an external surface without an approvals
 * row carrying a human `approved_by`.
 *
 * The third level is deliberately absent from this union rather than present
 * and rejected. The plan's enforcement table says of it: "No code path exists.
 * Not a flag that could be flipped - the capability is absent." A three-member
 * union with a guard clause would be a flag that could be flipped, and would
 * put the token in the runtime for a grep to find. A two-member union means
 * such a workflow cannot be constructed at all: it fails typecheck. It stays a
 * classification in the plan, which is where the set of things this system does
 * not do belongs.
 */
export type ApprovalLevel = "GREEN" | "YELLOW";

/** One of the four agent-readable documents. Nothing else may be an input. */
export type ContextDoc = "ICP.md" | "VOICE.md" | "FACTS.md" | "BASELINES.md";

export interface ContextRef {
  doc: ContextDoc;
  why: string;
}

/** Cole's deliverable #5 requires tools and data access per agent. */
export interface ToolGrant {
  name: string;
  access: "read" | "write";
  why: string;
}

export interface OutputSpec {
  kind: string;
  destination: string;
}

export interface QaContext {
  outputs: ReadonlyMap<string, unknown>;
  failedSteps: readonly string[];
}

export interface QaGate {
  id: string;
  describe: string;
  check(context: QaContext): boolean | Promise<boolean>;
}

/** Cole's Handoff stage. Without it the spine is a diagram, not a contract. */
export interface Handoff {
  to: string;
  state: string;
}

export interface EscalationRule {
  when: string;
  who: string;
  how: string;
}

export interface MeasureRef {
  kpi: string;
  unit: string;
}

export interface ExternalAction<T> {
  /** Named so a refusal says what was refused. */
  name: string;
  perform(): Promise<T>;
}

export interface StepContext {
  readonly runId: string;
  readonly workflowId: string;
  readonly approvalLevel: ApprovalLevel;
  /** Outputs of the steps that succeeded before this one. */
  readonly outputs: ReadonlyMap<string, unknown>;
  /**
   * The only route to an external surface. A YELLOW workflow reaching this
   * without an approvals row is refused, not warned.
   */
  external<T>(action: ExternalAction<T>): Promise<T>;
  measure(kpi: string, value: number, unit: string): void;
  reportCost(usd: number): void;
  reportHumanMinutes(minutes: number): void;
  recordException(
    input: Omit<RecordExceptionInput, "runId" | "workflowId">,
  ): Promise<void>;
}

export interface Step {
  id: string;
  run(context: StepContext): Promise<unknown>;
}

export interface Workflow {
  /** The registry key. KPI #1 counts these, not agents, files or phases. */
  id: string;
  goal: string;
  approvalLevel: ApprovalLevel;
  /** A person's name. Never "the system". */
  owner: string;
  inputs: ContextRef[];
  tools: ToolGrant[];
  steps: Step[];
  outputs: OutputSpec[];
  qaGates: QaGate[];
  handoff: Handoff;
  escalation: EscalationRule[];
  measures: MeasureRef[];
  /**
   * The docs/BASELINES.md task this workflow replaces, and its frozen minutes.
   * Stamped onto the run so KPI #2 is one indexed read rather than a join
   * against a document.
   */
  baseline?: { taskId: string; minutes: number };
}

export class ApprovalRequiredError extends Error {
  constructor(workflowId: string, actionName: string) {
    super(
      `${workflowId} is YELLOW and reached "${actionName}" with no approval row. External action refused.`,
    );
    this.name = "ApprovalRequiredError";
  }
}

export class UndeclaredMeasureError extends Error {
  constructor(workflowId: string, kpi: string) {
    super(`${workflowId} reported measure "${kpi}" that it does not declare.`);
    this.name = "UndeclaredMeasureError";
  }
}

export class QaGateFailedError extends Error {
  constructor(workflowId: string, gateId: string) {
    super(`${workflowId} failed QA gate "${gateId}" before handoff.`);
    this.name = "QaGateFailedError";
  }
}

export interface RunWorkflowOptions {
  store: RunStore;
  trigger: string;
  now?: () => Date;
}

export interface RunWorkflowResult {
  runId: string;
  status: RunStatus;
  failedSteps: string[];
  outputs: Map<string, unknown>;
  handedOff: boolean;
}

/**
 * Executes a workflow and writes its complete record: one `runs` row per
 * execution, one `run_steps` row per step, an exception per failure, and a
 * `measurements` row per declared measure.
 *
 * The run row is created before the first step is attempted. That is what makes
 * KPI #4's denominator attempted runs rather than runs that got somewhere: a
 * workflow that dies in step one has already been counted.
 *
 * Per-step failure is isolated. A failing step does not stop the steps after
 * it, and does not throw out of this function, but it does mean the run did not
 * reach its intended final state, so the run is recorded as failed.
 */
export async function runWorkflow(
  workflow: Workflow,
  options: RunWorkflowOptions,
): Promise<RunWorkflowResult> {
  const { store, trigger } = options;
  const now = options.now ?? (() => new Date());

  const runId = await store.createRun({
    workflowId: workflow.id,
    trigger,
    baselineMinutes: workflow.baseline?.minutes ?? 0,
  });

  const outputs = new Map<string, unknown>();
  const failedSteps: string[] = [];
  const measurements: { kpi: string; value: number; unit: string }[] = [];
  const declared = new Set(workflow.measures.map((measure) => measure.kpi));
  let costUsd = 0;
  let humanMinutes = 0;
  let approval: ApprovalRecord | null | undefined;

  const context: StepContext = {
    runId,
    workflowId: workflow.id,
    approvalLevel: workflow.approvalLevel,
    outputs,
    async external<T>(action: ExternalAction<T>): Promise<T> {
      if (workflow.approvalLevel === "YELLOW") {
        if (approval === undefined) {
          approval = await store.findGrantingApproval(runId);
        }
        if (!approval || !approval.approvedBy.trim()) {
          throw new ApprovalRequiredError(workflow.id, action.name);
        }
      }
      return action.perform();
    },
    measure(kpi, value, unit) {
      if (!declared.has(kpi)) {
        throw new UndeclaredMeasureError(workflow.id, kpi);
      }
      measurements.push({ kpi, value, unit });
    },
    reportCost(usd) {
      costUsd += usd;
    },
    reportHumanMinutes(minutes) {
      humanMinutes += minutes;
    },
    async recordException(input) {
      await store.recordException({
        ...input,
        runId,
        workflowId: workflow.id,
      });
    },
  };

  for (const step of workflow.steps) {
    const startedAt = now();
    try {
      const output = await step.run(context);
      const endedAt = now();
      outputs.set(step.id, output);
      await store.recordStep({
        runId,
        step: step.id,
        status: "succeeded",
        inputHash: hashInputs(workflow, step),
        outputRef: describeOutput(output),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        startedAt,
        endedAt,
      });
    } catch (error) {
      const endedAt = now();
      failedSteps.push(step.id);
      await store.recordStep({
        runId,
        step: step.id,
        status: "failed",
        inputHash: hashInputs(workflow, step),
        error: describeError(error),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        startedAt,
        endedAt,
      });
      await store.recordException({
        runId,
        workflowId: workflow.id,
        kind: errorKind(error),
        severity: "critical",
        message: describeError(error),
      });
    }
  }

  let handedOff = false;
  if (failedSteps.length === 0) {
    let gatesPassed = true;
    for (const gate of workflow.qaGates) {
      if (await gate.check({ outputs, failedSteps })) continue;
      gatesPassed = false;
      failedSteps.push(`qa:${gate.id}`);
      await store.recordException({
        runId,
        workflowId: workflow.id,
        kind: "QaGateFailedError",
        severity: "critical",
        message: new QaGateFailedError(workflow.id, gate.id).message,
      });
    }
    if (gatesPassed) {
      const at = now();
      await store.recordStep({
        runId,
        step: "handoff",
        status: "succeeded",
        outputRef: `${workflow.handoff.to}:${workflow.handoff.state}`,
        durationMs: 0,
        startedAt: at,
        endedAt: at,
      });
      handedOff = true;
    }
  }

  const status: RunStatus = handedOff ? "succeeded" : "failed";
  if (handedOff) {
    for (const measurement of measurements) {
      await store.recordMeasurement({ runId, ...measurement });
    }
  }
  await store.finishRun(runId, {
    status,
    endedAt: now(),
    humanMinutes,
    costUsd,
  });

  return { runId, status, failedSteps, outputs, handedOff };
}

function hashInputs(workflow: Workflow, step: Step): string {
  const docs = workflow.inputs.map((input) => input.doc).join(",");
  return createHash("sha256")
    .update(`${workflow.id}|${step.id}|${docs}`)
    .digest("hex");
}

/**
 * A reference, never the content. G5: a run record is operational metadata and
 * must not become a second copy of what a family wrote.
 */
function describeOutput(output: unknown): string {
  if (output === undefined || output === null) return "none";
  if (typeof output === "object") {
    return `object:${Object.keys(output as object).length} keys`;
  }
  return typeof output;
}

function describeError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : "UnknownError";
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
