/**
 * The board's `Recommended rate` field, read into something a rule can use.
 *
 * Three outcomes, and the distinction between two of them is the whole point.
 *
 * `none` is the board saying the family stated no preference. It is the common
 * case - both cards in the real capture read `Recommended rate: None` - and the
 * owner's rule treats it as an opening rather than a rejection.
 *
 * `unreadable` is us failing to read the cell. It is not a lowball and it is not
 * a stated absence, and collapsing it into either would be the system claiming a
 * fact it does not have. It sends, like `none`, but it is recorded separately so
 * the two can be told apart after a week of real alerts.
 *
 * `amount` is a number the board actually showed.
 *
 * A closed vocabulary rather than a free string, because this value crosses the
 * runner boundary on its way from the GitHub Actions poll to the ingest route.
 * That is the boundary where a free-text slot put a learner's name on the wire
 * with every test passing, and the rule since is that anything crossing it gets
 * a registered term.
 */

export const WYZANT_RATE_KINDS = ["none", "amount", "unreadable"] as const;
export type WyzantRateKind = (typeof WYZANT_RATE_KINDS)[number];

export interface WyzantRate {
  kind: WyzantRateKind;
  /** Present only when `kind` is `amount`. Dollars per hour. */
  amount?: number;
}

/** The label the board puts in front of the value. */
const RATE_LABEL = /recommended\s+rate\s*:?\s*/i;

/**
 * Reads the cell.
 *
 * Deliberately narrow about what counts as a number. A cell holding prose with a
 * digit somewhere in it is not a rate, and coercing it into one would produce a
 * threshold decision from something nobody wrote as a price.
 */
export function readRecommendedRate(raw: string | undefined): WyzantRate {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { kind: "unreadable" };

  const value = text.replace(RATE_LABEL, "").trim();
  if (!value) return { kind: "unreadable" };
  if (/^none$/i.test(value)) return { kind: "none" };

  // `$55/hr`, `$55 per hour`, `55`. Anything else is not a price we can read.
  const match =
    /^\$?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*hr|\/\s*hour|per hour)?$/i.exec(value);
  if (!match) return { kind: "unreadable" };

  // No guard for a negative or non-finite amount: the pattern above only
  // matches unsigned digits, so `parseFloat` here cannot produce one. A guard
  // for it was a line no test could reach.
  return { kind: "amount", amount: Number.parseFloat(match[1]!) };
}

/** How the rate reads in an email to the owner. Never in a log. */
export function describeRate(rate: WyzantRate): string {
  if (rate.kind === "amount") return `$${rate.amount}/hr recommended`;
  if (rate.kind === "none") return "no rate stated";
  return "rate could not be read";
}
