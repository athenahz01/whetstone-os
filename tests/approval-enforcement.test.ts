import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  GRANTING_DECISIONS,
  PrismaRunStore,
  type ApprovalDecision,
} from "../lib/core/run-store";
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
      { decision: "pending" as unknown as ApprovalDecision },
      { approvedBy: "" },
      { approvedBy: "   " },
      { approvedBy: "\t\n" },
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

/**
 * The store and its test double must agree, or the suite proves a property
 * production does not have. A double that is stricter than the query hides a
 * clause; a double that is looser lets a test pass on behaviour production
 * would refuse. This block probes each clause of the guard rather than the
 * guard's presence.
 */
describe("the approval query and its test double agree clause by clause", () => {
  it("filters on an allowlist of decisions and a non-empty approved_by", async () => {
    const findFirst = vi.fn<
      (query: { where: Record<string, unknown> }) => Promise<null>
    >(async () => null);
    const client = { approval: { findFirst } } as unknown as PrismaClient;

    await new PrismaRunStore(client).findGrantingApproval("run-1");

    expect(findFirst.mock.calls[0][0].where).toEqual({
      orgId: "00000000-0000-0000-0000-000000000001",
      runId: "run-1",
      decision: { in: ["accept", "accept-with-edits"] },
      approvedBy: { not: "" },
    });
    expect(GRANTING_DECISIONS).toEqual(["accept", "accept-with-edits"]);
    expect(GRANTING_DECISIONS).not.toContain("reject");
  });

  it("returns a whitespace-only approver, because SQL <> '' does not trim", async () => {
    const store = new MemoryRunStore();
    store.approve("run-1", { approvedBy: "   " });

    // The double must NOT filter this out. approved_by is TEXT, so
    // `approved_by <> ''` is TRUE for "   " and the row comes back. Making the
    // double stricter here is what hid the trim in workflow.ts from the suite.
    await expect(store.findGrantingApproval("run-1")).resolves.toMatchObject({
      approvedBy: "   ",
    });
  });

  it("refuses that same row one layer up, in the workflow gate", async () => {
    const store = new MemoryRunStore();
    store.approve("run-1", { approvedBy: "   " });
    const performed = vi.fn();

    const result = await runWorkflow(
      testWorkflow({
        approvalLevel: "YELLOW",
        steps: [
          step("send", async (context) =>
            context.external({
              name: "send-outreach-draft",
              async perform() {
                performed();
                return "sent";
              },
            }),
          ),
        ],
      }),
      { store, trigger: "test" },
    );

    expect(performed).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(store.exceptions[0]).toMatchObject({
      kind: "ApprovalRequiredError",
    });
  });

  it("grants only for the decisions on the allowlist", async () => {
    const cases: [ApprovalDecision | string, boolean][] = [
      ["accept", true],
      ["accept-with-edits", true],
      ["reject", false],
      ["pending", false],
      ["", false],
    ];
    for (const [decision, granted] of cases) {
      const store = new MemoryRunStore();
      store.approve("run-1", { decision: decision as ApprovalDecision });
      const approval = await store.findGrantingApproval("run-1");
      expect(Boolean(approval), decision || "(empty)").toBe(granted);
    }
  });

  it("cannot write a blank approver in the first place", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/202608260004_approvals_approved_by_not_blank/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT approvals_approved_by_not_blank CHECK \(btrim\(approved_by\) <> ''\)/,
    );
  });
});
