import { describe, expect, it } from "vitest";
import {
  importSingleSource,
  UnmappedCrmColumnError,
  writeMergeResult,
  type CrmImportSummary,
  type CrmRepository,
  type StoredCrmDispute,
  type StoredCrmLead,
} from "../lib/crm/import";
import {
  CRM_TABS,
  MERGED_FIELDS,
  mergeCrmSources,
  unmappedColumns,
  type CrmRejection,
  type CrmSourceRow,
} from "../lib/crm/merge";
import {
  affiliateReference,
  IMPORTABLE_TABS,
  NON_IMPORTABLE_TABS,
  REBUILT_AFFILIATE_COLUMN_TO_FIELD,
  REBUILT_COLUMN_TO_FIELD,
  REBUILT_DERIVED_COLUMNS,
  REBUILT_IGNORED_COLUMNS,
  REBUILT_MEETING_COLUMNS,
  referenceColumnFor,
} from "../lib/crm/rebuilt-schema";

/**
 * Retargeting the importer at one authoritative sheet.
 *
 * Athena rebuilt `!Dashboard` on 28 August 2026 as a single sheet with one
 * header row. The importer was written against the two-file fork, and two
 * things about it are wrong for a single source regardless of what the new
 * columns turn out to be called.
 *
 * A header the column map does not know is not an error, it is nothing at all:
 * `fieldsFrom` walks the columns it knows and takes what it finds. Against the
 * sheet the map was written for that is harmless. Against a renamed one the
 * import succeeds, balances, and produces leads that are blank because nobody
 * read the cells. This is the phase's own failure mode in a new place - a count
 * that proves no row was lost cannot prove a row arrived with its contents.
 *
 * And the write boundary used to default its split allowance to
 * `ug_sales::U036`, one fact about one row of one export, which every future
 * caller inherited without ever seeing it.
 *
 * Names here are invented. The real records are minors.
 */

let rowCounter = 0;
function rebuilt(cells: Record<string, string | undefined>): CrmSourceRow {
  rowCounter += 1;
  return {
    source: "dashboard_rebuilt",
    tab: "ug_sales",
    rowNumber: rowCounter,
    cells,
  };
}

function sheet(): CrmSourceRow[] {
  rowCounter = 0;
  return [
    rebuilt({
      ID: "U001",
      "S First": "Ada",
      "S Last": "Sparrow",
      Status: "Active",
      "Lead Date": "2026-01-05",
      "S Email": "ada.sparrow@example.com",
    }),
    rebuilt({
      ID: "U002",
      "S First": "Bea",
      "S Last": "Marlow",
      Status: "Cold",
      "Lead Date": "2026-02-01",
    }),
  ];
}

const NOTHING_ALLOWED = { knownSplitLeadRefs: [] };

class MemoryCrmRepository implements CrmRepository {
  readonly leads = new Map<string, StoredCrmLead>();
  readonly disputes = new Map<string, StoredCrmDispute>();
  readonly rejections: CrmRejection[] = [];
  readonly runs: CrmImportSummary[] = [];
  async upsertLead(lead: StoredCrmLead) {
    this.leads.set(lead.identity, structuredClone(lead));
  }
  async upsertDispute(dispute: StoredCrmDispute) {
    this.disputes.set(`${dispute.identity}::${dispute.field}`, dispute);
  }
  async recordRejection(rejection: CrmRejection) {
    this.rejections.push(rejection);
  }
  async recordImportRun(summary: CrmImportSummary) {
    this.runs.push(summary);
  }
  async resolveDispute() {}
}

