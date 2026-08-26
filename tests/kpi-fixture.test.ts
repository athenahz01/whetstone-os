import { readFile } from "node:fs/promises";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  computeHumanTimeSaved,
  computeOutputAcceptance,
  computeWorkflowSuccess,
  computeWorkingWorkflows,
  describeQualifiedSalesOutput,
  KpiRepository,
  MINOR_EDIT_THRESHOLD,
} from "../lib/core/kpi";

/**
 * The fixture is deliberately small enough to recompute by hand.
 *
 * Seven attempted runs. Run 2 succeeded but was rescued by a human. Run 3
 * failed at its first step. Both are in KPI #4's denominator; neither is in its
 * numerator. Those two rows are the whole reason this KPI means anything.
 */
const RUNS = [
  {
    workflowId: "S1.ingest",
    status: "succeeded",
    humanRescue: false,
    baselineMinutes: 5,
    humanMinutes: 1,
  },
  {
    workflowId: "S1.ingest",
    status: "succeeded",
    humanRescue: true,
    baselineMinutes: 5,
    humanMinutes: 4,
  },
  {
    workflowId: "S1.ingest",
    status: "failed",
    humanRescue: false,
    baselineMinutes: 5,
    humanMinutes: 0,
  },
  {
    workflowId: "S2.research",
    status: "succeeded",
    humanRescue: false,
    baselineMinutes: 15,
    humanMinutes: 3,
  },
  {
    workflowId: "S2.research",
    status: "failed",
    humanRescue: false,
    baselineMinutes: 15,
    humanMinutes: 2,
  },
  {
    workflowId: "S3.draft",
    status: "succeeded",
    humanRescue: false,
    baselineMinutes: 10,
    humanMinutes: 2,
  },
  {
    workflowId: "S3.draft",
    status: "succeeded",
    humanRescue: false,
    baselineMinutes: 10,
    humanMinutes: 2,
  },
];

/** Six reviewed outputs: a draft, a research brief and content alike. */
const APPROVALS = [
  { editDistance: 0.05, requiredNewResearch: false },
  { editDistance: 0.19, requiredNewResearch: false },
  { editDistance: 0.2, requiredNewResearch: false },
  { editDistance: 0.35, requiredNewResearch: false },
  { editDistance: 0.02, requiredNewResearch: true },
  { editDistance: 0.1, requiredNewResearch: false },
];

describe("KPI definitions against a hand-computed fixture", () => {
  it("KPI 1 counts distinct registry ids with an attempted run", () => {
    expect(computeWorkingWorkflows(RUNS)).toBe(3);
  });

  it("KPI 2 credits baseline minutes only for output that was produced", () => {
    expect(computeHumanTimeSaved(RUNS)).toEqual({
      baselineMinutes: 45,
      humanMinutes: 14,
      savedMinutes: 31,
    });
  });

  it("KPI 3 needs both clauses, and exactly the threshold is not a minor edit", () => {
    expect(computeOutputAcceptance(APPROVALS)).toEqual({
      accepted: 3,
      reviewed: 6,
      rate: 0.5,
    });
    expect(
      computeOutputAcceptance([
        { editDistance: 0.2, requiredNewResearch: false },
      ]).accepted,
    ).toBe(0);
    expect(
      computeOutputAcceptance([
        { editDistance: 0.02, requiredNewResearch: true },
      ]).accepted,
    ).toBe(0);
  });

  it("KPI 4 counts attempted runs and excludes rescued ones from the numerator", () => {
    expect(computeWorkflowSuccess(RUNS)).toEqual({
      succeeded: 4,
      attempted: 7,
      rate: 4 / 7,
    });
  });

  it("KPI 4 keeps a run that failed at step one in the denominator", () => {
    const withoutStepOneFailure = RUNS.filter(
      (run) => !(run.workflowId === "S1.ingest" && run.status === "failed"),
    );
    expect(computeWorkflowSuccess(withoutStepOneFailure).attempted).toBe(6);
    expect(computeWorkflowSuccess(RUNS).attempted).toBe(7);
  });

  it("KPI 4 excludes a rescued run by fixture, not by assertion about status", () => {
    const rescued = [
      { status: "succeeded", humanRescue: true },
      { status: "succeeded", humanRescue: false },
    ];
    expect(computeWorkflowSuccess(rescued)).toEqual({
      succeeded: 1,
      attempted: 2,
      rate: 0.5,
    });
  });

  it("KPI 5 reports prepared-and-ready and says its verdict clause is not built", () => {
    expect(describeQualifiedSalesOutput(4)).toEqual({
      readyForApproval: 4,
      verdictClauseImplemented: false,
    });
  });

  it("returns null rather than a flattering zero when nothing was measured", () => {
    expect(computeWorkflowSuccess([]).rate).toBeNull();
    expect(computeOutputAcceptance([]).rate).toBeNull();
  });

  it("keeps the minor-edit threshold identical to the one frozen in BASELINES.md", async () => {
    const baselines = await readFile(
      new URL("../docs/BASELINES.md", import.meta.url),
      "utf8",
    );
    const frozen = baselines.match(
      /normalized_distance\s*<\s*(\d+\.\d+)\s+AND\s+required_new_research\s*=\s*false/,
    );
    expect(
      frozen,
      "BASELINES.md no longer states the minor_edit formula",
    ).toBeTruthy();
    expect(Number(frozen?.[1])).toBe(MINOR_EDIT_THRESHOLD);
    expect(baselines).toMatch(/Exactly `?0\.20`? is not a minor edit/);
  });
});

