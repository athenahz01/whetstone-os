import type { CrmField, CrmSourceRow, CrmTab } from "./merge";

/**
 * The rebuilt `!Dashboard`, read off the live sheet on 2026-09-02.
 *
 * Athena rebuilt it on 28 August against the CRM Action Sheet v1.0. One header
 * row, real dates, money as numbers, and the academic columns that used to live
 * only in `Copy of !Dashboard` now sitting on the canonical sheet - so the fork
 * is resolved at the source rather than reconciled after the fact. That is the
 * point of retargeting.
 *
 * Three things about this sheet will silently corrupt an import if the map does
 * not know about them, and each has a guard below.
 */

/**
 * Tabs that are formulas over other tabs.
 *
 * `Overview` and `Action Queue` read from `UG Sales`. Importing either would
 * write every lead a second time, which is the duplication this whole phase
 * exists to end, arriving through the front door.
 *
 * `CrmTab` does not contain them, so the type system already refuses a row
 * labelled with one. This list exists so that fact is written down somewhere a
 * person reads, and so a test can assert the two sets never overlap.
 */
export const NON_IMPORTABLE_TABS = [
  "Read Me",
  "Overview",
  "Action Queue",
  "Data Issues",
  "Lists",
] as const;

/** The three tabs that hold rows rather than formulas. */
export const IMPORTABLE_TABS: readonly CrmTab[] = [
  "ug_sales",
  "g_sales",
  "affiliate",
];

/**
 * Columns the sheet computes for itself.
 *
 * `Last Touch` and `Days Quiet` are the spreadsheet's own silence clock and
 * `S5.silence-clock` computes the same two numbers from `crm_touches`. Writing
 * them into `crm_leads` would store a snapshot of a computation next to the
 * inputs it was computed from, and the two would drift the first time a touch
 * landed. That is the fork again, one table down.
 *
 * They are declared ignored at import rather than mapped, which under the
 * unmapped-column guard is a decision on record instead of a silent drop.
 */
export const REBUILT_DERIVED_COLUMNS = [
  "Last Touch",
  "Days Quiet",
  "Chase After",
  "Chase Flag",
  "Contactable",
  "Data Flags",
] as const;

/**
 * The meeting columns, which are typed history rather than lead attributes.
 *
 * `M1 Date` through `M3 Notes` record calls that happened. They belong in
 * `crm_touches`, which is what 7.5b built and what `meetingMilestones()` reads
 * to derive the old `1M/2M/3M` columns. A test in the 7.5b suite already
 * asserts that no CRM field exists for them, so mapping them here would break a
 * standing lock rather than merely be untidy.
 *
 * Declared ignored for now. The consequence is real and stated: the meeting
 * history stays in the sheet, so until `S4.touch-scan` runs against a real
 * mailbox every lead reads "no touch on record". That is what the clock already
 * reports today, so this is not a regression, but it is not nothing either.
 */
export const REBUILT_MEETING_COLUMNS = [
  "M1 Date",
  "M1 Med",
  "M1 Client",
  "M1 Closer",
  "M1 Notes",
  "M2 Date",
  "M2 Med",
  "M2 Client",
  "M2 Closer",
  "M2 Notes",
  "M3 Date",
  "M3 Med",
  "M3 Client",
  "M3 Closer",
  "M3 Notes",
] as const;

/** `_key` is the sheet's own join helper and means nothing to us. */
export const REBUILT_SHEET_INTERNALS = ["_key"] as const;

/**
 * Everything an import of this sheet is expected to leave behind.
 *
 * Passed as `ignoredColumns` so the write boundary can tell the difference
 * between a column somebody decided not to import and a column nobody noticed.
 */
export const REBUILT_IGNORED_COLUMNS: readonly string[] = [
  ...REBUILT_DERIVED_COLUMNS,
  ...REBUILT_MEETING_COLUMNS,
  ...REBUILT_SHEET_INTERNALS,
];

