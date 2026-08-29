import type { CrmField } from "./merge";
import {
  isBalanced,
  mergeCrmSources,
  type CrmRejection,
  type CrmSourceRow,
  type MergeResult,
} from "./merge";

/**
 * Persisting the merge, and applying a ruling afterwards.
 *
 * Two properties the acceptance criteria turn on:
 *
 *   Re-running the import changes nothing. Records are keyed on an identity
 *   derived from the row, so a second run upserts the same rows rather than
 *   duplicating them, and a diff of the table before and after is empty.
 *
 *   A ruling is an update. Answering one of the six head-to-head conflicts
 *   touches one dispute and one field on one lead. It never re-reads a sheet,
 *   which is what lets the import happen now and the rulings arrive whenever
 *   they arrive.
 */

export interface StoredCrmLead {
  identity: string;
  leadRef: string;
  tab: string;
  values: Partial<Record<CrmField, string>>;
  statusRaw: string;
  statusValue: string | null;
  statusUnmapped: boolean;
  referrerSourceRaw: string;
  referrerSourceValue: string | null;
  referrerSourceUnmapped: boolean;
  sources: string[];
}

export interface StoredCrmDispute {
  identity: string;
  field: CrmField;
  workingValue: string;
  workingSource: string;
  alternateValue: string;
  alternateSource: string;
  resolvedValue: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
}

export interface CrmImportSummary {
  rowsRead: number;
  rowsImported: number;
  rowsRejected: number;
  merged: number;
  dashboardOnly: number;
  copyOnly: number;
  disputedCells: number;
  unmappedCells: number;
  balanced: boolean;
}

export interface CrmRepository {
  upsertLead(lead: StoredCrmLead): Promise<void>;
  upsertDispute(dispute: StoredCrmDispute): Promise<void>;
  recordRejection(rejection: CrmRejection): Promise<void>;
  recordImportRun(summary: CrmImportSummary): Promise<void>;
  /** Resolves one dispute and writes the chosen value onto its lead. */
  resolveDispute(input: {
    identity: string;
    field: CrmField;
    resolvedValue: string;
    resolvedBy: string;
    resolvedAt: Date;
  }): Promise<void>;
}

export class UnbalancedCrmImportError extends Error {
  constructor(summary: CrmImportSummary) {
    super(
      `Import refused: ${summary.rowsRead} rows read but ${summary.rowsImported} imported and ${summary.rowsRejected} rejected. A row went missing.`,
    );
    this.name = "UnbalancedCrmImportError";
  }
}

/**
 * What this particular import is allowed to shrug at.
 *
 * Required rather than defaulted, and both fields spelled out at every call
 * site. The previous default named `ug_sales::U036` - one fact about one row of
 * one export - so every future caller silently inherited an assertion about
 * data it had never seen. That is the shape the `ScanCoverage` finding named:
 * an optimistic default is worse than no default, because nobody has to type it
 * to be covered by it.
 */
export interface CrmWriteAllowances {
  /** Lead references legitimately held by two students. */
  knownSplitLeadRefs: string[];
  /** Headers deliberately not imported. Naming one is a decision on record. */
  ignoredColumns?: string[];
}

/**
 * The sheet holds columns the importer does not read.
 *
 * Thrown before anything is written, because the alternative is a lead record
 * that looks imported and is missing whatever those columns held.
 */
export class UnmappedCrmColumnError extends Error {
  constructor(
    readonly columns: Array<{ column: string; filledCells: number }>,
  ) {
    super(
      `Refusing to write: ${columns.length} column(s) hold data that no field maps to, and none was declared ignored: ${columns
        .map((usage) => `${usage.column} (${usage.filledCells} filled)`)
        .join(", ")}.`,
    );
    this.name = "UnmappedCrmColumnError";
  }
}

export class UnknownCrmDisputeError extends Error {
  constructor(identity: string, field: string) {
    super(`No open dispute on ${identity} for ${field}.`);
    this.name = "UnknownCrmDisputeError";
  }
}

/**
 * Runs the merge and writes it.
 *
 * Refuses to write anything if the reconciliation does not balance. A partial
 * import that looks successful is the failure mode this phase names first: a
 * silently dropped row fails the phase.
 */
/**
 * One lead reference produced more than one record, and the split was not a
 * declared one.
 *
 * Refused rather than written, for the same reason an unbalanced import is:
 * a half-joined record looks like data and behaves like a bug.
 */
export class SplitCrmLeadError extends Error {
  constructor(readonly leadRefs: string[]) {
    super(
      `Refusing to write: ${leadRefs.length} lead reference(s) produced more than one record and were not declared as splits: ${leadRefs.join(", ")}.`,
    );
    this.name = "SplitCrmLeadError";
  }
}