describe("KPI queries are one indexed read each", () => {
  type Query = { where: Record<string, unknown> };

  function recordingClient() {
    const runFindMany = vi.fn<(query: Query) => Promise<typeof RUNS>>(
      async () => RUNS,
    );
    const approvalFindMany = vi.fn<(query: Query) => Promise<typeof APPROVALS>>(
      async () => APPROVALS,
    );
    const leadCount = vi.fn<(query: Query) => Promise<number>>(async () => 4);
    const client = {
      run: { findMany: runFindMany },
      approval: { findMany: approvalFindMany },
      lead: { count: leadCount },
    } as unknown as PrismaClient;
    return { client, runFindMany, approvalFindMany, leadCount };
  }

  const window = {
    from: new Date("2026-08-01T00:00:00.000Z"),
    to: new Date("2026-09-01T00:00:00.000Z"),
  };

  it("issues exactly one query per KPI and no N+1", async () => {
    const { client, runFindMany, approvalFindMany, leadCount } =
      recordingClient();
    const kpis = new KpiRepository(client);

    await expect(kpis.workingWorkflows(window)).resolves.toBe(3);
    await expect(kpis.humanTimeSaved(window)).resolves.toMatchObject({
      savedMinutes: 31,
    });
    await expect(kpis.outputAcceptance(window)).resolves.toMatchObject({
      rate: 0.5,
    });
    await expect(kpis.workflowSuccess(window)).resolves.toMatchObject({
      attempted: 7,
    });
    await expect(kpis.qualifiedSalesOutput(window)).resolves.toMatchObject({
      readyForApproval: 4,
    });

    expect(runFindMany).toHaveBeenCalledTimes(3);
    expect(approvalFindMany).toHaveBeenCalledTimes(1);
    expect(leadCount).toHaveBeenCalledTimes(1);
  });

  it("scopes every read to the tenant and the window", async () => {
    const { client, runFindMany, approvalFindMany, leadCount } =
      recordingClient();
    const kpis = new KpiRepository(client);
    await kpis.workflowSuccess(window);
    await kpis.outputAcceptance(window);
    await kpis.qualifiedSalesOutput(window);

    for (const [query] of [
      runFindMany.mock.calls[0],
      approvalFindMany.mock.calls[0],
      leadCount.mock.calls[0],
    ]) {
      expect(query.where.orgId).toBe("00000000-0000-0000-0000-000000000001");
      expect(JSON.stringify(query.where)).toContain("2026-08-01");
    }
  });
});
