import type { PrismaClient } from "@prisma/client";
import { WHETSTONE_ORG_ID } from "./organization";
import type { RunStore } from "./run-store";
import {
  runWorkflow,
  type RunWorkflowOptions,
  type RunWorkflowResult,
  type Workflow,
} from "./workflow";

/**
 * The global kill switch. A row in `system_flags` that the scheduler reads on
 * every tick, so stopping the system needs no deploy and no terminal. Phase 7
 * puts a button on it; Phase 2 must not depend on a surface that does not exist
 * yet, so the admin route is the only interface for now.
 */
export const KILL_SWITCH_KEY = "scheduler.kill_switch";

export interface FlagStore {
  isEnabled(key: string): Promise<boolean>;
  setEnabled(
    key: string,
    enabled: boolean,
    updatedBy: string,
    note?: string,
  ): Promise<void>;
}

export class PrismaFlagStore implements FlagStore {
  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {}

  async isEnabled(key: string): Promise<boolean> {
    const flag = await this.client.systemFlag.findUnique({
      where: { key },
      select: { enabled: true },
    });
    return flag?.enabled ?? false;
  }

  async setEnabled(
    key: string,
    enabled: boolean,
    updatedBy: string,
    note?: string,
  ): Promise<void> {
    await this.client.systemFlag.upsert({
      where: { key },
      create: { key, orgId: this.orgId, enabled, updatedBy, note },
      update: { enabled, updatedBy, note },
    });
  }
}

export interface GovernorLimits {
  /** Ceiling on total run cost in a rolling day. */
  dailyCostUsdCeiling: number;
  /** Ceiling on runs of one workflow in a rolling hour. */
  perWorkflowRunsPerHour: number;
}

export function limitsFromEnv(): GovernorLimits {
  return {
    dailyCostUsdCeiling: positiveNumber(process.env.DAILY_COST_USD_CEILING, 5),
    perWorkflowRunsPerHour: positiveNumber(
      process.env.WORKFLOW_RUNS_PER_HOUR,
      30,
    ),
  };
}

export type RefusalKind =
  "KillSwitchEngaged" | "DailyCostCapExceeded" | "WorkflowRateLimitExceeded";

export type GovernorVerdict =
  { allowed: true } | { allowed: false; kind: RefusalKind; message: string };

export async function checkGovernor(
  workflow: Workflow,
  input: {
    store: RunStore;
    flags: FlagStore;
    limits: GovernorLimits;
    now?: Date;
  },
): Promise<GovernorVerdict> {
  const now = input.now ?? new Date();

  if (await input.flags.isEnabled(KILL_SWITCH_KEY)) {
    return {
      allowed: false,
      kind: "KillSwitchEngaged",
      message: `Kill switch is engaged. ${workflow.id} was not started.`,
    };
  }

  const spent = await input.store.costUsdSince(
    new Date(now.getTime() - 24 * 60 * 60_000),
  );
  if (spent >= input.limits.dailyCostUsdCeiling) {
    return {
      allowed: false,
      kind: "DailyCostCapExceeded",
      message: `Daily cost ceiling reached: ${spent} of ${input.limits.dailyCostUsdCeiling} USD in the last 24 hours. ${workflow.id} was not started.`,
    };
  }

  const recentRuns = await input.store.runCountSince(
    workflow.id,
    new Date(now.getTime() - 60 * 60_000),
  );
  if (recentRuns >= input.limits.perWorkflowRunsPerHour) {
    return {
      allowed: false,
      kind: "WorkflowRateLimitExceeded",
      message: `Rate limit reached: ${recentRuns} runs of ${workflow.id} in the last hour, ceiling ${input.limits.perWorkflowRunsPerHour}. It was not started.`,
    };
  }

  return { allowed: true };
}

export type GuardedRunResult =
  | { started: true; run: RunWorkflowResult }
  | { started: false; kind: RefusalKind; message: string };

/**
 * The scheduler's entry point. A refused workflow raises an exception and
 * stops; it never silently degrades into a partial run.
 *
 * A refusal writes no `runs` row, deliberately. KPI #4's denominator is
 * attempted runs, and a workflow the system declined to start was not
 * attempted. Counting administrative pauses as workflow failures would make the
 * success rate a measure of how long the kill switch was on. The refusal is
 * visible as an `exceptions` row instead, which is where an operator looks.
 */
export async function runGuardedWorkflow(
  workflow: Workflow,
  options: RunWorkflowOptions & {
    flags: FlagStore;
    limits: GovernorLimits;
  },
): Promise<GuardedRunResult> {
  const verdict = await checkGovernor(workflow, {
    store: options.store,
    flags: options.flags,
    limits: options.limits,
    now: options.now?.(),
  });

  if (!verdict.allowed) {
    await options.store.recordException({
      workflowId: workflow.id,
      kind: verdict.kind,
      severity: "critical",
      message: verdict.message,
    });
    return { started: false, kind: verdict.kind, message: verdict.message };
  }

  return { started: true, run: await runWorkflow(workflow, options) };
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