describe("7.5a retarget: one sheet has nothing to reconcile", () => {
  it("imports a single source with no disputes", async () => {
    const repository = new MemoryCrmRepository();
    const result = await importSingleSource(
      repository,
      sheet(),
      NOTHING_ALLOWED,
    );
    expect(repository.leads.size).toBe(2);
    expect(repository.disputes.size).toBe(0);
    expect(result.reconciliation.copyOnly).toBe(0);
    expect(result.reconciliation.merged).toBe(0);
  });

  it("refuses rows from more than one source", async () => {
    const mixed = [
      ...sheet(),
      {
        source: "dashboard_copy" as const,
        tab: "ug_sales" as const,
        rowNumber: 99,
        cells: { ID: "U003", "S First": "Cy", "S Last": "Okafor" },
      },
    ];
    await expect(
      importSingleSource(new MemoryCrmRepository(), mixed, NOTHING_ALLOWED),
    ).rejects.toThrow(/received rows from 2 sources/);
  });

  it("needs no split allowance when the sheet holds no shared reference", async () => {
    // The old export's `ug_sales::U036` used to be the default here. A sheet
    // that has no such row should not have to know that.
    const repository = new MemoryCrmRepository();
    await expect(
      importSingleSource(repository, sheet(), NOTHING_ALLOWED),
    ).resolves.toBeDefined();
  });

  it("refuses a sheet that contradicts itself", async () => {
    // One sheet cannot disagree with another, but it can disagree with itself:
    // the same lead entered twice with two different stages. That is a defect
    // on the sheet, not a question for a human, so it is refused rather than
    // imported as a dispute nobody can rule on.
    const contradictory = [
      rebuilt({
        ID: "U004",
        "S First": "Dev",
        "S Last": "Ramanathan",
        Status: "Active",
      }),
      rebuilt({
        ID: "U004",
        "S First": "Dev",
        "S Last": "Ramanathan",
        Status: "Cold",
      }),
    ];
    await expect(
      importSingleSource(
        new MemoryCrmRepository(),
        contradictory,
        NOTHING_ALLOWED,
      ),
    ).rejects.toThrow(/cannot disagree with itself/);
  });

  it("still refuses a split nobody declared", async () => {
    const twoStudentsOneId = [
      rebuilt({ ID: "U009", "S First": "Dev", "S Last": "Ramanathan" }),
      rebuilt({ ID: "U009", "S First": "Ell", "S Last": "Trevino" }),
    ];
    await expect(
      importSingleSource(
        new MemoryCrmRepository(),
        twoStudentsOneId,
        NOTHING_ALLOWED,
      ),
    ).rejects.toThrow(/more than one record/);
  });
});

describe("7.5a retarget: a header nobody reads is data arriving nowhere", () => {
  it("names every unmapped column holding data", () => {
    const rows = [
      rebuilt({
        ID: "U001",
        "S First": "Ada",
        "S Last": "Sparrow",
        "Chase After": "2026-09-04",
        "Chase Flag": "TRUE",
      }),
      rebuilt({ ID: "U002", "S First": "Bea", "Chase Flag": "FALSE" }),
    ];
    expect(unmappedColumns(rows)).toEqual([
      { column: "Chase After", filledCells: 1 },
      { column: "Chase Flag", filledCells: 2 },
    ]);
  });

  it("does not name an unmapped column that holds nothing", () => {
    // An empty column loses no data, so refusing the import over it would be
    // noise rather than a finding.
    const rows = [
      rebuilt({ ID: "U001", "S First": "Ada", Spare: "", Notes: "   " }),
    ];
    expect(unmappedColumns(rows)).toEqual([]);
  });

  it("does not name the columns the map already reads", () => {
    expect(unmappedColumns(sheet())).toEqual([]);
  });

  it("refuses to write when a column holds data nobody declared", async () => {
    const repository = new MemoryCrmRepository();
    const rows = [
      rebuilt({
        ID: "U001",
        "S First": "Ada",
        "S Last": "Sparrow",
        "Contract Value": "10000",
      }),
    ];
    await expect(
      importSingleSource(repository, rows, NOTHING_ALLOWED),
    ).rejects.toThrow(UnmappedCrmColumnError);
    // Nothing written. A lead that looks imported and is missing whatever that
    // column held is worse than a refusal.
    expect(repository.leads.size).toBe(0);
    expect(repository.runs).toHaveLength(0);
  });

  it("says which column and how much sat under it", async () => {
    const rows = [
      rebuilt({ ID: "U001", "S First": "Ada", "Contract Value": "10000" }),
      rebuilt({ ID: "U002", "S First": "Bea", "Contract Value": "4000" }),
    ];
    await expect(
      importSingleSource(new MemoryCrmRepository(), rows, NOTHING_ALLOWED),
    ).rejects.toThrow(/Contract Value \(2 filled\)/);
  });

  it("proceeds once a column is declared ignored", async () => {
    const repository = new MemoryCrmRepository();
    const rows = [
      rebuilt({
        ID: "U001",
        "S First": "Ada",
        "S Last": "Sparrow",
        "Chase Flag": "TRUE",
      }),
    ];
    // Declaring one is a decision on record, not a shrug. `Chase Flag` is the
    // sheet's own derived column and importing it would store a derived fact
    // twice, which is the thing this phase exists to stop.
    await importSingleSource(repository, rows, {
      knownSplitLeadRefs: [],
      ignoredColumns: ["Chase Flag"],
    });
    expect(repository.leads.size).toBe(1);
  });

  it("carries the unmapped columns on the reconciliation", () => {
    // `Region` is a real column on the rebuilt sheet now, so an unmapped header
    // has to be something the map genuinely does not know.
    const rows = [
      rebuilt({ ID: "U001", "S First": "Ada", "Invented Column": "NY" }),
    ];
    const result = mergeCrmSources(rows, []);
    expect(result.reconciliation.unmappedColumns).toEqual([
      { column: "Invented Column", filledCells: 1 },
    ]);
    // And it still balances, which is exactly why the count is needed: balance
    // cannot see a column nobody read.
    expect(result.reconciliation.balanced).toBe(true);
  });

  it("scans the second file too, not only the first", () => {
    // The two-file path is still how the old export imports. A column that
    // exists only in the copy is exactly the shape that file was carrying.
    const result = mergeCrmSources(
      [rebuilt({ ID: "U001", "S First": "Ada" })],
      [
        {
          source: "dashboard_copy" as const,
          tab: "ug_sales" as const,
          rowNumber: 1,
          cells: { ID: "U001", "S First": "Ada", "Copy Only Column": "x" },
        },
      ],
    );
    expect(result.reconciliation.unmappedColumns).toEqual([
      { column: "Copy Only Column", filledCells: 1 },
    ]);
  });

  it("refuses through the two-file path as well", async () => {
    const repository = new MemoryCrmRepository();
    const result = mergeCrmSources(
      [rebuilt({ ID: "U001", "S First": "Ada", Mystery: "x" })],
      [],
    );
    await expect(
      writeMergeResult(repository, result, NOTHING_ALLOWED),
    ).rejects.toThrow(UnmappedCrmColumnError);
  });
});

