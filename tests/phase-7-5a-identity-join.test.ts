import { describe, expect, it } from "vitest";
import { mergeCrmSources, splitLeadRefs } from "../lib/crm/merge";
import {
  SplitCrmLeadError,
  writeMergeResult,
  type CrmRepository,
} from "../lib/crm/import";

/**
 * What the old two-file export is allowed to shrug at.
 *
 * Spelled out rather than defaulted. `ug_sales::U036` is one fact about one row
 * of one export - two named students really do share that ID - and it used to
 * be a default every caller inherited without seeing it.
 */
const OLD_EXPORT_ALLOWANCES = { knownSplitLeadRefs: ["ug_sales::U036"] };

/**
 * The audit of `fa62750` ran the merge against the live export. 43 lead
 * references are shared between the two files, but only 40 joined: U045, U046
 * and U047 are named in `!Dashboard` and nameless in the copy, so keying
 * identity on the name split each into two records sharing one reference - one
 * holding the sales funnel, the other holding the academic columns.
 *
 * The reconciliation reported `balanced: true`, because it counts source rows
 * and every row was accounted for. These are the assertions that were missing.
 */

const row = (
  source: "dashboard" | "dashboard_copy",
  n: number,
  cells: Record<string, string>,
) => ({ source, tab: "ug_sales", rowNumber: n, cells }) as never;

const recorder = () => {
  const leads: unknown[] = [];
  const repo: CrmRepository = {
    upsertLead: async (lead: unknown) => void leads.push(lead),
    upsertDispute: async () => undefined,
    upsertRejection: async () => undefined,
    recordImportRun: async () => undefined,
    applyRuling: async () => undefined,
  } as unknown as CrmRepository;
  return { repo, leads };
};

describe("a nameless row joins its named twin", () => {
  it("U045: named in the primary, nameless in the copy, joins as one lead", () => {
    const result = mergeCrmSources(
      [
        row("dashboard", 2, {
          ID: "U045",
          "S First": "Emily",
          Status: "Active",
        }),
      ],
      [row("dashboard_copy", 2, { ID: "U045", SAT: "1520" })],
    );
    expect(result.leads).toHaveLength(1);
    expect(result.leads[0]!.sources.sort()).toEqual([
      "dashboard",
      "dashboard_copy",
    ]);
    expect(result.reconciliation.merged).toBe(1);
    expect(result.reconciliation.copyOnly).toBe(0);
    expect(result.reconciliation.splitLeadRefs).toEqual([]);
  });

  it("joins the same way when the nameless row is read first", () => {
    const named = row("dashboard", 2, {
      ID: "U046",
      "S First": "Terrence",
      "S Last": "Liu",
    });
    const nameless = row("dashboard_copy", 2, { ID: "U046", SAT: "1480" });
    expect(mergeCrmSources([nameless], [named]).leads).toHaveLength(1);
    expect(mergeCrmSources([named], [nameless]).leads).toHaveLength(1);
  });

  it("a partial name is still a different student and does not join", () => {
    // "Terrence" and "Terrence Liu" are not the same key. This one stays split
    // on purpose: a missing surname is not the same as a missing name.
    const result = mergeCrmSources(
      [
        row("dashboard", 2, {
          ID: "U046",
          "S First": "Terrence",
          "S Last": "Liu",
        }),
      ],
      [row("dashboard_copy", 2, { ID: "U046", "S First": "Terrence" })],
    );
    expect(result.reconciliation.splitLeadRefs).toEqual(["ug_sales::U046"]);
  });
});

describe("U036, where two named students share one ID", () => {
  const hamza = row("dashboard", 2, {
    ID: "U036",
    "S First": "Hamza",
    "S Last": "Benyass",
    Status: "Prospect",
  });
  const jack = row("dashboard", 3, {
    ID: "U036",
    "S First": "Jack",
    "S Last": "Yu",
    Status: "Negotiate",
  });

  it("stays two records", () => {
    const result = mergeCrmSources([hamza, jack], []);
    expect(result.leads).toHaveLength(2);
    expect(result.reconciliation.splitLeadRefs).toEqual(["ug_sales::U036"]);
  });

  it("refuses to guess which of the two a nameless row belongs to", () => {
    const result = mergeCrmSources(
      [hamza, jack],
      [row("dashboard_copy", 2, { ID: "U036", SAT: "1500" })],
    );
    expect(result.leads).toHaveLength(2);
    expect(result.rejections).toHaveLength(1);
    expect(result.rejections[0]!.reason).toContain(
      "cannot be joined without guessing",
    );
    // Rejected, not dropped: the row still balances.
    expect(result.reconciliation.balanced).toBe(true);
  });
});

describe("the write boundary refuses an undeclared split", () => {
  it("writes nothing when a lead reference produced two records by accident", async () => {
    const { repo, leads } = recorder();
    const result = mergeCrmSources(
      [
        row("dashboard", 2, {
          ID: "U046",
          "S First": "Terrence",
          "S Last": "Liu",
        }),
      ],
      [row("dashboard_copy", 2, { ID: "U046", "S First": "Terrence" })],
    );
    await expect(
      writeMergeResult(repo, result, OLD_EXPORT_ALLOWANCES),
    ).rejects.toBeInstanceOf(SplitCrmLeadError);
    expect(leads).toHaveLength(0);
  });

  it("allows the declared U036 split through", async () => {
    const { repo, leads } = recorder();
    const result = mergeCrmSources(
      [
        row("dashboard", 2, {
          ID: "U036",
          "S First": "Hamza",
          "S Last": "Benyass",
        }),
        row("dashboard", 3, { ID: "U036", "S First": "Jack", "S Last": "Yu" }),
      ],
      [],
    );
    await writeMergeResult(repo, result, OLD_EXPORT_ALLOWANCES);
    expect(leads).toHaveLength(2);
  });

  it("balance alone cannot catch a failed join, which is why the split check exists", () => {
    const result = mergeCrmSources(
      [
        row("dashboard", 2, {
          ID: "U046",
          "S First": "Terrence",
          "S Last": "Liu",
        }),
      ],
      [row("dashboard_copy", 2, { ID: "U046", "S First": "Terrence" })],
    );
    expect(result.reconciliation.balanced).toBe(true);
    expect(result.reconciliation.splitLeadRefs).not.toEqual([]);
  });

  it("splitLeadRefs names the reference, not the count", () => {
    expect(
      splitLeadRefs([
        { identity: "a", leadRef: "U1", tab: "ug_sales" },
        { identity: "b", leadRef: "U1", tab: "ug_sales" },
        { identity: "c", leadRef: "U2", tab: "ug_sales" },
      ] as never),
    ).toEqual(["ug_sales::U1"]);
  });
});
