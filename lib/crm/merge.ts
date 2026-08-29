import {
  readReferrerSource,
  readStatus,
  type CrmReferrerSource,
  type CrmStatus,
  type VocabularyRead,
} from "./vocabulary";

/**
 * Merge and reconcile, as a pure core.
 *
 * Two sheets diverged in both directions. The original holds the sales funnel
 * and cannot say what a student needs; the copy holds the academic picture and
 * cannot say who is close to signing. Neither is a backup of the other.
 *
 * Two rules govern everything here:
 *
 *   Nothing is dropped. Every input row leaves as an imported record or as a
 *   rejection carrying a reason, and the reconciliation refuses to balance if
 *   those two do not add up to the input. That is the 41% inventory loss from
 *   Phase 4, which was silent because nobody counted the other side.
 *
 *   Nothing is auto-resolved. Where both files hold a real and different value
 *   the cell imports as disputed, keeps both, and is barred from driving any
 *   action until a human rules. The import proceeds now; the ruling lands later
 *   as an update rather than a re-import.
 */

export type CrmTab = "ug_sales" | "g_sales" | "affiliate";

/**
 * Which file a value came from. `!Dashboard` is the working default.
 *
 * `dashboard_rebuilt` is Athena's 28 Aug 2026 rebuild, which is one sheet
 * rather than a fork. Importing from it is a single-source import: there is no
 * second file to disagree with, so no cell can arrive disputed, and the merge
 * machinery below is doing reconciliation work that has nothing to reconcile.
 * That is the point of retargeting - the fork stops being a thing to resolve
 * because it stops existing.
 */
export type CrmSource = "dashboard" | "dashboard_copy" | "dashboard_rebuilt";

export const WORKING_SOURCE: CrmSource = "dashboard";

/** One row exactly as the sheet held it. Values are raw strings or absent. */
export interface CrmSourceRow {
  source: CrmSource;
  tab: CrmTab;
  /** 1-based row number in its own sheet, so a rejection can be found again. */
  rowNumber: number;
  cells: Record<string, string | undefined>;
}

/** Columns carried across from the funnel file. */
export const FUNNEL_FIELDS = [
  "status",
  "leadDate",
  "referrerSource",
  "dueDate",
  "nextAction",
  "responsible",
  "dealSize",
  "outcome",
] as const;

/** The eight columns that exist only in the copy. */
export const ACADEMIC_FIELDS = [
  "admissionStatus",
  "materials",
  "sat",
  "academic",
  "tutoringNotes",
  "capstone",
  "essays",
  "regionSchool",
] as const;

/**
 * The columns touch detection matches against.
 *
 * Carried across as ordinary merged fields, so a disagreement between the two
 * files becomes a dispute like any other and a disputed address is barred from
 * driving a match. An address nobody has ruled on is not a fact about who a
 * message was from.
 *
 * 52 of 69 UG rows have no student email, so absence here is the common case
 * and has to read as `unmonitorable` rather than as healthy. 7.5c owns that
 * label; this list is what it will find missing.
 */
export const CONTACT_FIELDS = [
  "studentEmail",
  "parent1Email",
  "parent2Email",
  "studentPhone",
  "parent1Phone",
] as const;

export const MERGED_FIELDS = [
  "studentFirst",
  "studentLast",
  ...FUNNEL_FIELDS,
  ...ACADEMIC_FIELDS,
  ...CONTACT_FIELDS,
] as const;

export type CrmField = (typeof MERGED_FIELDS)[number];

/** Sheet column headings, mapped to field names. */
const COLUMN_TO_FIELD: Record<string, CrmField> = {
  "S First": "studentFirst",
  "S Last": "studentLast",
  Status: "status",
  "Lead Date": "leadDate",
  "Referrer Source": "referrerSource",
  "Due Date": "dueDate",
  "Next Action": "nextAction",
  Responsible: "responsible",
  "Deal Size": "dealSize",
  Outcome: "outcome",
  "Admission Status": "admissionStatus",
  Materials: "materials",
  SAT: "sat",
  Academic: "academic",
  "Tutoring Notes": "tutoringNotes",
  Capstone: "capstone",
  Essays: "essays",
  "Region School": "regionSchool",
  "S Email": "studentEmail",
  "P1 Email": "parent1Email",
  "P2 Email": "parent2Email",
  "S Phone": "studentPhone",
  "P1 Phone": "parent1Phone",
};