describe("7.5a retarget: the sheet's own formulas are not data", () => {
  const ugRow = (extra: Record<string, string>) =>
    rebuilt({
      ID: "U001",
      "S First": "Ada",
      "S Last": "Sparrow",
      Status: "Active",
      ...extra,
    });

  it("maps none of the six computed columns to a field", () => {
    for (const column of REBUILT_DERIVED_COLUMNS) {
      expect(
        REBUILT_COLUMN_TO_FIELD,
        `${column} must not become a stored field`,
      ).not.toHaveProperty(column);
    }
  });

  it("refuses to write them when they are not declared", async () => {
    // `Days Quiet` is the spreadsheet's own silence clock and
    // `S5.silence-clock` computes the same number from `crm_touches`. Storing
    // the sheet's answer next to the inputs ours is computed from is the fork
    // again, one table down.
    await expect(
      importSingleSource(
        new MemoryCrmRepository(),
        [ugRow({ "Days Quiet": "231", "Chase Flag": "TRUE" })],
        NOTHING_ALLOWED,
      ),
    ).rejects.toThrow(UnmappedCrmColumnError);
  });

  it("imports the sheet once they are declared ignored", async () => {
    const repository = new MemoryCrmRepository();
    await importSingleSource(
      repository,
      [
        ugRow({
          "Last Touch": "2026-01-05",
          "Days Quiet": "231",
          "Chase After": "2026-09-04",
          "Chase Flag": "TRUE",
          Contactable: "Yes",
          "Data Flags": "no email",
          _key: "u001-ada",
        }),
      ],
      { knownSplitLeadRefs: [], ignoredColumns: [...REBUILT_IGNORED_COLUMNS] },
    );
    const lead = [...repository.leads.values()][0];
    expect(lead?.leadRef).toBe("U001");
    // Present on the sheet, absent from the record. Declared, not dropped.
    expect(JSON.stringify(lead?.values)).not.toContain("231");
    expect(JSON.stringify(lead?.values)).not.toContain("2026-09-04");
  });

  it("leaves the meeting columns to the touch record", async () => {
    // 7.5b already asserts no CRM field exists for the milestone columns, and
    // `meetingMilestones()` derives them from `crm_touches`. Mapping them here
    // would break a standing lock, so they are declared ignored and the touch
    // scan is what fills them.
    for (const column of REBUILT_MEETING_COLUMNS) {
      expect(REBUILT_COLUMN_TO_FIELD).not.toHaveProperty(column);
      expect(REBUILT_IGNORED_COLUMNS).toContain(column);
    }
    const repository = new MemoryCrmRepository();
    await importSingleSource(
      repository,
      [ugRow({ "M1 Date": "2026-02-11", "M1 Closer": "R" })],
      { knownSplitLeadRefs: [], ignoredColumns: [...REBUILT_IGNORED_COLUMNS] },
    );
    expect(JSON.stringify([...repository.leads.values()])).not.toContain(
      "2026-02-11",
    );
  });

  it("names every ignored column, so none of it is a silent drop", () => {
    // The list is the record of the decision. A column that stops appearing
    // here starts failing the import instead of quietly vanishing.
    for (const column of REBUILT_DERIVED_COLUMNS) {
      expect(REBUILT_IGNORED_COLUMNS).toContain(column);
    }
    expect(REBUILT_IGNORED_COLUMNS).toContain("_key");
  });
});

