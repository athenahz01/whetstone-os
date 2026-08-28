import { createHash } from "node:crypto";
import { lookupContact, type ContactIndex, type ContactKind } from "./contacts";

/**
 * What the system knows about contact with a lead, and how it knows it.
 *
 * Two rules shape everything here.
 *
 *   The record says how it was learned. `basis` is on every row: `email` and
 *   `calendar` come from a mailbox, `asserted` comes from a human answering
 *   "already spoke to them". A stall built on these rows can then state what
 *   was searched instead of implying it saw everything. Section 7 is explicit
 *   that roughly half of first meetings are phone calls with no trace, so a
 *   number presented without its basis is a claim the data does not support.
 *
 *   No prose is stored. Not the body, and not the subject line either. Subject
 *   lines carry student names as a matter of course, and the carried-forward
 *   finding from the Wyzant exception channel is that a string slot which
 *   admits prose will eventually carry a name with every test still passing.
 *   So the subject becomes a digest for correlation and the provider's own
 *   message id stays as the way back to the thread.
 */

export const TOUCH_BASES = ["email", "calendar", "asserted"] as const;
export type TouchBasis = (typeof TOUCH_BASES)[number];

/** Meeting and email are separate because the thresholds depend on it. */
export const TOUCH_KINDS = ["email", "meeting"] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];

export const TOUCH_DIRECTIONS = ["inbound", "outbound"] as const;
export type TouchDirection = (typeof TOUCH_DIRECTIONS)[number];

/**
 * Whether the touch has happened.
 *
 * A booked call is a reason not to nag, so it has to be storable before it
 * occurs, and it must not be counted as contact that already took place.
 */
export const TOUCH_STATES = ["occurred", "scheduled"] as const;
export type TouchState = (typeof TOUCH_STATES)[number];

/**
 * Why a scan produced nothing, from a closed list.
 *
 * A registered vocabulary rather than a free-text reason, following the rule
 * carried forward from the exception channel: any new string crossing a
 * boundary gets a vocabulary, not a shape that admits prose. A failure reason
 * is written by code near a mailbox, which is exactly where a subject line or
 * an address would otherwise get interpolated into it.
 */
export const TOUCH_SCAN_FAILURES = [
  "provider_unreachable",
  "provider_rejected_credentials",
  "provider_rate_limited",
  "provider_timed_out",
  "malformed_provider_response",
] as const;
export type TouchScanFailure = (typeof TOUCH_SCAN_FAILURES)[number];

export interface TouchRecord {
  identity: string;
  leadRef: string;
  basis: TouchBasis;
  kind: TouchKind;
  direction: TouchDirection;
  state: TouchState;
  occurredAt: Date;
  /** The provider's own id, so a human can open the original. Never prose. */
  sourceRef: string;
  /** A digest of the subject, for correlating a thread. Never the subject. */
  subjectRef: string | null;
  /** Which contact cell matched, so a match can be explained. */
  matchedField: string | null;
  /** Who said so. Present exactly when the basis is `asserted`. */
  assertedBy: string | null;
}

/** One message or event as a provider hands it over, before matching. */
export interface TouchCandidate {
  /** The provider's stable id for this message or event. */
  sourceRef: string;
  basis: Exclude<TouchBasis, "asserted">;
  kind: TouchKind;
  direction: TouchDirection;
  occurredAt: Date;
  /** Addresses to match on. The provider does not decide which lead it is. */
  participants: Array<{ kind: ContactKind; value: string }>;
  /** The raw subject. Digested immediately and never stored as given. */
  subject?: string;
}

/**
 * Whether a candidate has already happened, decided here rather than by the
 * provider.
 *
 * A calendar event carries a time and nothing else; whether it is a booked call
 * or a call that took place is a question about when the scan ran. Leaving that
 * to the provider would let two providers disagree about it.
 */
export function touchState(
  candidate: Pick<TouchCandidate, "basis" | "occurredAt">,
  now: Date,
): TouchState {
  if (candidate.basis !== "calendar") return "occurred";
  return candidate.occurredAt.getTime() > now.getTime()
    ? "scheduled"
    : "occurred";
}

/**
 * Read-only sources of touch candidates.
 *
 * Read-only is the whole contract: there is no send, reply, or write method to
 * call, so G1 holds by the shape of the interface rather than by a rule someone
 * has to remember. Calendar is read forwards as well as backwards, which is why
 * the window has both ends.
 */
export interface TouchProvider {
  readonly name: "email" | "calendar";
  fetch(window: { since: Date; until: Date }): Promise<TouchCandidate[]>;
}

/**
 * A stable reference to a subject line, without the subject line.
 *
 * Deterministic, so the same thread digests the same way on every run and a
 * human can see two touches belong together. Truncated because this is a
 * correlation handle, not a signature.
 */
export function subjectReference(subject: string | undefined): string | null {
  const normalized = subject?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return null;
  // Reply and forward markers are formatting, so a reply correlates with the
  // message it answers.
  const stripped = normalized.replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/g, "").trim();
  if (!stripped) return null;
  return `subj_${createHash("sha256").update(stripped).digest("hex").slice(0, 16)}`;
}