export interface CrmDispute {
  field: CrmField;
  /** The value that stands until a human rules. Always `!Dashboard`'s. */
  workingValue: string;
  workingSource: CrmSource;
  /** Kept rather than discarded, so a ruling is a choice and not a retype. */
  alternateValue: string;
  alternateSource: CrmSource;
}

export interface MergedCrmLead {
  /** Stable across re-runs, and distinct for two students sharing an ID. */
  identity: string;
  leadRef: string;
  tab: CrmTab;
  values: Partial<Record<CrmField, string>>;
  status: VocabularyRead<CrmStatus>;
  referrerSource: VocabularyRead<CrmReferrerSource>;
  disputes: CrmDispute[];
  /** Which files contributed a row to this record. */
  sources: CrmSource[];
}

export interface CrmRejection {
  source: CrmSource;
  tab: CrmTab;
  rowNumber: number;
  reason: string;
}

export interface CrmReconciliation {
  rowsRead: number;
  rowsImported: number;
  rowsRejected: number;
  /** Records built from a row in both files. */
  merged: number;
  /** Records seen in `!Dashboard` only, and in the copy only. */
  dashboardOnly: number;
  copyOnly: number;
  disputedCells: number;
  unmappedCells: number;
  /**
   * Headers carrying data that no field maps to.
   *
   * `fieldsFrom` walks the known columns and takes what it finds, so a column
   * the map does not know is not an error - it is nothing at all. Against the
   * sheet the map was written for that is harmless. Against a different sheet,
   * or a renamed one, it means the import succeeds, balances, and produces
   * leads whose fields are blank because nobody was reading the cells.
   *
   * That is this phase's own failure mode wearing a new hat: a count that
   * proves no row was lost cannot prove a row arrived with its contents. So
   * every unmapped header holding at least one value is named here, and the
   * write boundary refuses an import carrying one nobody declared.
   */
  unmappedColumns: CrmColumnUsage[];
  /** True only when imported plus rejected accounts for every row read. */
  balanced: boolean;
  /**
   * Leads holding one `leadRef` that were built as two records.
   *
   * `balanced` counts source rows, so it can only prove nothing was lost. It
   * cannot prove anything was joined correctly: two rows that should have been
   * one lead still balance perfectly. This is the count that notices, and it
   * must be zero.
   */
  splitLeadRefs: string[];
}

/**
 * Did every row read leave as an import or as a rejection?
 *
 * Named and exported because `mergeCrmSources` cannot produce a false here: it
 * balances by construction. The rule still has to be stated somewhere a test
 * can hand it numbers that do not add up, or the one line standing between a
 * silent partial import and a refusal is never exercised.
 */
export function isBalanced(totals: {
  rowsRead: number;
  rowsImported: number;
  rowsRejected: number;
}): boolean {
  return totals.rowsImported + totals.rowsRejected === totals.rowsRead;
}

/** An unmapped header, and how much data sits under it. */
export interface CrmColumnUsage {
  column: string;
  /** Non-empty cells. An empty unmapped column loses nothing. */
  filledCells: number;
}

export interface MergeResult {
  leads: MergedCrmLead[];
  rejections: CrmRejection[];
  reconciliation: CrmReconciliation;
}

