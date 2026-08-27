import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  actionableValue,
  selectStallCandidates,
  toLeadView,
} from "../lib/crm/actionable";
import {
  importCrmSources,
  rulingList,
  writeMergeResult,
  UnbalancedCrmImportError,
  type CrmImportSummary,
  type CrmRepository,
  type StoredCrmDispute,
  type StoredCrmLead,
} from "../lib/crm/import";
import {
  crmIdentity,
  isBalanced,
  mergeCrmSources,
  type CrmRejection,
  type CrmSourceRow,
} from "../lib/crm/merge";
import {
  isLiveStatus,
  readReferrerSource,
  readStatus,
} from "../lib/crm/vocabulary";

/**
 * The fixture reproduces the shape the audit found, not its people.
 *
 * Names here are invented. The real records carry students who are minors and
 * their parents' contact details, and a test fixture is the wrong place for
 * them: it would put them in the repository, in every clone, forever, to prove
 * something the structure proves on its own.
 *
 * What is faithful is everything the acceptance criteria turn on: the shared
 * IDs, the rows unique to one file, the ID held by two unrelated students, the
 * head-to-head disagreements, the one-sided fills in both directions, the
 * academic columns that exist only in the copy, and a value outside a
 * vocabulary.
 */

let rowCounter = 0;
function row(
  source: CrmSourceRow["source"],
  cells: Record<string, string | undefined>,
  tab: CrmSourceRow["tab"] = "ug_sales",
): CrmSourceRow {
  rowCounter += 1;
  return { source, tab, rowNumber: rowCounter, cells };
}

function dashboard(cells: Record<string, string | undefined>) {
  return row("dashboard", cells);
}
function copy(cells: Record<string, string | undefined>) {
  return row("dashboard_copy", cells);
}
/** The same sheet, a different tab. Tabs are separate pipelines. */
function gSales(cells: Record<string, string | undefined>) {
  return row("dashboard", cells, "g_sales");
}

class MemoryCrmRepository implements CrmRepository {
  readonly leads = new Map<string, StoredCrmLead>();
  readonly disputes = new Map<string, StoredCrmDispute>();
  readonly rejections: CrmRejection[] = [];
  readonly runs: CrmImportSummary[] = [];

  async upsertLead(lead: StoredCrmLead) {
    this.leads.set(lead.identity, structuredClone(lead));
  }
  async upsertDispute(dispute: StoredCrmDispute) {
    const key = `${dispute.identity}::${dispute.field}`;
    const held = this.disputes.get(key);
    // An upsert must not wipe a ruling that already landed.
    this.disputes.set(key, {
      ...structuredClone(dispute),
      resolvedValue: held?.resolvedValue ?? dispute.resolvedValue,
      resolvedBy: held?.resolvedBy ?? dispute.resolvedBy,
      resolvedAt: held?.resolvedAt ?? dispute.resolvedAt,
    });
  }
  async recordRejection(rejection: CrmRejection) {
    if (
      !this.rejections.some(
        (held) =>
          held.source === rejection.source &&
          held.tab === rejection.tab &&
          held.rowNumber === rejection.rowNumber,
      )
    ) {
      this.rejections.push(structuredClone(rejection));
    }
  }
  async recordImportRun(summary: CrmImportSummary) {
    this.runs.push(structuredClone(summary));
  }
  async resolveDispute(input: {
    identity: string;
    field: string;
    resolvedValue: string;
    resolvedBy: string;
    resolvedAt: Date;
  }) {
    const key = `${input.identity}::${input.field}`;
    const dispute = this.disputes.get(key);
    if (!dispute) throw new Error(`no dispute at ${key}`);
    this.disputes.set(key, {
      ...dispute,
      resolvedValue: input.resolvedValue,
      resolvedBy: input.resolvedBy,
      resolvedAt: input.resolvedAt,
    });
    const lead = this.leads.get(input.identity);
    if (lead) {
      lead.values = {
        ...lead.values,
        [input.field]: input.resolvedValue,
      };
    }
  }

  snapshot() {
    return JSON.stringify({
      leads: [...this.leads.entries()].sort(),
      disputes: [...this.disputes.entries()].sort(),
      rejections: this.rejections,
    });
  }
}

