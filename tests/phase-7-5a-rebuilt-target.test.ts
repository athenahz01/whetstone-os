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
  mergeCrmSources,
  unmappedColumns,
  type CrmRejection,
  type CrmSourceRow,
} from "../lib/crm/merge";

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
    const rows = [rebuilt({ ID: "U001", "S First": "Ada", Region: "NY" })];
    const result = mergeCrmSources(rows, []);
    expect(result.reconciliation.unmappedColumns).toEqual([
      { column: "Region", filledCells: 1 },
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