describe("7.5a retarget: the derived tabs are not import sources", () => {
  it("keeps Overview and Action Queue out of the importable tabs", () => {
    // They are formulas over `UG Sales`. Importing either would write every
    // lead a second time - the duplication this phase exists to end, arriving
    // through the front door.
    for (const tab of NON_IMPORTABLE_TABS) {
      expect(CRM_TABS as readonly string[]).not.toContain(tab);
      expect(IMPORTABLE_TABS as readonly string[]).not.toContain(tab);
    }
    expect(NON_IMPORTABLE_TABS).toContain("Overview");
    expect(NON_IMPORTABLE_TABS).toContain("Action Queue");
  });

  it("admits exactly the three tabs that hold rows", () => {
    expect([...IMPORTABLE_TABS].sort()).toEqual([
      "affiliate",
      "g_sales",
      "ug_sales",
    ]);
    expect([...CRM_TABS].sort()).toEqual([...IMPORTABLE_TABS].sort());
  });
});

describe("7.5a retarget: Affiliate has no ID column", () => {
  const affiliate = (cells: Record<string, string | undefined>) => ({
    source: "dashboard_rebuilt" as const,
    tab: "affiliate" as const,
    rowNumber: 1,
    cells,
  });

  it("keys the tab on the column it actually has", () => {
    expect(referenceColumnFor("affiliate")).toBe("Full name");
    expect(referenceColumnFor("ug_sales")).toBe("ID");
    expect(referenceColumnFor("g_sales")).toBe("ID");
  });

  it("imports a partner rather than rejecting them for having no ID", async () => {
    const repository = new MemoryCrmRepository();
    await importSingleSource(
      repository,
      [
        affiliate({
          "Full name": "Bright Futures Advising",
          First: "Bright",
          Last: "Futures Advising",
          Type: "Agency",
          "Leads referred": "7",
          Won: "2",
          "Lost / NQ": "3",
          "Still live": "2",
          "Last lead date": "2026-05-04",
          Notes: "quarterly check-in",
        }),
      ],
      { knownSplitLeadRefs: [], ignoredColumns: [...REBUILT_IGNORED_COLUMNS] },
    );
    // Reading `ID` here would have rejected all twenty-one rows for having no
    // reference, and the reconciliation would have balanced perfectly while the
    // whole tab landed in the rejection list.
    expect(repository.rejections).toHaveLength(0);
    expect(repository.leads.size).toBe(1);
    const lead = [...repository.leads.values()][0];
    expect(lead?.leadRef).toBe("BRIGHT FUTURES ADVISING");
    expect(lead?.values.leadsReferred).toBe("7");
  });

  it("falls back to the first and last name when Full name is blank", () => {
    expect(
      affiliateReference(affiliate({ First: "Bright", Last: "Futures" })),
    ).toBe("Bright Futures");
    expect(
      affiliateReference(
        affiliate({ "Full name": "Bright Futures", First: "ignored" }),
      ),
    ).toBe("Bright Futures");
  });

  it("rejects a partner row that names nobody, and says which column", () => {
    const result = mergeCrmSources([affiliate({ Type: "Agency" })], []);
    expect(result.rejections).toEqual([
      {
        source: "dashboard_rebuilt",
        tab: "affiliate",
        rowNumber: 1,
        // Not "row has no ID". There is no ID column on this tab, and a reason
        // naming one sends whoever reads it looking for something that was
        // never there.
        reason: "row has no Full name",
      },
    ]);
  });

  it("reads the partner tab through its own column map", () => {
    // Ten columns, and none of them is a student. `Leads referred` and its
    // siblings are counts, which the sales tabs have no equivalent of.
    expect(REBUILT_AFFILIATE_COLUMN_TO_FIELD).not.toHaveProperty("S First");
    expect(REBUILT_AFFILIATE_COLUMN_TO_FIELD).toHaveProperty("Leads referred");
    expect(REBUILT_COLUMN_TO_FIELD).not.toHaveProperty("Leads referred");
  });
});

