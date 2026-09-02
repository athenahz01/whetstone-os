import { readRecommendedRate, type WyzantRate } from "./wyzant-rate";

/**
 * Whether a Wyzant job reaches Athena.
 *
 * The owner's rule, 2026-09-02: send when the job is relevant and its rate does
 * not contradict ours. Relevance is unchanged and still the adapter's filter -
 * Cole's four approved subjects plus the configured lesson-type and location
 * scoping. This module owns only the second half.
 *
 * The score is not consulted. It is still computed and recorded, and it no
 * longer decides what she sees, so it becomes a prediction sitting next to her
 * actual reply rather than a gate nobody has evaluated.
 *
 * `docs/WYZANT-ALERT-RULE.md` carries the reasoning and one thing to watch: the
 * board says "Recommended", and if that number is Wyzant's suggestion rather
 * than the family's budget then a $200 floor rejects almost every job carrying a
 * number at all. The rule is safe regardless because a stated absence sends, but
 * the first week of alerts should be read for it.
 */

/**
 * The floor, in dollars per hour.
 *
 * From "around $200 and above" against the $295 online rate in `docs/FACTS.md`
 * F-007. Configuration rather than a constant, because "around" is a judgement
 * the owner may want to move once she has seen real alerts, and because it may
 * need retiring entirely if the board's number turns out to be Wyzant's own.
 */
export const DEFAULT_WYZANT_MIN_RATE = 200;

/**
 * Why a job did not reach her.
 *
 * A closed vocabulary. A suppressed job is recorded with its reason rather than
 * disappearing, because a job that vanishes with no row is the defect this
 * project has found in every phase.
 */
export const WYZANT_SUPPRESSION_REASONS = ["rate_below_floor"] as const;
export type WyzantSuppressionReason =
  (typeof WYZANT_SUPPRESSION_REASONS)[number];

export type WyzantAlertDecision =
  | { send: true; rate: WyzantRate }
  | { send: false; rate: WyzantRate; reason: WyzantSuppressionReason };

export interface WyzantAlertRule {
  /** Dollars per hour. A job below this does not reach her. */
  minRate: number;
}

export function wyzantAlertRuleFromEnv(
  env: Record<string, string | undefined> = process.env,
): WyzantAlertRule {
  const raw = env.WYZANT_MIN_RATE;
  const parsed = raw === undefined ? Number.NaN : Number.parseFloat(raw);
  return {
    minRate: Number.isFinite(parsed) ? parsed : DEFAULT_WYZANT_MIN_RATE,
  };
}

/**
 * Applies the rate half of the rule.
 *
 * A stated absence sends. An unreadable cell sends, because a cell we could not
 * read is unknown rather than a lowball, and treating it as zero would reject
 * it. Only a number the board actually showed, below the floor, is refused.
 */
export function wyzantAlertDecision(
  recommendedRate: string | undefined,
  rule: WyzantAlertRule,
): WyzantAlertDecision {
  const rate = readRecommendedRate(recommendedRate);

  if (rate.kind === "amount" && rate.amount! < rule.minRate) {
    return { send: false, rate, reason: "rate_below_floor" };
  }
  return { send: true, rate };
}