/**
 * The key a touch is stored under.
 *
 * A provider id alone is not enough: one message addressed to two leads is two
 * touches, and one lead seeing the same message twice is one. Re-running a scan
 * therefore writes nothing new, which is the idempotency the phase asks for.
 */
export function touchKey(touch: {
  identity: string;
  basis: TouchBasis;
  sourceRef: string;
}): string {
  return `${touch.identity}::${touch.basis}::${touch.sourceRef}`;
}

export interface TouchScanTally {
  candidatesRead: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  /** A candidate carrying no address to match on at all. */
  unaddressed: number;
  balanced: boolean;
}

export interface UnmatchedTouch {
  sourceRef: string;
  basis: Exclude<TouchBasis, "asserted">;
  reason: "no_matching_lead" | "ambiguous_lead" | "no_participants";
  /** How many leads the address reached, when that is the problem. */
  candidateLeads: number;
}

export interface TouchScanResult {
  touches: TouchRecord[];
  unmatched: UnmatchedTouch[];
  tally: TouchScanTally;
}

/**
 * Did every candidate read leave as a touch or as a recorded non-match?
 *
 * The same shape as the import's balance check, and it carries the same
 * limitation, which the 7.5a audit made the point of: this proves nothing was
 * dropped. It cannot prove anything was matched to the right lead. That is what
 * the separate `ambiguous` count is for, and why an ambiguous address is never
 * resolved by taking the first hit.
 */
export function isTouchScanBalanced(tally: {
  candidatesRead: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  unaddressed: number;
}): boolean {
  return (
    tally.matched + tally.unmatched + tally.ambiguous + tally.unaddressed ===
    tally.candidatesRead
  );
}

/**
 * Matches candidates against the contact index.
 *
 * One candidate can produce several touches, because a message to a student and
 * their parent is contact with one lead through two cells, and a message to two
 * families is contact with two leads. Both collapse correctly: the touch key is
 * per lead, so the first is one row and the second is two.
 */
export function detectTouches(
  index: ContactIndex,
  candidates: TouchCandidate[],
  now: Date,
): TouchScanResult {
  const byKey = new Map<string, TouchRecord>();
  const unmatched: UnmatchedTouch[] = [];
  let matched = 0;
  let ambiguous = 0;
  let unaddressed = 0;

  for (const candidate of candidates) {
    if (candidate.participants.length === 0) {
      unaddressed += 1;
      unmatched.push({
        sourceRef: candidate.sourceRef,
        basis: candidate.basis,
        reason: "no_participants",
        candidateLeads: 0,
      });
      continue;
    }

    const hits = new Map<string, { leadRef: string; field: string }>();
    let sawAmbiguity = 0;
    for (const participant of candidate.participants) {
      const lookup = lookupContact(index, participant.kind, participant.value);
      if (lookup.outcome === "matched") {
        // First cell to match wins for the label only. Which lead it is was
        // never in question, or the lookup would have said ambiguous.
        if (!hits.has(lookup.entry.identity)) {
          hits.set(lookup.entry.identity, {
            leadRef: lookup.entry.leadRef,
            field: lookup.entry.field,
          });
        }
      } else if (lookup.outcome === "ambiguous") {
        sawAmbiguity = Math.max(
          sawAmbiguity,
          new Set(lookup.entries.map((entry) => entry.identity)).size,
        );
      }
    }

    if (hits.size === 0) {
      if (sawAmbiguity > 0) {
        // An address reaching several leads is not a match to any of them.
        // Attributing it to the first would be a wrong join that every count
        // downstream still reports as healthy.
        ambiguous += 1;
        unmatched.push({
          sourceRef: candidate.sourceRef,
          basis: candidate.basis,
          reason: "ambiguous_lead",
          candidateLeads: sawAmbiguity,
        });
      } else {
        // Recorded, not discarded. A day with no matches and a day where the
        // scan failed must not look the same, and this is half of that: the
        // scan row carries the other half.
        unmatched.push({
          sourceRef: candidate.sourceRef,
          basis: candidate.basis,
          reason: "no_matching_lead",
          candidateLeads: 0,
        });
      }
      continue;
    }

    matched += 1;
    for (const [identity, hit] of hits) {
      const record: TouchRecord = {
        identity,
        leadRef: hit.leadRef,
        basis: candidate.basis,
        kind: candidate.kind,
        direction: candidate.direction,
        state: touchState(candidate, now),
        occurredAt: candidate.occurredAt,
        sourceRef: candidate.sourceRef,
        subjectRef: subjectReference(candidate.subject),
        matchedField: hit.field,
        assertedBy: null,
      };
      byKey.set(touchKey(record), record);
    }
  }

  const tally = {
    candidatesRead: candidates.length,
    matched,
    unmatched: unmatched.filter((item) => item.reason === "no_matching_lead")
      .length,
    ambiguous,
    unaddressed,
  };

  return {
    touches: [...byKey.values()],
    unmatched,
    tally: { ...tally, balanced: isTouchScanBalanced(tally) },
  };
}