function fixture() {
  rowCounter = 0;
  const primary: CrmSourceRow[] = [
    // Shared with the copy, no disagreement.
    dashboard({
      ID: "U001",
      "S First": "Ada",
      "S Last": "Sparrow",
      Status: "Active",
      "Referrer Source": "Direct",
      "Lead Date": "2026-02-03",
    }),
    // Head to head: both files hold a real and different referrer.
    dashboard({
      ID: "U024",
      "S First": "Bea",
      "S Last": "Marlow",
      Status: "Active",
      "Referrer Source": "Direct",
    }),
    // Head to head on a date.
    dashboard({
      ID: "U033",
      "S First": "Cy",
      "S Last": "Okafor",
      Status: "Engage",
      "Due Date": "2026-07-15",
    }),
    // The ID collision: two unrelated students, one of them the only Negotiate.
    dashboard({
      ID: "U036",
      "S First": "Dev",
      "S Last": "Ramanathan",
      Status: "Prospect",
      "Referrer Source": "Direct",
    }),
    dashboard({
      ID: "U036",
      "S First": "Ell",
      "S Last": "Trevino",
      Status: "Negotiate",
      "Referrer Source": "Parent Referral",
    }),
    // Unique to the original, and closed.
    dashboard({
      ID: "U050",
      "S First": "Fay",
      "S Last": "Bright",
      Status: "Complete",
    }),
    // A stage outside the vocabulary.
    dashboard({
      ID: "U060",
      "S First": "Gus",
      "S Last": "Iyer",
      Status: "Warm",
    }),
    // An ID with no student name. 21 rows are in this state.
    dashboard({ ID: "U070", Status: "Cold" }),
    // The same ID and student on a different tab. Tabs number independently,
    // so this is a different lead and must not fold into the UG one.
    gSales({
      ID: "U001",
      "S First": "Ada",
      "S Last": "Sparrow",
      Status: "Prospect",
    }),
    // No stage in the original. The copy supplies it.
    dashboard({
      ID: "U080",
      "S First": "Ivy",
      "S Last": "Nakamura",
      "Referrer Source": "Event",
    }),
    // Not importable: no ID at all.
    dashboard({ "S First": "Hal", Status: "Active" }),
  ];
  const secondary: CrmSourceRow[] = [
    // Adds the academic picture the original cannot hold.
    copy({
      ID: "U001",
      "S First": "Ada",
      "S Last": "Sparrow",
      "Admission Status": "Applied",
      SAT: "1480",
      Capstone: "Robotics",
    }),
    copy({
      ID: "U024",
      "S First": "Bea",
      "S Last": "Marlow",
      "Referrer Source": "Sibling",
      Materials: "Draft essay in",
    }),
    copy({
      ID: "U033",
      "S First": "Cy",
      "S Last": "Okafor",
      "Due Date": "2026-04-02",
    }),
    copy({
      ID: "U036",
      "S First": "Ell",
      "S Last": "Trevino",
      Essays: "Two drafts",
    }),
    // A one-sided fill flowing from the copy into a blank in the original.
    copy({ ID: "U070", "Lead Date": "2026-01-09" }),
    copy({
      ID: "U080",
      "S First": "Ivy",
      "S Last": "Nakamura",
      Status: "Active",
    }),
  ];
  return { primary, secondary };
}

