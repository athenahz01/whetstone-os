import type { ContactIndex } from "./contacts";
import {
  detectTouches,
  isTouchScanBalanced,
  type TouchProvider,
  type TouchRecord,
  type TouchScanFailure,
  type UnmatchedTouch,
} from "./touches";

/**
 * Running a scan, and recording that it ran.
 *
 * The acceptance criterion this file exists for: a day with no matches and a
 * day where the scan failed must not look identical. They look identical
 * whenever the only evidence of a scan is the rows it wrote, because both write
 * nothing. So every attempt writes a scan row first-class, carrying its own
 * outcome, and the absence of a scan row is itself readable as "the job did not
 * run" rather than as "nothing happened".
 *
 * This is KPI #4's denominator rule applied to a different job: the attempt is
 * what gets counted, not just the success.
 */

export type TouchScanStatus = "completed" | "failed";

export interface TouchScanRecord {
  provider: TouchProvider["name"];
  windowStart: Date;
  windowEnd: Date;
  status: TouchScanStatus;
  /** Set exactly when the status is `failed`, and from a closed list. */
  failureReason: TouchScanFailure | null;
  candidatesRead: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  unaddressed: number;
  balanced: boolean;
}

export interface TouchRepository {
  /** Writes a touch, or leaves the existing row alone. Keyed, so re-running is a no-op. */
  upsertTouch(touch: TouchRecord): Promise<void>;
  recordUnmatched(
    unmatched: UnmatchedTouch & { scannedAt: Date },
  ): Promise<void>;
  recordScan(scan: TouchScanRecord): Promise<void>;
}

export class UnbalancedTouchScanError extends Error {
  constructor(tally: TouchScanRecord) {
    super(
      `Touch scan refused: ${tally.candidatesRead} candidates read but ${tally.matched} matched, ${tally.unmatched} unmatched, ${tally.ambiguous} ambiguous and ${tally.unaddressed} unaddressed. A candidate went missing.`,
    );
    this.name = "UnbalancedTouchScanError";
  }
}

/**
 * Sorts a provider failure into the closed vocabulary.
 *
 * Deliberately not the thrown message. A provider error message is prose from
 * outside the system, and interpolating it into a stored reason is how a
 * learner's address reaches a column that nothing validates. The classification
 * is coarse on purpose: five reasons a human can act on, rather than a faithful
 * copy of a stack trace.
 */
export function classifyScanFailure(error: unknown): TouchScanFailure {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  // Ordered most specific first. A bare `token` matched "unexpected token in
  // JSON" and classified a parse failure as a credentials problem, which would
  // have sent someone to re-issue a key that was never the issue.
  if (/rate|throttl|429|quota/.test(message)) return "provider_rate_limited";
  if (/timeout|timed out|etimedout/.test(message)) return "provider_timed_out";
  if (/parse|malformed|unexpected token|invalid json/.test(message)) {
    return "malformed_provider_response";
  }
  if (/auth|credential|login|password|access token|401|403/.test(message)) {
    return "provider_rejected_credentials";
  }
  return "provider_unreachable";
}

export interface TouchScanOutcome {
  scan: TouchScanRecord;
  touches: TouchRecord[];
}

/**
 * Reads one provider over one window and writes what it found.
 *
 * Read-only throughout: the provider interface has no send, and this function
 * calls `fetch` and nothing else. A failure is recorded and rethrown rather
 * than swallowed, so a caller polling several providers can isolate one failure
 * without the failure disappearing.
 */
export async function runTouchScan(
  provider: TouchProvider,
  index: ContactIndex,
  repository: TouchRepository,
  window: { since: Date; until: Date },
  now: Date,
): Promise<TouchScanOutcome> {
  const base = {
    provider: provider.name,
    windowStart: window.since,
    windowEnd: window.until,
  };

  let candidates;
  try {
    candidates = await provider.fetch(window);
  } catch (error) {
    // The attempt is recorded before the throw. Without this row a failed scan
    // and a quiet day are the same absence.
    const scan: TouchScanRecord = {
      ...base,
      status: "failed",
      failureReason: classifyScanFailure(error),
      candidatesRead: 0,
      matched: 0,
      unmatched: 0,
      ambiguous: 0,
      unaddressed: 0,
      balanced: true,
    };
    await repository.recordScan(scan);
    throw error;
  }

  const result = detectTouches(index, candidates, now);
  const scan: TouchScanRecord = {
    ...base,
    status: "completed",
    failureReason: null,
    ...result.tally,
  };

  // Re-derived from the totals rather than trusted from the flag, the same way
  // the import checks its own balance at the write boundary.
  if (!isTouchScanBalanced(scan) || !result.tally.balanced) {
    throw new UnbalancedTouchScanError(scan);
  }

  for (const touch of result.touches) await repository.upsertTouch(touch);
  for (const unmatched of result.unmatched) {
    await repository.recordUnmatched({ ...unmatched, scannedAt: now });
  }
  await repository.recordScan(scan);

  return { scan, touches: result.touches };
}
