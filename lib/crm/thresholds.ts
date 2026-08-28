import type { CrmStatus } from "./vocabulary";
import { LIVE_CRM_STATUSES } from "./vocabulary";
import type { TouchRecord } from "./touches";

/**
 * How long a lead may go quiet before the clock calls it a stall.
 *
 * Configuration, not constants. The brief gives starting values and says they
 * are to be tuned, so they arrive as a value the caller passes in and every
 * function here takes them as an argument. A number compiled into a comparison
 * cannot be tuned without a deploy, and a threshold nobody can move is a
 * threshold nobody will move.
 *
 * A stage absent from the map is excluded from the clock entirely. Complete,
 * Lost, NQ and Inactive are not quiet; they are finished.
 */

export type SilenceThresholds = Partial<Record<CrmStatus, number>>;

/** The brief's starting values. To be tuned, which is why they are data. */
export const DEFAULT_SILENCE_THRESHOLDS: SilenceThresholds = Object.freeze({
  Negotiate: 3,
  Active: 7,
  Engage: 7,
  Prospect: 14,
  Cold: 30,
});

/**
 * Why a lead's threshold differs from its stage default.
 *
 * A closed vocabulary, following the rule carried forward from the exception
 * channel: any new string that crosses a boundary gets a registered term, not a
 * shape that admits prose. A tuning reason is written next to a lead record,
 * which is exactly where a student's name would otherwise be interpolated into
 * an explanation of why the system stopped nagging about them.
 */
export const THRESHOLD_ADJUSTMENT_REASONS = ["asserted_only_run"] as const;
export type ThresholdAdjustmentReason =
  (typeof THRESHOLD_ADJUSTMENT_REASONS)[number];

export interface ThresholdAdjustment {
  identity: string;
  leadRef: string;
  stage: CrmStatus;
  /** The stage default this replaces, so the change is legible. */
  baseDays: number;
  adjustedDays: number;
  reason: ThresholdAdjustmentReason;
  /** The evidence: how many asserted touches ran with nothing else between. */
  assertedRunLength: number;
}

export interface WideningPolicy {
  /** Consecutive asserted touches before the threshold widens. */
  afterAssertedRun: number;
  /** What the stage default is multiplied by. */
  multiplier: number;
}

/**
 * The section 7 rule, as data.
 *
 * A lead marked "already spoke to them" three times with no email or calendar
 * trace between is a relationship run entirely by phone. Nagging it on a
 * cadence built from evidence the system does not have is how a false stall
 * becomes a daily habit. Both numbers are configuration for the same reason the
 * thresholds are.
 */
export const DEFAULT_WIDENING_POLICY: WideningPolicy = Object.freeze({
  afterAssertedRun: 3,
  multiplier: 2,
});

/**
 * How many asserted touches run back from the most recent, unbroken.
 *
 * Counted from the newest touch backwards and stopped by the first `email` or
 * `calendar` row, because the rule is about a relationship that has gone dark
 * to the mailbox now, not about how many assertions exist in total. A lead with
 * three assertions last year and an email yesterday is visible again.
 */
export function assertedRunLength(touches: TouchRecord[]): number {
  const ordered = [...touches]
    .filter((touch) => touch.state === "occurred")
    .sort(
      (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
    );
  let run = 0;
  for (const touch of ordered) {
    if (touch.basis !== "asserted") break;
    run += 1;
  }
  return run;
}

/**
 * The threshold for one lead, and the adjustment if it was widened.
 *
 * Returns the adjustment rather than only the number, so a caller that widens a
 * threshold has the record in hand and cannot forget to write it. Section 7
 * calls a silent tuning out by name: the change is a fact about the lead and
 * has to be as visible as the stall it suppresses.
 */
export function thresholdFor(
  stage: CrmStatus,
  touches: TouchRecord[],
  thresholds: SilenceThresholds,
  policy: WideningPolicy = DEFAULT_WIDENING_POLICY,
  lead?: { identity: string; leadRef: string },
): { days: number; adjustment?: ThresholdAdjustment } | undefined {
  const baseDays = thresholds[stage];
  if (baseDays === undefined) return undefined;

  const run = assertedRunLength(touches);
  if (run < policy.afterAssertedRun) return { days: baseDays };

  const adjustedDays = baseDays * policy.multiplier;
  return {
    days: adjustedDays,
    adjustment: {
      identity: lead?.identity ?? "",
      leadRef: lead?.leadRef ?? "",
      stage,
      baseDays,
      adjustedDays,
      reason: "asserted_only_run",
      assertedRunLength: run,
    },
  };
}

/** Stages the clock watches at all, derived rather than restated. */
export function clockedStages(thresholds: SilenceThresholds): CrmStatus[] {
  return LIVE_CRM_STATUSES.filter((stage) => thresholds[stage] !== undefined);
}
