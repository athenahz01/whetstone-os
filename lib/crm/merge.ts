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

/** Which file a value came from. `!Dashboard` is the working default. */
export type CrmSource = "dashboard" | "dashboard_copy";

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

export const MERGED_FIELDS = [
  "studentFirst",
  "studentLast",
  ...FUNNEL_FIELDS,
  ...ACADEMIC_FIELDS,
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
  /** True only when imported plus rejected accounts for every row read. */
  balanced: boolean;
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
    const identity = crmIdentity(row.tab, leadRef, first, last);
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
    },
  };
}