describe("7.5a retarget: the rebuilt headers are the ones on the sheet", () => {
  it("maps every renamed column to the field it used to fill", () => {
    // The renames the schema document lists. Each one would silently import as
    // blank if the map still expected the old name.
    expect(REBUILT_COLUMN_TO_FIELD["S Last"]).toBe("studentLast");
    expect(REBUILT_COLUMN_TO_FIELD["P1 Last"]).toBe("parent1Last");
    expect(REBUILT_COLUMN_TO_FIELD["Due Date (as entered)"]).toBe("dueDate");
    expect(REBUILT_COLUMN_TO_FIELD["SAT / GRE"]).toBe("sat");
    expect(REBUILT_COLUMN_TO_FIELD["Pain / Need"]).toBe("painNeed");
    // The old bare names are gone from the rebuilt map.
    for (const gone of ["Due Date", "SAT", "Region School", "1M Date"]) {
      expect(REBUILT_COLUMN_TO_FIELD).not.toHaveProperty(gone);
    }
  });

  it("splits Region and School, which used to be one column", () => {
    expect(REBUILT_COLUMN_TO_FIELD.Region).toBe("region");
    expect(REBUILT_COLUMN_TO_FIELD.School).toBe("school");
    // The old field survives because the old export still imports through the
    // old map, and one column holding two facts is what it held.
    expect(MERGED_FIELDS as readonly string[]).toContain("regionSchool");
  });

  it("carries the academic columns on the canonical sheet", async () => {
    // These lived only in `Copy of !Dashboard`. Their being here is why the
    // merge stops being a reconciliation and becomes an import.
    const repository = new MemoryCrmRepository();
    await importSingleSource(
      repository,
      [
        {
          source: "dashboard_rebuilt" as const,
          tab: "g_sales" as const,
          rowNumber: 1,
          cells: {
            ID: "G012",
            "S First": "Cy",
            "S Last": "Okafor",
            Status: "Engage",
            "SAT / GRE": "328",
            Capstone: "Robotics",
            "Admission Status": "Applied",
          },
        },
      ],
      { knownSplitLeadRefs: [], ignoredColumns: [...REBUILT_IGNORED_COLUMNS] },
    );
    const lead = [...repository.leads.values()][0];
    expect(lead?.values.sat).toBe("328");
    expect(lead?.values.capstone).toBe("Robotics");
    expect(lead?.values.admissionStatus).toBe("Applied");
    expect(repository.disputes.size).toBe(0);
  });

  it("still reads the old export through the old map", () => {
    // The rebuilt map is chosen per row, so the historical two-file import is
    // unaffected by any of this.
    const legacy = mergeCrmSources(
      [
        {
          source: "dashboard" as const,
          tab: "ug_sales" as const,
          rowNumber: 1,
          cells: { ID: "U001", "S First": "Ada", "Due Date": "2026-07-15" },
        },
      ],
      [],
    );
    expect(legacy.leads[0]?.values.dueDate).toBe("2026-07-15");
    expect(legacy.reconciliation.unmappedColumns).toEqual([]);
  });

  it("does not read a rebuilt row through the old map", () => {
    // The old map has no `Due Date (as entered)`, so a rebuilt row read through
    // it would import blank and balance perfectly.
    const row = rebuilt({
      ID: "U001",
      "S First": "Ada",
      "Due Date (as entered)": "2026-07-15",
    });
    expect(mergeCrmSources([row], []).leads[0]?.values.dueDate).toBe(
      "2026-07-15",
    );
  });
});

describe("7.5a retarget: the allowances are stated, never inherited", () => {
  it("requires the split allowance at every call site", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../lib/crm/import.ts", import.meta.url), "utf8"),
    );
    // No default. The previous one named a row of the old export, so a caller
    // that had never seen that data was covered by an assertion about it
    // without typing anything.
    expect(source).not.toMatch(/knownSplitLeadRefs \?\?/);
    expect(source).not.toContain('["ug_sales::U036"]');
    expect(source).toMatch(/options: CrmWriteAllowances,/);
  });
});