/**
 * The touch a human asserts when they answer "already spoke to them".
 *
 * A real row, not a suppression flag, so the clock resets for the same reason
 * any other contact resets it and the assertion is auditable afterwards. It
 * carries `basis: "asserted"` and the name of whoever said so, because a row
 * that cannot say whether a human or a mailbox produced it is the defect this
 * phase is trying to end.
 */
export function assertedTouch(input: {
  identity: string;
  leadRef: string;
  assertedBy: string;
  occurredAt: Date;
  kind?: TouchKind;
}): TouchRecord {
  const assertedBy = input.assertedBy.trim();
  if (!assertedBy) {
    throw new Error("An asserted touch must name who asserted it.");
  }
  return {
    identity: input.identity,
    leadRef: input.leadRef,
    basis: "asserted",
    // A phone call is a meeting, not an email. Section 7 exists because these
    // are the touches nothing can see, and they are meetings.
    kind: input.kind ?? "meeting",
    direction: "outbound",
    state: "occurred",
    occurredAt: input.occurredAt,
    // Deterministic, so asserting twice on one day is one row rather than a
    // way to inflate the record by tapping repeatedly.
    sourceRef: `asserted:${input.identity}:${input.occurredAt.toISOString().slice(0, 10)}`,
    subjectRef: null,
    matchedField: null,
    assertedBy,
  };
}

/**
 * `1M`, `2M` and `3M` as a derived view.
 *
 * These were columns a human was supposed to keep current, and they are filled
 * on 8, 7 and 4 rows of 69. They are now read out of the touch record instead,
 * which is the point: nobody writes them again.
 *
 * Scheduled meetings are excluded. A booked call is a reason not to nag, not a
 * meeting that happened.
 */
export function meetingMilestones(touches: TouchRecord[]): {
  first?: Date;
  second?: Date;
  third?: Date;
} {
  const meetings = touches
    .filter((touch) => touch.kind === "meeting" && touch.state === "occurred")
    .map((touch) => touch.occurredAt)
    .sort((left, right) => left.getTime() - right.getTime());
  return { first: meetings[0], second: meetings[1], third: meetings[2] };
}

/**
 * The next booked call for a lead, if there is one.
 *
 * 7.5c suppresses a stall on this. It lives here because "is a call booked" is
 * a fact about the touch record, not about the clock that reads it.
 */
export function nextScheduledTouch(
  touches: TouchRecord[],
  now: Date,
): TouchRecord | undefined {
  return touches
    .filter(
      (touch) =>
        touch.state === "scheduled" &&
        touch.occurredAt.getTime() > now.getTime(),
    )
    .sort(
      (left, right) => left.occurredAt.getTime() - right.occurredAt.getTime(),
    )[0];
}

/**
 * What the record can and cannot see, for a lead.
 *
 * Returned alongside any number computed from these touches so the number is
 * never presented as a complete picture. Personal-mobile calls leave no trace
 * and are roughly half of first meetings, so "quiet 11 days" without this is a
 * claim about silence that the data cannot support.
 */
/**
 * What a scan actually covered, as opposed to what it is supposed to cover.
 *
 * `S4.touch-scan` isolates provider failures so a calendar outage does not cost
 * a day of email evidence. That is the right behaviour, and it means a run can
 * succeed having read only half of what it names.
 */
export interface ScanCoverage {
  /** Providers that returned on this run. */
  read: TouchBasis[];
  /** Providers that were attempted and failed. */
  failed: TouchBasis[];
  /** When each provider last returned, where that is known. */
  lastReadAt?: Partial<Record<TouchBasis, Date>>;
}

/**
 * What was actually searched, what turned up, and what could not be seen.
 *
 * `searched` used to be the constant `["calendar", "email"]`. That asserted a
 * search the run may not have performed: a provider can fail, the scan
 * continues by design, and every stall line still claimed both mailboxes were
 * read. A person reading "quiet 11 days, searched calendar and email" would
 * conclude nobody had emailed, when the truth was that nobody had looked.
 *
 * The standing blindness - phone calls from personal mobiles - is different. It
 * is true on every run regardless of coverage, so it is stated unconditionally.
 */
export function evidenceBasis(
  touches: TouchRecord[],
  coverage: ScanCoverage,
): {
  searched: TouchBasis[];
  observed: TouchBasis[];
  blindTo: string[];
  staleBases: TouchBasis[];
} {
  const observed = [...new Set(touches.map((touch) => touch.basis))].sort();
  const searched = [...coverage.read].sort();
  const blindTo = ["phone calls from personal mobiles"];
  for (const failed of [...coverage.failed].sort()) {
    blindTo.push(`${failed}, which was attempted and failed on this run`);
  }
  return {
    searched,
    observed,
    blindTo,
    staleBases: [...coverage.failed].sort(),
  };
}