export async function importCrmSources(
  repository: CrmRepository,
  primary: CrmSourceRow[],
  secondary: CrmSourceRow[],
  allowances: CrmWriteAllowances,
): Promise<MergeResult> {
  const result = mergeCrmSources(primary, secondary);
  await writeMergeResult(repository, result, allowances);
  return result;
}

/**
 * Imports one authoritative sheet.
 *
 * The rebuilt `!Dashboard` is not a fork, so there is no second file for a cell
 * to disagree with and nothing can arrive disputed. That is asserted rather
 * than assumed: a dispute out of a single-source import would mean the same
 * sheet contradicted itself, which is a defect in the merge and not a question
 * for a human.
 */
export async function importSingleSource(
  repository: CrmRepository,
  rows: CrmSourceRow[],
  allowances: CrmWriteAllowances,
): Promise<MergeResult> {
  const foreign = rows.filter((row) => row.source !== rows[0]?.source);
  if (foreign.length > 0) {
    throw new Error(
      `A single-source import received rows from ${new Set(rows.map((row) => row.source)).size} sources.`,
    );
  }
  const result = mergeCrmSources(rows, []);
  const disputed = result.leads.filter((lead) => lead.disputes.length > 0);
  if (disputed.length > 0) {
    throw new Error(
      `A single-source import produced ${disputed.length} disputed lead(s). One sheet cannot disagree with itself.`,
    );
  }
  await writeMergeResult(repository, result, allowances);
  return result;
}

/**
 * Writes a reconciled result, or refuses to write any part of it.
 *
 * Separate from `importCrmSources` because `mergeCrmSources` balances by
 * construction and cannot reach the refusal. A guard no test can enter is a
 * guard nobody knows is there, and this one is the difference between a partial
 * import and a stopped one.
 *
 * The check reads `isBalanced` against the totals rather than trusting the
 * `balanced` flag on the summary, so a summary that carries the wrong flag is
 * still refused.
 */
export async function writeMergeResult(
  repository: CrmRepository,
  result: MergeResult,
  options: CrmWriteAllowances,
): Promise<void> {
  if (!isBalanced(result.reconciliation) || !result.reconciliation.balanced) {
    throw new UnbalancedCrmImportError(result.reconciliation);
  }

  // Balance proves nothing was lost. It cannot prove anything was joined
  // correctly - two rows that should be one lead balance perfectly - so the
  // split count is checked separately.
  //
  // Every split is a join that failed unless the caller says otherwise. Against
  // the old export there were three (U045, U046, U047), each producing one
  // record with the sales funnel and one with the academic columns, and writing
  // that would rebuild the fork this phase exists to end.
  const known = new Set(options.knownSplitLeadRefs);
  const unexpected = result.reconciliation.splitLeadRefs.filter(
    (ref) => !known.has(ref),
  );
  if (unexpected.length > 0) {
    throw new SplitCrmLeadError(unexpected);
  }

  // A header the map does not read is not an error on the sheet it was written
  // for. On any other sheet it is data arriving nowhere, and the import would
  // balance while the leads came out blank.
  const declared = new Set(options.ignoredColumns ?? []);
  const undeclared = result.reconciliation.unmappedColumns.filter(
    (usage) => !declared.has(usage.column),
  );
  if (undeclared.length > 0) {
    throw new UnmappedCrmColumnError(undeclared);
  }

  for (const lead of result.leads) {
    await repository.upsertLead({
      identity: lead.identity,
      leadRef: lead.leadRef,
      tab: lead.tab,
      values: lead.values,
      statusRaw: lead.status.raw,
      statusValue: lead.status.value,
      statusUnmapped: lead.status.unmapped,
      referrerSourceRaw: lead.referrerSource.raw,
      referrerSourceValue: lead.referrerSource.value,
      referrerSourceUnmapped: lead.referrerSource.unmapped,
      sources: [...lead.sources].sort(),
    });
    for (const dispute of lead.disputes) {
      await repository.upsertDispute({
        identity: lead.identity,
        field: dispute.field,
        workingValue: dispute.workingValue,
        workingSource: dispute.workingSource,
        alternateValue: dispute.alternateValue,
        alternateSource: dispute.alternateSource,
        resolvedValue: null,
        resolvedBy: null,
        resolvedAt: null,
      });
    }
  }
  for (const rejection of result.rejections) {
    await repository.recordRejection(rejection);
  }
  await repository.recordImportRun(result.reconciliation);
}

/** The open disputes, for the ruling list. */
export function rulingList(result: MergeResult) {
  return result.leads.flatMap((lead) =>
    lead.disputes.map((dispute) => ({
      leadRef: lead.leadRef,
      identity: lead.identity,
      student:
        `${lead.values.studentFirst ?? ""} ${lead.values.studentLast ?? ""}`.trim(),
      field: dispute.field,
      workingValue: dispute.workingValue,
      alternateValue: dispute.alternateValue,
    })),
  );
}
