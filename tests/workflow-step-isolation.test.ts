import { describe, expect, it, vi } from "vitest";
import { GrowthEngine } from "../lib/core/engine";
import { StubDraftService } from "../lib/core/drafting";
import { runWorkflow } from "../lib/core/workflow";
import { createIngestWorkflow } from "../lib/workflows/s1-ingest";
import type { ChannelAdapter } from "../lib/core/types";
import { lead, MemoryLeadStore } from "./helpers";
import { MemoryRunStore, step, testWorkflow } from "./run-helpers";

function adapter(name: string, poll: ChannelAdapter["poll"]): ChannelAdapter {
  return {
    name,
    poll,
    async send() {
      return {};
    },
  };
}

describe("per-step failure isolation", () => {
  it("runs the steps after a failing one and still records the run as failed", async () => {
    const store = new MemoryRunStore();
    const third = vi.fn(async () => "third ran");
    const result = await runWorkflow(
      testWorkflow({
        steps: [
          step("first", async () => "first ran"),
          step("second", async () => {
            throw new Error("step two blew up");
          }),
          step("third", third),
        ],
      }),
      { store, trigger: "test" },
    );

    expect(third).toHaveBeenCalledOnce();
    expect(result.failedSteps).toEqual(["second"]);
    expect(result.status).toBe("failed");
    expect(result.outputs.get("first")).toBe("first ran");
    expect(result.outputs.get("third")).toBe("third ran");

    const steps = store.stepsFor(result.runId);
    expect(steps.map((entry) => [entry.step, entry.status])).toEqual([
      ["first", "succeeded"],
      ["second", "failed"],
      ["third", "succeeded"],
    ]);
    expect(steps.some((entry) => entry.step === "handoff")).toBe(false);
    expect(store.exceptions).toHaveLength(1);
  });

  it("never throws out of runWorkflow, so one workflow cannot kill the caller", async () => {
    const store = new MemoryRunStore();
    await expect(
      runWorkflow(
        testWorkflow({
          steps: [
            step("explode", async () => {
              throw new Error("boom");
            }),
          ],
        }),
        { store, trigger: "test" },
      ),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("keeps adapter isolation inside the engine while making the failure visible", async () => {
    const store = new MemoryRunStore();
    const healthy = adapter("healthy", async () => [lead()]);
    const broken = adapter("broken", async () => {
      throw new Error("wyzant session expired");
    });

    const workflow = createIngestWorkflow({
      adapters: [broken, healthy],
      createEngine: (adapters) =>
        new GrowthEngine({
          adapters,
          store: new MemoryLeadStore(),
          drafts: new StubDraftService(),
          alerts: { isEnabled: () => false, notify: async () => undefined },
        }),
    });

    const result = await runWorkflow(workflow, { store, trigger: "test" });

    expect(result.status).toBe("succeeded");
    expect(result.outputs.get("poll-and-ingest")).toEqual({
      polled: 1,
      inserted: 1,
      deduped: 0,
    });
    expect(store.exceptions).toEqual([
      {
        runId: result.runId,
        workflowId: "S1.ingest",
        kind: "AdapterPollFailed",
        severity: "warning",
        message: "broken: Error",
      },
    ]);
  });

  it("counts the ingest tick as an attempted run rather than orchestrating beside it", async () => {
    const store = new MemoryRunStore();
    const workflow = createIngestWorkflow({
      adapters: [],
      createEngine: () => ({
        async tick() {
          throw new Error("lead store unreachable");
        },
      }),
    });

    const result = await runWorkflow(workflow, {
      store,
      trigger: "vercel-cron",
    });

    expect(result.status).toBe("failed");
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({
      workflowId: "S1.ingest",
      trigger: "vercel-cron",
      status: "failed",
    });
    expect(store.stepsFor(result.runId)[0]).toMatchObject({
      step: "poll-and-ingest",
      status: "failed",
    });
  });
});
