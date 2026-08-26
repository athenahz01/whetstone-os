import { describe, expect, it, vi } from "vitest";
import {
  KILL_SWITCH_KEY,
  limitsFromEnv,
  runGuardedWorkflow,
} from "../lib/core/governor";
import {
  MemoryFlagStore,
  MemoryRunStore,
  step,
  testWorkflow,
} from "./run-helpers";

const LIMITS = { dailyCostUsdCeiling: 5, perWorkflowRunsPerHour: 3 };

describe("kill switch, cost cap and rate limit", () => {
  it("stops scheduled work through the DB flag, with no run row written", async () => {
    const store = new MemoryRunStore();
    const flags = new MemoryFlagStore();
    const worked = vi.fn(async () => "did work");
    await flags.setEnabled(KILL_SWITCH_KEY, true);

    const result = await runGuardedWorkflow(
      testWorkflow({ steps: [step("work", worked)] }),
      { store, flags, limits: LIMITS, trigger: "vercel-cron" },
    );

    expect(result).toMatchObject({
      started: false,
      kind: "KillSwitchEngaged",
    });
    expect(worked).not.toHaveBeenCalled();
    expect(store.runs).toEqual([]);
    expect(store.exceptions[0]).toMatchObject({
      kind: "KillSwitchEngaged",
      severity: "critical",
      workflowId: "T1.mock",
    });
  });

  it("releases the work again when the flag is cleared", async () => {
    const store = new MemoryRunStore();
    const flags = new MemoryFlagStore();
    await flags.setEnabled(KILL_SWITCH_KEY, true);
    const options = {
      store,
      flags,
      limits: LIMITS,
      trigger: "vercel-cron",
    };

    await runGuardedWorkflow(testWorkflow(), options);
    expect(store.runs).toHaveLength(0);

    await flags.setEnabled(KILL_SWITCH_KEY, false);
    const second = await runGuardedWorkflow(testWorkflow(), options);
    expect(second.started).toBe(true);
    expect(store.runs).toHaveLength(1);
  });

  it("trips the cost cap into an exception rather than degrading quietly", async () => {
    const store = new MemoryRunStore();
    const flags = new MemoryFlagStore();
    const options = {
      store,
      flags,
      limits: LIMITS,
      trigger: "vercel-cron",
    };

    const expensive = testWorkflow({
      steps: [
        step("spend", async (context) => {
          context.reportCost(5.5);
          return "spent";
        }),
      ],
    });
    const first = await runGuardedWorkflow(expensive, options);
    expect(first.started).toBe(true);
    expect(store.runs[0].costUsd).toBe(5.5);

    const worked = vi.fn(async () => "did work");
    const second = await runGuardedWorkflow(
      testWorkflow({ steps: [step("work", worked)] }),
      options,
    );

    expect(second).toMatchObject({
      started: false,
      kind: "DailyCostCapExceeded",
    });
    expect(worked).not.toHaveBeenCalled();
    expect(store.runs).toHaveLength(1);
    expect(store.exceptions.at(-1)).toMatchObject({
      kind: "DailyCostCapExceeded",
      severity: "critical",
    });
  });

  it("rate limits one workflow without stopping the others", async () => {
    const store = new MemoryRunStore();
    const flags = new MemoryFlagStore();
    const options = {
      store,
      flags,
      limits: LIMITS,
      trigger: "vercel-cron",
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await runGuardedWorkflow(testWorkflow(), options);
      expect(result.started, `attempt ${attempt}`).toBe(true);
    }

    const fourth = await runGuardedWorkflow(testWorkflow(), options);
    expect(fourth).toMatchObject({
      started: false,
      kind: "WorkflowRateLimitExceeded",
    });

    const other = await runGuardedWorkflow(
      testWorkflow({ id: "T2.other" }),
      options,
    );
    expect(other.started).toBe(true);
  });

  it("reads its ceilings from env with safe defaults", () => {
    expect(limitsFromEnv()).toEqual({
      dailyCostUsdCeiling: 5,
      perWorkflowRunsPerHour: 30,
    });
    vi.stubEnv("DAILY_COST_USD_CEILING", "12.5");
    vi.stubEnv("WORKFLOW_RUNS_PER_HOUR", "8");
    expect(limitsFromEnv()).toEqual({
      dailyCostUsdCeiling: 12.5,
      perWorkflowRunsPerHour: 8,
    });
    vi.stubEnv("DAILY_COST_USD_CEILING", "not-a-number");
    expect(limitsFromEnv().dailyCostUsdCeiling).toBe(5);
    vi.unstubAllEnvs();
  });
});
