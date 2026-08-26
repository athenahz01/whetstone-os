import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  ApprovalRequiredError,
  runWorkflow,
  type ExternalAction,
} from "../lib/core/workflow";
import { MemoryRunStore, step, testWorkflow } from "./run-helpers";

function sendAction(spy: () => void): ExternalAction<string> {
  return {
    name: "send-outreach-draft",
    async perform() {
      spy();
      return "sent";
    },
  };
}

describe("approval enforcement", () => {
  it("refuses a YELLOW workflow that reaches an external surface with no approval row", async () => {
    const store = new MemoryRunStore();
    const performed = vi.fn();
    const workflow = testWorkflow({
      approvalLevel: "YELLOW",
      steps: [
        step("bypass-attempt", async (context) =>
          context.external(sendAction(performed)),
        ),
      ],
    });

    const result = await runWorkflow(workflow, { store, trigger: "test" });

    expect(performed).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.failedSteps).toEqual(["bypass-attempt"]);
    expect(store.stepsFor(result.runId)[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("ApprovalRequiredError"),
    });
    expect(store.exceptions[0]).toMatchObject({
      kind: "ApprovalRequiredError",
      severity: "critical",
    });
  });

  it("lets the same workflow through once a human approval row exists", async () => {
    const store = new MemoryRunStore();
    // The approval is attached to the run that will send. MemoryRunStore names
    // its first run "run-1", so seeding it here is the human having approved
    // before this run reaches the external step.
    store.approve("run-1");
    const performed = vi.fn();
    const result = await runWorkflow(
      testWorkflow({
        approvalLevel: "YELLOW",
        steps: [
          step("send", async (context) =>
            context.external(sendAction(performed)),
          ),
        ],
      }),
      { store, trigger: "test" },
    );

    expect(result.runId).toBe("run-1");
    expect(performed).toHaveBeenCalledOnce();
    expect(result.status).toBe("succeeded");
    expect(store.exceptions).toEqual([]);
  });

  it("does not accept a rejection or an unsigned row as approval", async () => {
    for (const approval of [
      { decision: "reject" as const },
      { approvedBy: "" },
      { approvedBy: "   " },
    ]) {
      const store = new MemoryRunStore();
      store.approve("run-1", approval);
      const performed = vi.fn();
      const result = await runWorkflow(
        testWorkflow({
          approvalLevel: "YELLOW",
          steps: [
            step("send", async (context) =>
              context.external(sendAction(performed)),
            ),
          ],
        }),
        { store, trigger: "test" },
      );
      expect(performed, JSON.stringify(approval)).not.toHaveBeenCalled();
      expect(result.status).toBe("failed");
    }
  });

  it("lets a GREEN workflow act, because nothing it does leaves the building", async () => {
    const store = new MemoryRunStore();
    const performed = vi.fn();
    const result = await runWorkflow(
      testWorkflow({
        approvalLevel: "GREEN",
        steps: [
          step("act", async (context) =>
            context.external({
              name: "write-metrics-rollup",
              async perform() {
                performed();
                return "written";
              },
            }),
          ),
        ],
      }),
      { store, trigger: "test" },
    );

    expect(performed).toHaveBeenCalledOnce();
    expect(result.status).toBe("succeeded");
  });

  it("routes every external action through the gate, with no second door", async () => {
    const source = await readFile(
      new URL("../lib/core/workflow.ts", import.meta.url),
      "utf8",
    );
    const externalCalls = source.match(/action\.perform\(\)/g) ?? [];
    expect(externalCalls).toHaveLength(1);
    expect(source).toMatch(/throw new ApprovalRequiredError/);
    expect(ApprovalRequiredError.name).toBe("ApprovalRequiredError");
  });
});
