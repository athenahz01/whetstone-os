import { describe, expect, it } from "vitest";
import { ReengagementAdapter } from "../lib/adapters/reengagement";
import { ReferralsAdapter } from "../lib/adapters/referrals";
import { dedupeAcrossAdapters } from "../lib/core/prospect-dedupe";
import { readQualification } from "../lib/core/qualification";
import { createQualifyWorkflow } from "../lib/workflows/s1-qualify";
import { runWorkflow } from "../lib/core/workflow";
import { MemoryRunStore } from "./run-helpers";

const consent = {
  recordedAt: "2026-01-10T12:00:00.000Z",
  source: "Signup checkbox",
  scope: "Tutoring email follow-up",
};

describe("Phase 3 cross-adapter dedupe and workflow", () => {
  it("merges the same strong identity across adapters while preserving source ids", async () => {
    const first = await new ReengagementAdapter([
      {
        id: "dormant-1",
        name: "Same Person",
        email: "same@example.test",
        subject: "English",
        notes: "Grade 10 student needs English tutoring this semester.",
        consent,
      },
    ]).poll();
    const second = await new ReferralsAdapter([
      {
        id: "referral-2",
        name: "Same Person",
        email: "same@example.test",
        contactType: "consented_contact",
        subject: "English",
        notes: "Grade 10 student needs English tutoring this semester.",
        consent,
      },
    ]).poll();
    expect(first[0].id).not.toBe(second[0].id);
    const merged = dedupeAcrossAdapters([...first, ...second]);
    expect(merged.leads).toHaveLength(1);
    expect(merged.deduped).toBe(1);
    expect(merged.leads[0].raw).toMatchObject({
      duplicateSourceIds: [second[0].id],
    });
  });

  it("does not merge two people merely because their display names match", async () => {
    const [first] = await new ReengagementAdapter([
      { name: "Common Name", email: "one@example.test", consent },
    ]).poll();
    const [second] = await new ReengagementAdapter([
      { name: "Common Name", email: "two@example.test", consent },
    ]).poll();
    expect(dedupeAcrossAdapters([first, second]).leads).toHaveLength(2);
  });

  it("records S1.qualify and its KPI 5 leading indicator without claiming KPI completion", async () => {
    const store = new MemoryRunStore();
    const adapter = new ReengagementAdapter([
      {
        name: "Qualified sample",
        email: "qualified@example.test",
        subject: "SAT Reading",
        notes: "Grade 11 student needs a focused SAT Reading plan this fall.",
        consent,
      },
    ]);
    const result = await runWorkflow(
      createQualifyWorkflow({ adapters: [adapter] }),
      {
        store,
        trigger: "fixture",
      },
    );
    expect(result.status).toBe("succeeded");
    const batch = result.outputs.get("poll-dedupe-qualify") as {
      leads: ReturnType<typeof Array.prototype.slice>;
      verdictCounts: { icp_pass: number };
    };
    expect(batch.verdictCounts.icp_pass).toBe(1);
    expect(readQualification(batch.leads[0])?.verdict).toBe("icp_pass");
    expect(store.measurements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kpi: "s1.icp_pass_leading_indicator",
          value: 1,
          unit: "prospects",
        }),
      ]),
    );
  });
});