function cell(row: CrmSourceRow, column: string): string {
  return (row.cells[column] ?? "").trim();
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The identity a record merges on.
 *
 * Not the sheet ID alone. `U036` is held by two unrelated students, one of them
 * the only lead at Negotiate in the whole pipeline, and an ID-only key would
 * fold them into one row and lose him. The student's name is part of the key,
 * so the same student merges across both files and two students never merge
 * into one.
 *
 * A row with an ID and no name keys on the empty name, which still merges that
 * row across files. 21 rows are in that state and they are not dropped for it.
 */
export function crmIdentity(
  tab: CrmTab,
  leadRef: string,
  first: string,
  last: string,
): string {
  return [tab, leadRef.trim().toUpperCase(), normalizeName(`${first} ${last}`)]
    .join("::")
    .replace(/::$/, "::");
}

/** The identity of a row whose student name is blank. */
function namelessIdentity(tab: CrmTab, leadRef: string): string {
  return crmIdentity(tab, leadRef, "", "");
}

/**
 * Resolves the identity a nameless row should adopt.
 *
 * A row with an ID and no student name is not a different student; it is the
 * same student, recorded by someone who did not fill the name cell. 21 rows in
 * `!Dashboard` are in exactly that state, and in the live export U045, U046 and
 * U047 are named in `!Dashboard` and nameless in the copy.
 *
 * Keying identity on the name alone split each of those into two leads sharing
 * one `leadRef` - one carrying the sales funnel, the other carrying the
 * academic columns. That is the fork this phase exists to end, rebuilt inside
 * the database, and the reconciliation called it balanced because it counts
 * rows and every row was accounted for.
 *
 * So a nameless row joins the named row for its `leadRef` when there is exactly
 * one. When there are two or more - `U036`, where Hamza Benyass and Jack Yu
 * share an ID - there is no non-arbitrary answer, and guessing would fold two
 * students together. That row is rejected instead, which is the outcome the
 * "no silently dropped row" rule is for: it leaves as a rejection with a
 * reason, not as a wrong join.
 */
function resolveNamelessIdentity(
  tab: CrmTab,
  leadRef: string,
  namedIdentities: Map<string, string[]>,
): { identity: string } | { ambiguous: string[] } {
  const candidates = namedIdentities.get(`${tab}::${leadRef}`) ?? [];
  if (candidates.length === 1) return { identity: candidates[0]! };
  if (candidates.length === 0)
    return { identity: namelessIdentity(tab, leadRef) };
  return { ambiguous: candidates };
}

/**
 * Headers holding data that the column map does not read.
 *
 * Counted across every row rather than sampled from the first, because a sheet
 * can carry a column that is populated only on the rows that matter.
 */
export function unmappedColumns(rows: CrmSourceRow[]): CrmColumnUsage[] {
  const filled = new Map<string, number>();
  for (const row of rows) {
    for (const [column, value] of Object.entries(row.cells)) {
      if (column in COLUMN_TO_FIELD || column === "ID") continue;
      if (!value?.trim()) continue;
      filled.set(column, (filled.get(column) ?? 0) + 1);
    }
  }
  return [...filled.entries()]
    .map(([column, filledCells]) => ({ column, filledCells }))
    .sort((left, right) => left.column.localeCompare(right.column));
}

function fieldsFrom(row: CrmSourceRow): Partial<Record<CrmField, string>> {
  const values: Partial<Record<CrmField, string>> = {};
  for (const [column, field] of Object.entries(COLUMN_TO_FIELD)) {
    const value = cell(row, column);
    if (value) values[field] = value;
  }
  return values;
}

/**
 * Merges the two files.
 *
 * `primary` is `!Dashboard`, whose value is the working one wherever the two
 * disagree. That is a default recorded in the brief, not a judgement: it is
 * flagged on every cell it decides and revisable without a re-import.
 */
export function mergeCrmSources(
  primary: CrmSourceRow[],
  secondary: CrmSourceRow[],
): MergeResult {
  const rejections: CrmRejection[] = [];
  const byIdentity = new Map<string, MergedCrmLead>();
  const rowsRead = primary.length + secondary.length;
  let rowsImported = 0;

  // First pass: every named row, so a nameless row can find its twin whichever
  // order the two files arrive in. A single pass made the join depend on row
  // order, which is not a property of the data.
  const namedIdentities = new Map<string, string[]>();
  for (const row of [...primary, ...secondary]) {
    const leadRef = cell(row, "ID").trim().toUpperCase();
    if (!leadRef) continue;
    const name = normalizeName(
      `${cell(row, "S First")} ${cell(row, "S Last")}`,
    );
    if (!name) continue;
    const key = `${row.tab}::${leadRef}`;
    const identity = crmIdentity(
      row.tab,
      leadRef,
      cell(row, "S First"),
      cell(row, "S Last"),
    );
    const held = namedIdentities.get(key) ?? [];
    if (!held.includes(identity)) held.push(identity);
    namedIdentities.set(key, held);
  }

  const ingest = (row: CrmSourceRow) => {
    const leadRef = cell(row, "ID");
    if (!leadRef) {
      rejections.push({
        source: row.source,
        tab: row.tab,
        rowNumber: row.rowNumber,
        reason: "row has no ID",
      });
      return;
    }
    const first = cell(row, "S First");
    const last = cell(row, "S Last");
    let identity: string;
    if (normalizeName(`${first} ${last}`)) {
      identity = crmIdentity(row.tab, leadRef, first, last);
    } else {
      const resolved = resolveNamelessIdentity(
        row.tab,
        leadRef.trim().toUpperCase(),
        namedIdentities,
      );
      if ("ambiguous" in resolved) {
        rejections.push({
          source: row.source,
          tab: row.tab,
          rowNumber: row.rowNumber,
          reason: `row has no student name and its ID ${leadRef.trim().toUpperCase()} is shared by ${resolved.ambiguous.length} named students, so it cannot be joined without guessing`,
        });
        return;
      }
      identity = resolved.identity;
    }
    const incoming = fieldsFrom(row);
    const existing = byIdentity.get(identity);
    rowsImported += 1;

    if (!existing) {
      byIdentity.set(identity, {
        identity,
        leadRef: leadRef.trim().toUpperCase(),
        tab: row.tab,
        values: incoming,
        status: readStatus(incoming.status),
        referrerSource: readReferrerSource(incoming.referrerSource),
        disputes: [],
        sources: [row.source],
      });
      return;
    }

    if (!existing.sources.includes(row.source))
      existing.sources.push(row.source);
    for (const field of MERGED_FIELDS) {
      const incomingValue = incoming[field];
      const heldValue = existing.values[field];
      if (!incomingValue) continue;
      if (!heldValue) {
        // A fill, not a conflict. One file knew something the other did not,
        // which is the whole reason the fork is worth merging.
        existing.values[field] = incomingValue;
        continue;
      }
      if (heldValue === incomingValue) continue;
      // Both files hold a real and different value. Neither wins on the merits.
      const workingIsPrimary = existing.sources[0] === WORKING_SOURCE;
      existing.disputes.push({
        field,
        workingValue: workingIsPrimary ? heldValue : incomingValue,
        workingSource: WORKING_SOURCE,
        alternateValue: workingIsPrimary ? incomingValue : heldValue,
        alternateSource:
          WORKING_SOURCE === "dashboard" ? "dashboard_copy" : "dashboard",
      });
      existing.values[field] = workingIsPrimary ? heldValue : incomingValue;
    }
    existing.status = readStatus(existing.values.status);
    existing.referrerSource = readReferrerSource(
      existing.values.referrerSource,
    );
  };

  primary.forEach(ingest);
  secondary.forEach(ingest);

  const leads = [...byIdentity.values()];
  const disputedCells = leads.reduce(
    (total, lead) => total + lead.disputes.length,
    0,
  );
  const unmappedCells = leads.reduce(
    (total, lead) =>
      total +
      (lead.status.unmapped ? 1 : 0) +
      (lead.referrerSource.unmapped ? 1 : 0),
    0,
  );
  const rowsRejected = rejections.length;

  return {
    leads,
    rejections,
    reconciliation: {
      rowsRead,
      rowsImported,
      rowsRejected,
      merged: leads.filter((lead) => lead.sources.length > 1).length,
      dashboardOnly: leads.filter(
        (lead) => lead.sources.length === 1 && lead.sources[0] === "dashboard",
      ).length,
      copyOnly: leads.filter(
        (lead) =>
          lead.sources.length === 1 && lead.sources[0] === "dashboard_copy",
      ).length,
      disputedCells,
      unmappedCells,
      // Every row read left as an import or as a rejection. If this is false
      // the import lost something, and the caller must refuse to proceed.
      balanced: isBalanced({ rowsRead, rowsImported, rowsRejected }),
      splitLeadRefs: splitLeadRefs(leads),
      unmappedColumns: unmappedColumns([...primary, ...secondary]),
    },
  };
}

/**
 * Lead references that produced more than one record.
 *
 * Legitimate for `U036` only, where two named students genuinely share an ID,
 * and the caller passes that through as a known split. Anything else is a join
 * that failed, and the write boundary refuses it.
 */
export function splitLeadRefs(leads: MergedCrmLead[]): string[] {
  const byRef = new Map<string, Set<string>>();
  for (const lead of leads) {
    const key = `${lead.tab}::${lead.leadRef}`;
    const held = byRef.get(key) ?? new Set<string>();
    held.add(lead.identity);
    byRef.set(key, held);
  }
  return [...byRef.entries()]
    .filter(([, identities]) => identities.size > 1)
    .map(([key]) => key)
    .sort();
}