describe("7.5a: nothing is dropped", () => {
  it("accounts for every row read as an import or a rejection", () => {
    const { primary, secondary } = fixture();
    const result = mergeCrmSources(primary, secondary);
    const { reconciliation } = result;
    expect(reconciliation.rowsRead).toBe(primary.length + secondary.length);
    expect(reconciliation.rowsImported + reconciliation.rowsRejected).toBe(
      reconciliation.rowsRead,
    );
    expect(reconciliation.balanced).toBe(true);
  });

  it("names the row it could not import, with a reason and a row number", () => {
    const { primary, secondary } = fixture();
    const result = mergeCrmSources(primary, secondary);
    // Derived from the offending row rather than written as a literal, so the
    // assertion keeps meaning "points at the right row" when the fixture grows.
    const offending = primary.find((candidate) => !candidate.cells.ID);
    expect(offending).toBeDefined();
    expect(result.rejections).toEqual([
      {
        source: "dashboard",
        tab: "ug_sales",
        rowNumber: offending!.rowNumber,
        reason: "row has no ID",
      },
    ]);
  });

  it("does not count a rejected row as imported", () => {
    const { primary, secondary } = fixture();
    const { reconciliation } = mergeCrmSources(primary, secondary);
    expect(reconciliation.rowsRejected).toBe(1);
    expect(reconciliation.rowsImported).toBe(reconciliation.rowsRead - 1);
  });

  it("calls a reconciliation unbalanced when the numbers do not add up", () => {
    expect(isBalanced({ rowsRead: 10, rowsImported: 9, rowsRejected: 1 })).toBe(
      true,
    );
    // A row read that left as neither an import nor a rejection.
    expect(isBalanced({ rowsRead: 10, rowsImported: 8, rowsRejected: 1 })).toBe(
      false,
    );
    // A row counted twice.
    expect(
      isBalanced({ rowsRead: 10, rowsImported: 10, rowsRejected: 1 }),
    ).toBe(false);
  });

  it("writes nothing at all when the reconciliation does not balance", async () => {
    const repository = new MemoryCrmRepository();
    const { primary, secondary } = fixture();
    const result = mergeCrmSources(primary, secondary);
    // A row went missing between reading and importing.
    result.reconciliation.rowsRead += 1;
    result.reconciliation.balanced = false;

    await expect(writeMergeResult(repository, result)).rejects.toThrow(
      UnbalancedCrmImportError,
    );
    // Not one partial write. A half-finished import that looks finished is the
    // failure this phase names first.
    expect(repository.leads.size).toBe(0);
    expect(repository.disputes.size).toBe(0);
    expect(repository.rejections).toHaveLength(0);
    expect(repository.runs).toHaveLength(0);
  });

  it("refuses a summary that claims to balance when its own numbers do not", async () => {
    const repository = new MemoryCrmRepository();
    const { primary, secondary } = fixture();
    const result = mergeCrmSources(primary, secondary);
    result.reconciliation.rowsRead += 1;
    // The flag says it balanced. The numbers beside it say otherwise, and the
    // numbers win, so a wrong flag cannot wave a partial import through.
    result.reconciliation.balanced = true;

    await expect(writeMergeResult(repository, result)).rejects.toThrow(
      UnbalancedCrmImportError,
    );
    expect(repository.leads.size).toBe(0);
  });

  it("refuses a summary that declares itself unbalanced", async () => {
    const repository = new MemoryCrmRepository();
    const { primary, secondary } = fixture();
    const result = mergeCrmSources(primary, secondary);
    // The totals add up and the flag still says no. Whatever produced that
    // disagreement, it is not a thing to write through.
    result.reconciliation.balanced = false;

    await expect(writeMergeResult(repository, result)).rejects.toThrow(
      UnbalancedCrmImportError,
    );
    expect(repository.leads.size).toBe(0);
  });

  it("records the reconciliation for the run it just wrote", async () => {
    const repository = new MemoryCrmRepository();
    const { primary, secondary } = fixture();
    const result = await importCrmSources(repository, primary, secondary);
    expect(repository.runs).toEqual([result.reconciliation]);
  });

  it("reconciles merged, original-only and copy-only counts", () => {
    const { primary, secondary } = fixture();
    const { reconciliation, leads } = mergeCrmSources(primary, secondary);
    // U001/UG, U024, U033, U036/Ell, U070 and U080 appear in both files.
    expect(reconciliation.merged).toBe(6);
    // U036/Dev, U050, U060 and U001/G are in the original only.
    expect(reconciliation.dashboardOnly).toBe(4);
    expect(reconciliation.copyOnly).toBe(0);
    expect(leads).toHaveLength(
      reconciliation.merged +
        reconciliation.dashboardOnly +
        reconciliation.copyOnly,
    );
  });
});