/**
 * The rebuilt sheet's headers, mapped to fields.
 *
 * Covers `UG Sales` and `G Sales`, which share most of their shape. `Affiliate`
 * is a different table entirely and has its own map below.
 */
export const REBUILT_COLUMN_TO_FIELD: Record<string, CrmField> = {
  "S First": "studentFirst",
  "S Last": "studentLast",
  "S Phone": "studentPhone",
  "S Email": "studentEmail",
  "HS Year": "hsYear",
  School: "school",
  Status: "status",
  Region: "region",
  "P1 First": "parent1First",
  "P1 Last": "parent1Last",
  "P1 Relation": "parent1Relation",
  "P1 Phone": "parent1Phone",
  "P1 Email": "parent1Email",
  "Contact Method": "contactMethod",
  "P2 First": "parent2First",
  "P2 Last": "parent2Last",
  "P2 Relation": "parent2Relation",
  "P2 Phone": "parent2Phone",
  "P2 Email": "parent2Email",
  Outcome: "outcome",
  "Deal Size": "dealSize",
  "Lead Date": "leadDate",
  "Referrer Source": "referrerSource",
  Referrer: "referrer",
  "Pain / Need": "painNeed",
  "Next Action": "nextAction",
  Responsible: "responsible",
  // Renamed on the rebuild, because the sheet now also derives a chase date and
  // the old bare `Due Date` had become ambiguous between the two.
  "Due Date (as entered)": "dueDate",
  Notes: "notes",
  // G Sales only, and the reason the fork existed at all.
  Target: "target",
  Type: "programType",
  Field: "field",
  "Admission Status": "admissionStatus",
  Materials: "materials",
  "SAT / GRE": "sat",
  Academic: "academic",
  "Tutoring Notes": "tutoringNotes",
  Capstone: "capstone",
  Essays: "essays",
  "Contract Start": "contractStart",
  "Contract End": "contractEnd",
  "Renewal Review": "renewalReview",
};

/**
 * `Affiliate` is a different table, not a renamed one.
 *
 * Ten columns, twenty-one rows, and counts rather than a pipeline: how many
 * leads a partner referred and how those turned out. It has no `ID`.
 */
export const REBUILT_AFFILIATE_COLUMN_TO_FIELD: Record<string, CrmField> = {
  First: "studentFirst",
  Last: "studentLast",
  Type: "programType",
  "Leads referred": "leadsReferred",
  Won: "leadsWon",
  "Lost / NQ": "leadsLost",
  "Still live": "leadsLive",
  "Last lead date": "leadDate",
  Notes: "notes",
};

/**
 * Which column holds the row's reference, per tab.
 *
 * `UG Sales` and `G Sales` key on `ID`. `Affiliate` has no `ID` column at all -
 * a partner is identified by their name - so keying it on `ID` would reject
 * every one of its twenty-one rows for having no reference, and the
 * reconciliation would balance while the whole tab landed in the rejection
 * list. A count that proves nothing was lost cannot prove anything arrived.
 */
export function referenceColumnFor(tab: CrmTab): string {
  return tab === "affiliate" ? "Full name" : "ID";
}

/** The column map for one row, chosen by its tab. */
export function rebuiltColumnMap(tab: CrmTab): Record<string, CrmField> {
  return tab === "affiliate"
    ? REBUILT_AFFILIATE_COLUMN_TO_FIELD
    : REBUILT_COLUMN_TO_FIELD;
}

/**
 * A partner's reference, built from their name when the sheet gives no id.
 *
 * `Full name` is the sheet's own key column. Where it is blank the first and
 * last names are used, so a row is only rejected when it names nobody at all.
 */
export function affiliateReference(row: CrmSourceRow): string {
  const full = (row.cells["Full name"] ?? "").trim();
  if (full) return full;
  return [row.cells["First"] ?? "", row.cells["Last"] ?? ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}
