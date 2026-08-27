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
export async function importCrmSources(
  repository: CrmRepository,
  primary: CrmSourceRow[],
  secondary: CrmSourceRow[],
): Promise<MergeResult> {
  const result = mergeCrmSources(primary, secondary);
  await writeMergeResult(repository, result);
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
): Promise<void> {
  if (!isBalanced(result.reconciliation) || !result.reconciliation.balanced) {
    throw new UnbalancedCrmImportError(result.reconciliation);
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