describe("7.5a: gaps a mutation sweep found", () => {
  it("keeps what the cell said, even when the value maps", () => {
    const read = readStatus("  active  ");
    // Trimmed, because padding is not meaning. Not retyped to the canonical
    // spelling: raw is the record of what a human actually wrote.
    expect(read.raw).toBe("active");
    expect(read.value).toBe("Active");
    expect(read.unmapped).toBe(false);
  });

  it("does not treat an absent stage as a live one", () => {
    expect(isLiveStatus(null)).toBe(false);
    expect(isLiveStatus("Negotiate")).toBe(true);
    expect(isLiveStatus("Complete")).toBe(false);
  });

  it("does not merge the same ID and student across two tabs", () => {
    const { primary, secondary } = fixture();
    const { leads } = mergeCrmSources(primary, secondary);
    const shared = leads.filter((lead) => lead.leadRef === "U001");
    expect(shared).toHaveLength(2);
    expect(shared.map((lead) => lead.tab).sort()).toEqual([
      "g_sales",
      "ug_sales",
    ]);
    // Each tab numbers its own leads, so U001 on one is unrelated to U001 on
    // the other, exactly as U036 is two students within one tab.
    expect(crmIdentity("ug_sales", "U001", "Ada", "Sparrow")).not.toBe(
      crmIdentity("g_sales", "U001", "Ada", "Sparrow"),
    );
  });

  it("re-reads the vocabulary after a fill supplies the value", () => {
    const { primary, secondary } = fixture();
    const { leads } = mergeCrmSources(primary, secondary);
    const filled = leads.find((lead) => lead.leadRef === "U080");
    // The original held no stage for this lead and the copy did. The merged
    // record has to read the vocabulary again or the stage stays null and the
    // lead silently drops out of every stage-driven list.
    expect(filled?.values.status).toBe("Active");
    expect(filled?.status.value).toBe("Active");
    expect(filled?.status.unmapped).toBe(false);
    expect(
      selectStallCandidates([toLeadView(filled!)]).candidates,
    ).toHaveLength(1);
  });

  it("imports every new dispute unresolved", async () => {
    const repository = new MemoryCrmRepository();
    const { primary, secondary } = fixture();
    await importCrmSources(repository, primary, secondary);
    expect(repository.disputes.size).toBeGreaterThan(0);
    for (const dispute of repository.disputes.values()) {
      // The working value is not a ruling. Importing it as one would answer a
      // question nobody asked a human.
      expect(dispute.resolvedValue).toBeNull();
      expect(dispute.resolvedBy).toBeNull();
      expect(dispute.resolvedAt).toBeNull();
    }
  });

  it("constrains the run totals and the resolution in the database", async () => {
    const sql = await readFile(
      new URL(
        "../prisma/migrations/202608270003_phase_7_5a_crm_merge/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    // The balance rule holds in the database too, not only in the code that
    // usually writes it.
    expect(sql).toMatch(
      /CHECK \(balanced = \(rows_imported \+ rows_rejected = rows_read\)\)/,
    );
    expect(sql).toMatch(
      /resolved_at IS NULL AND resolved_by IS NULL AND resolved_value IS NULL/,
    );
    expect(sql).toMatch(
      /resolved_at IS NOT NULL AND btrim\(coalesce\(resolved_by, ''\)\) <> '' AND resolved_value IS NOT NULL/,
    );
  });

  it("makes a duplicate lead or a second dispute on one field impossible", async () => {
    const sql = await readFile(
      new URL(
        "../prisma/migrations/202608270003_phase_7_5a_crm_merge/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    // Idempotence rests on these two. Without them a second import is a second
    // copy no matter what the writing code intends.
    expect(sql).toMatch(/CREATE UNIQUE INDEX "crm_leads_identity_key"/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "crm_field_disputes_identity_field_key"/,
    );
  });
});

describe("7.5a: the ID collision", () => {
  it("imports U036 as two rows with distinct identities", () => {
    const { primary, secondary } = fixture();
    const { leads } = mergeCrmSources(primary, secondary);
    const u036 = leads.filter((lead) => lead.leadRef === "U036");
    expect(u036).toHaveLength(2);
    expect(new Set(u036.map((lead) => lead.identity)).size).toBe(2);
    expect(u036.map((lead) => lead.values.status).sort()).toEqual([
      "Negotiate",
      "Prospect",
    ]);
  });

  it("keeps the Negotiate lead whole rather than folding it into the other", () => {
    const { primary, secondary } = fixture();
    const { leads } = mergeCrmSources(primary, secondary);
    const negotiate = leads.find((lead) => lead.values.status === "Negotiate");
    expect(negotiate?.values.studentLast).toBe("Trevino");
    expect(negotiate?.values.referrerSource).toBe("Parent Referral");
    // The academic column from the copy reached the right one of the two.
    expect(negotiate?.values.essays).toBe("Two drafts");
    const prospect = leads.find(
      (lead) => lead.values.studentLast === "Ramanathan",
    );
    expect(prospect?.values.essays).toBeUndefined();
  });

  it("keys on the student, not on the sheet ID alone", () => {
    expect(crmIdentity("ug_sales", "U036", "Dev", "Ramanathan")).not.toBe(
      crmIdentity("ug_sales", "U036", "Ell", "Trevino"),
    );
    // The same student in both files is one record.
    expect(crmIdentity("ug_sales", "u036", " Ell ", "Trevino")).toBe(
      crmIdentity("ug_sales", "U036", "Ell", "Trevino"),
    );
  });
});

describe("7.5a: conflicts are disputed, never resolved by a rule", () => {
  it("imports a head-to-head disagreement as disputed, keeping both values", () => {
    const { primary, secondary } = fixture();
    const { leads } = mergeCrmSources(primary, secondary);
    const bea = leads.find((lead) => lead.values.studentLast === "Marlow");
    expect(bea?.disputes).toEqual([
      {
        field: "referrerSource",
        workingValue: "Direct",
        workingSource: "dashboard",
        alternateValue: "Sibling",
        alternateSource: "dashboard_copy",
      },
    ]);
    // The working value stands so the import proceeds now.
    expect(bea?.values.referrerSource).toBe("Direct");
  });

  it("puts every dispute on a ruling list with both values", () => {
    const { primary, secondary } = fixture();
    const result = mergeCrmSources(primary, secondary);
    const list = rulingList(result);
    expect(list).toHaveLength(result.reconciliation.disputedCells);
    expect(list.map((entry) => entry.field).sort()).toEqual([
      "dueDate",
      "referrerSource",
    ]);
    for (const entry of list) {
      expect(entry.workingValue).not.toBe(entry.alternateValue);
      expect(entry.alternateValue).not.toBe("");
    }
  });

  it("treats a blank on one side as a fill, not a disagreement", () => {
    const { primary, secondary } = fixture();
    const { leads } = mergeCrmSources(primary, secondary);
    const nameless = leads.find((lead) => lead.leadRef === "U070");
    // The copy supplied a date the original did not hold. Nothing to rule on.
    expect(nameless?.values.leadDate).toBe("2026-01-09");
    expect(nameless?.disputes).toEqual([]);
    const ada = leads.find((lead) => lead.values.studentLast === "Sparrow");
    expect(ada?.values.sat).toBe("1480");
    expect(ada?.disputes).toEqual([]);
  });
});

describe("7.5a: a disputed cell cannot drive an action", () => {
  it("excludes a lead whose stage is disputed from the stall list, with a reason", () => {
    const { primary, secondary } = fixture();
    const { leads } = mergeCrmSources(primary, secondary);
    const active = leads.find((lead) => lead.values.studentLast === "Sparrow");
    expect(active).toBeTruthy();

    // Same lead, once clean and once with its stage in dispute.
    const clean = toLeadView(active!);
    const disputed = toLeadView({
      ...active!,
      disputes: [
        {
          field: "status",
          workingValue: "Active",
          workingSource: "dashboard",
          alternateValue: "Cold",
          alternateSource: "dashboard_copy",
        },
      ],
    });

    expect(selectStallCandidates([clean]).candidates).toHaveLength(1);

    const selection = selectStallCandidates([disputed]);
    expect(selection.candidates).toHaveLength(0);
    // Excluded with a reason, rather than silently defaulting to the working
    // value or silently vanishing from both lists.
    expect(selection.excluded).toEqual([
      {
        identity: disputed.identity,
        leadRef: "U001",
        reason: "disputed-stage",
      },
    ]);
    expect(actionableValue(disputed, "status")).toBeUndefined();
  });

  it("puts every lead in exactly one of the two lists", () => {
    const { primary, secondary } = fixture();
    const { leads } = mergeCrmSources(primary, secondary);
    const views = leads.map((lead) => toLeadView(lead));
    const selection = selectStallCandidates(views);
    expect(selection.candidates.length + selection.excluded.length).toBe(
      views.length,
    );
  });

  it("excludes a closed stage and an unrecognised one for different reasons", () => {
    const { primary, secondary } = fixture();
    const { leads } = mergeCrmSources(primary, secondary);
    const selection = selectStallCandidates(
      leads.map((lead) => toLeadView(lead)),
    );
    const reasons = new Map(
      selection.excluded.map((entry) => [entry.leadRef, entry.reason]),
    );
    expect(reasons.get("U050")).toBe("closed-stage");
    expect(reasons.get("U060")).toBe("unmapped-stage");
  });
});

describe("7.5a: vocabularies keep what they do not recognise", () => {
  it("stores an unrecognised stage raw and flags it, never coercing it", () => {
    const { primary, secondary } = fixture();
    const { leads, reconciliation } = mergeCrmSources(primary, secondary);
    const gus = leads.find((lead) => lead.values.studentLast === "Iyer");
    expect(gus?.status).toEqual({
      raw: "Warm",
      value: null,
      unmapped: true,
    });
    expect(reconciliation.unmappedCells).toBe(1);
  });

  it("does not snap a near miss to the nearest member", () => {
    // "Affiliate" and "Affiliate Referral" are two of the real conflicts. A
    // fuzzy match would merge them and lose the disagreement.
    expect(readReferrerSource("Affiliate")).toEqual({
      raw: "Affiliate",
      value: null,
      unmapped: true,
    });
    expect(readReferrerSource("Affiliate Referral").value).toBe(
      "Affiliate Referral",
    );
    // Case and padding are formatting, not meaning.
    expect(readStatus("  active ").value).toBe("Active");
  });
});

describe("7.5a: the import is idempotent and a ruling is an update", () => {
  it("leaves the table identical when run twice", async () => {
    const { primary, secondary } = fixture();
    const repository = new MemoryCrmRepository();
    await importCrmSources(repository, primary, secondary);
    const first = repository.snapshot();
    const second = fixture();
    await importCrmSources(repository, second.primary, second.secondary);
    expect(repository.snapshot()).toBe(first);
    expect(repository.rejections).toHaveLength(1);
  });

  it("applies a ruling as an update, touching no other row", async () => {
    const { primary, secondary } = fixture();
    const repository = new MemoryCrmRepository();
    const result = await importCrmSources(repository, primary, secondary);
    const before = JSON.parse(repository.snapshot()) as {
      leads: [string, StoredCrmLead][];
    };

    const target = rulingList(result).find(
      (entry) => entry.field === "referrerSource",
    );
    expect(target).toBeTruthy();
    await repository.resolveDispute({
      identity: target!.identity,
      field: "referrerSource",
      resolvedValue: "Sibling",
      resolvedBy: "Ren",
      resolvedAt: new Date("2026-08-28T10:00:00.000Z"),
    });

    const after = JSON.parse(repository.snapshot()) as {
      leads: [string, StoredCrmLead][];
    };
    const changed = after.leads.filter(
      ([identity, lead], index) =>
        JSON.stringify(lead) !== JSON.stringify(before.leads[index][1]) ||
        identity !== before.leads[index][0],
    );
    expect(changed).toHaveLength(1);
    expect(changed[0][0]).toBe(target!.identity);
    expect(changed[0][1].values.referrerSource).toBe("Sibling");

    const dispute = repository.disputes.get(
      `${target!.identity}::referrerSource`,
    );
    expect(dispute?.resolvedBy).toBe("Ren");
    expect(dispute?.resolvedValue).toBe("Sibling");
  });

  it("frees the field to act once it is ruled", async () => {
    const { primary, secondary } = fixture();
    const { leads } = mergeCrmSources(primary, secondary);
    const bea = leads.find((lead) => lead.values.studentLast === "Marlow")!;
    expect(actionableValue(toLeadView(bea), "referrerSource")).toBeUndefined();
    const ruled = toLeadView(bea, [
      { field: "referrerSource", resolvedValue: "Sibling" },
    ]);
    expect(actionableValue(ruled, "referrerSource")).toBe("Sibling");
    expect(ruled.disputedFields).toEqual([]);
  });

  it("does not lose a ruling when the import runs again", async () => {
    const { primary, secondary } = fixture();
    const repository = new MemoryCrmRepository();
    const result = await importCrmSources(repository, primary, secondary);
    const target = rulingList(result).find(
      (entry) => entry.field === "referrerSource",
    )!;
    await repository.resolveDispute({
      identity: target.identity,
      field: "referrerSource",
      resolvedValue: "Sibling",
      resolvedBy: "Ren",
      resolvedAt: new Date("2026-08-28T10:00:00.000Z"),
    });
    const again = fixture();
    await importCrmSources(repository, again.primary, again.secondary);
    expect(
      repository.disputes.get(`${target.identity}::referrerSource`)?.resolvedBy,
    ).toBe("Ren");
  });
});

describe("7.5a: the database side", () => {
  it("keys every write on the row, so a second import is not a second copy", async () => {
    const source = await readFile(
      new URL("../lib/crm/prisma-repository.ts", import.meta.url),
      "utf8",
    );
    // Upserts, not creates. A create would duplicate on the second run.
    expect(source).toMatch(/crmLead\.upsert/);
    expect(source).toMatch(/crmFieldDispute\.upsert/);
    expect(source).toMatch(/crmImportRejection\.upsert/);
    expect(source).toMatch(/where: \{ identity: lead\.identity \}/);
  });

  it("never reopens a dispute somebody already ruled on", async () => {
    const source = await readFile(
      new URL("../lib/crm/prisma-repository.ts", import.meta.url),
      "utf8",
    );
    const update = source.slice(
      source.indexOf("async upsertDispute"),
      source.indexOf("async recordRejection"),
    );
    // The update branch touches the two values under discussion and none of
    // the resolution columns.
    expect(update).not.toMatch(/resolvedValue|resolvedBy|resolvedAt/);
  });

  it("applies a ruling in one transaction, so it cannot half land", async () => {
    const source = await readFile(
      new URL("../lib/crm/prisma-repository.ts", import.meta.url),
      "utf8",
    );
    const resolve = source.slice(source.indexOf("async resolveDispute"));
    expect(resolve).toMatch(/\$transaction/);
    expect(resolve).toMatch(/crmFieldDispute\.update/);
    expect(resolve).toMatch(/crmLead\.update/);
  });
});

describe("7.5a: the tables ship with row level security", () => {
  it("creates all four CRM tables and enables RLS in the same migration", async () => {
    const dir = new URL("../prisma/migrations/", import.meta.url);
    const entries = await readdir(dir, { withFileTypes: true });
    const sql = (
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map((entry) =>
            readFile(new URL(`${entry.name}/migration.sql`, dir), "utf8"),
          ),
      )
    ).join("\n");
    for (const table of [
      "crm_leads",
      "crm_field_disputes",
      "crm_import_rejections",
      "crm_import_runs",
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE "${table}"`));
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
      );
    }
    // An unbalanced reconciliation must not be storable as a balanced one.
    expect(sql).toMatch(/crm_import_runs_balanced_totals/);
    expect(sql).toMatch(/crm_field_disputes_resolution_is_complete/);
  });

  it("carries no real student names into the repository", async () => {
    // The names are read from the brief rather than written here. Listing them
    // in order to forbid them would put them in the repository, which is the
    // thing being forbidden.
    const brief = await readFile(
      new URL("../docs/PHASE-7.5-CRM.md", import.meta.url),
      "utf8",
    );
    const students = [...brief.matchAll(/^\| \d+ \| U\d+ \| ([^|]+?) \|/gm)]
      .map((match) => match[1].trim())
      .filter((name) => /^[A-Z][a-z]+ [A-Z]/.test(name));
    expect(
      students.length,
      "no student names found in the brief",
    ).toBeGreaterThan(3);

    const fixtureSource = await readFile(
      new URL("./phase-7-5a-crm-merge.test.ts", import.meta.url),
      "utf8",
    );
    for (const name of students) {
      for (const part of name.split(/\s+/)) {
        expect(fixtureSource, part).not.toContain(part);
      }
    }
  });
});
