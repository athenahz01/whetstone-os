import { beforeEach, describe, expect, it } from "vitest";
import {
  assertRegistrable,
  clearRegistry,
  InvalidWorkflowError,
  registeredWorkflowIds,
  registerWorkflow,
} from "../lib/core/registry";
import {
  runWorkflow,
  UndeclaredMeasureError,
  type Workflow,
} from "../lib/core/workflow";
import { MemoryRunStore, step, testWorkflow } from "./run-helpers";

describe("workflow contract", () => {
  beforeEach(() => clearRegistry());

  it("produces a complete record: run, steps, QA verdict, handoff, measurements", async () => {
    const store = new MemoryRunStore();
    const workflow = testWorkflow({
      steps: [
        step("prepare", async () => ({ items: 3 })),
        step("summarize", async (context) => {
          const prepared = context.outputs.get("prepare") as { items: number };
          context.measure("t1.items", prepared.items, "items");
          context.reportCost(0.02);
          context.reportHumanMinutes(2);
          return { summarized: prepared.items };
        }),
      ],
      qaGates: [
        {
          id: "summary-exists",
          describe: "The summarize step produced a count.",
          check: ({ outputs }) => outputs.has("summarize"),
        },
      ],
    });

    const result = await runWorkflow(workflow, {
      store,
      trigger: "test",
    });

    expect(result.status).toBe("succeeded");
    expect(result.handedOff).toBe(true);

    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]).toMatchObject({
      workflowId: "T1.mock",
      trigger: "test",
      status: "succeeded",
      humanMinutes: 2,
      costUsd: 0.02,
      humanRescue: false,
      baselineMinutes: 5,
    });

    const steps = store.stepsFor(result.runId);
    expect(steps.map((entry) => entry.step)).toEqual([
      "prepare",
      "summarize",
      "handoff",
    ]);
    expect(steps.every((entry) => entry.status === "succeeded")).toBe(true);
    expect(steps[2].outputRef).toBe("Athena Huo:ready for review");

    expect(store.measurements).toEqual([
      { runId: result.runId, kpi: "t1.items", value: 3, unit: "items" },
    ]);
    expect(store.exceptions).toEqual([]);
  });

  it("records a failed QA gate as an exception and withholds the handoff", async () => {
    const store = new MemoryRunStore();
    const workflow = testWorkflow({
      qaGates: [
        {
          id: "impossible",
          describe: "A gate that cannot pass.",
          check: () => false,
        },
      ],
    });

    const result = await runWorkflow(workflow, { store, trigger: "test" });

    expect(result.status).toBe("failed");
    expect(result.handedOff).toBe(false);
    expect(result.failedSteps).toEqual(["qa:impossible"]);
    expect(store.stepsFor(result.runId).map((entry) => entry.step)).toEqual([
      "prepare",
    ]);
    expect(store.exceptions[0]).toMatchObject({
      kind: "QaGateFailedError",
      severity: "critical",
    });
    expect(store.measurements).toEqual([]);
  });

  it("refuses a measure the workflow does not declare", async () => {
    const store = new MemoryRunStore();
    const workflow = testWorkflow({
      steps: [
        step("prepare", async (context) => {
          context.measure("t1.undeclared", 1, "items");
          return null;
        }),
      ],
    });

    const result = await runWorkflow(workflow, { store, trigger: "test" });

    expect(result.status).toBe("failed");
    expect(store.exceptions[0]).toMatchObject({
      kind: UndeclaredMeasureError.name,
    });
  });

  it("stores a reference to each step output, never its content", async () => {
    const store = new MemoryRunStore();
    const secret = "My daughter is applying early decision.";
    const workflow = testWorkflow({
      steps: [step("prepare", async () => ({ text: secret }))],
    });

    const result = await runWorkflow(workflow, { store, trigger: "test" });

    const serialized = JSON.stringify(store.stepsFor(result.runId));
    expect(serialized).not.toContain(secret);
    expect(store.stepsFor(result.runId)[0].outputRef).toBe("object:1 keys");
  });

  it("registers by id and refuses a workflow missing a contract field", () => {
    registerWorkflow(testWorkflow());
    registerWorkflow(testWorkflow({ id: "T2.other" }));
    expect(registeredWorkflowIds()).toEqual(["T1.mock", "T2.other"]);

    const missing: [string, Partial<Workflow>][] = [
      ["owner must be a person", { owner: "the system" }],
      ["tools", { tools: [] }],
      ["outputs", { outputs: [] }],
      ["measures", { measures: [] }],
      ["handoff", { handoff: { to: "", state: "" } }],
      ["id", { id: "not-a-registry-id" }],
    ];
    for (const [reason, override] of missing) {
      expect(
        () => assertRegistrable(testWorkflow(override)),
        reason,
      ).toThrowError(InvalidWorkflowError);
    }
  });

  it("reserves the handoff step id so the recorded stage cannot be faked", () => {
    expect(() =>
      assertRegistrable(
        testWorkflow({ steps: [step("handoff", async () => null)] }),
      ),
    ).toThrowError(InvalidWorkflowError);
  });
});
