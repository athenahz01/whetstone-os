import { actionableValue, type CrmLeadView } from "./actionable";
import type { ContactIndex } from "./contacts";
import type { CrmField } from "./merge";
import {
  evidenceBasis,
  nextScheduledTouch,
  type TouchBasis,
  type TouchRecord,
  type ScanCoverage,
} from "./touches";
import {
  thresholdFor,
  type SilenceThresholds,
  type ThresholdAdjustment,
  type WideningPolicy,
} from "./thresholds";
import { isLiveStatus, readStatus, type CrmStatus } from "./vocabulary";

/**
 * The silence clock: how long since anyone spoke to a lead, and whether that is
 * longer than it should be.
 *
 * The rule the whole file is built around is that **there is no healthy silence
 * by default**. A spreadsheet answers "what needs checking in on" only when
 * somebody remembers to ask, and the failure mode being replaced is a lead
 * going quiet for six months while the file looks fine. So every lead lands in
 * exactly one outcome and none of them is an absence: a lead the clock cannot
 * measure is `unmeasurable`, a lead it cannot match on is `unmonitorable`, and
 * a lead whose contacts reach somebody else is `unattributable`. All three are
 * visible. None of them reads as "no action needed".
 *
 * This follows the Wyzant source-expiry rule the brief cites: a source that
 * cannot be re-checked is marked unverified, never expired. The same distinction
 * applies to a person.
 *
 * The second rule is that a number never travels without its evidence. Section 7
 * is explicit that roughly half of first meetings are phone calls from personal
 * mobiles that leave no trace, so "quiet 11 days" on its own is a claim about
 * silence that the data cannot support. Every entry carries what was searched,
 * what was blind, and which of this lead's own contact cells are invisible.
 */

export type ClockOutcome =
  /** Quiet longer than its stage allows. */
  | "stall"
  /** Quiet, but not yet longer than its stage allows. */
  | "within-threshold"
  /** A call is booked ahead. Not a stall however quiet it has been. */
  | "booked"
  /** A human held it back until a date. Returns on its own afterwards. */
  | "snoozed"
  /** Nothing usable to match a message against. */
  | "unmonitorable"
  /** Every usable contact reaches more than one lead. */
  | "unattributable"
  /** No touch and no lead date, so the silence has no measurable length. */
  | "unmeasurable"
  /** The stage puts it outside the clock, or there is no usable stage. */
  | "not-clocked";

export type NotClockedReason =
  | "closed-stage"
  | "disputed-stage"
  | "unmapped-stage"
  | "no-stage"
  /** A live stage with no threshold configured for it. */
  | "no-threshold";

export interface ClockEvidence {
  /** The bases actually searched. Always both mailboxes. */
  searched: TouchBasis[];
  /** The bases this lead has any record from. */
  observed: TouchBasis[];
  /** What no scan can see, stated rather than implied. */
  blindTo: string[];
  /**
   * This lead's own contact cells that cannot produce a match.
   *
   * A partially shared lead still matches on its unshared cells, which is worse
   * than being wholly blind because the record looks partly alive. Naming the
   * fields lets the stall line say which half it is missing.
   */
  invisibleFields: CrmField[];
}

export interface LastTouch {
  basis: TouchBasis;
  sourceRef: string;
  occurredAt: Date;
  matchedField: string | null;
}

export interface ClockEntry {
  identity: string;
  leadRef: string;
  outcome: ClockOutcome;
  /** Present when the stage is one the clock watches. */
  stage?: CrmStatus;
  /** Present when the outcome is `not-clocked`. */
  notClockedReason?: NotClockedReason;
  /** Days since the last occurred touch, or since the lead date. */
  daysQuiet?: number;
  /** What `daysQuiet` was measured from, so the number can be defended. */
  measuredFrom?: "last-touch" | "lead-date";
  thresholdDays?: number;
  /** Days past the threshold. The ranking key. */
  overdueDays?: number;
  /** The touch that produced the number, or undefined when there is none. */
  lastTouch?: LastTouch;
  /** The booked call that suppressed the stall. */
  nextBooked?: Date;
  /** When a snooze lapses and the lead comes back on its own. */
  snoozedUntil?: Date;
  /** Named for `unmonitorable`: the cells that held nothing usable. */
  missingFields?: CrmField[];
  /** Named for `unattributable`: the cells that reach more than one lead. */
  sharedFields?: CrmField[];
  evidence: ClockEvidence;
}

export interface SilenceClockInput {
  leads: CrmLeadView[];
  index: ContactIndex;
  /** Touches keyed by lead identity. */
  touchesByIdentity: Map<string, TouchRecord[]>;
  thresholds: SilenceThresholds;
  now: Date;
  policy?: WideningPolicy;
  /**
   * Leads a human has held back, and until when.
   *
   * A snooze suppresses for exactly its window and then the lead returns
   * without anybody remembering to bring it back. That is the difference
   * between deferring a decision and losing one, and losing one quietly is the
   * failure this whole phase exists to end.
   */
  snoozedUntil?: Map<string, Date>;
  /**
   * What this run's scan actually covered. Required, not defaulted.
   *
   * A default here would be an optimistic assertion that every caller who
   * forgot would inherit, which is the shape of the defect this field exists
   * to close.
   */
  coverage: ScanCoverage;
}

export interface SilenceClockResult {
  /** Every lead, in exactly one outcome. */
  entries: ClockEntry[];
  /** The stalls, most overdue first. */
  stalls: ClockEntry[];
  /** Visible but unmeasurable: unmonitorable, unattributable, unmeasurable. */
  needsAttention: ClockEntry[];
  /** Threshold changes this run made, each carrying its reason. */
  adjustments: ThresholdAdjustment[];
  /** Every lead accounted for. The same invariant the import and scan carry. */
  balanced: boolean;
  /**
   * What this run's scan covered, carried through rather than inferred.
   *
   * A reader that reconstructs coverage from the entries gets it wrong the
   * moment there are no entries: a day with no live leads would report that
   * nothing was searched, which is the opposite of what happened.
   */
  coverage: ScanCoverage;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Most urgent stage first, so two equally overdue leads order sensibly. */
const STAGE_URGENCY: CrmStatus[] = [
  "Negotiate",
  "Active",
  "Engage",
  "Prospect",
  "Cold",
];

function lastOccurredTouch(touches: TouchRecord[]): TouchRecord | undefined {
  return [...touches]
    .filter((touch) => touch.state === "occurred")
    .sort(
      (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
    )[0];
}

function parseLeadDate(lead: CrmLeadView): Date | undefined {
  const raw = actionableValue(lead, "leadDate");
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Runs the clock over every lead.
 *
 * The order of the checks is the order of the questions. Is this lead the
 * clock's business at all? Can it be matched on? Is a call already booked? Only
 * then, how long has it been quiet. Reversing any two of those produces a
 * confident number about a lead nobody could have heard from.
 */
export function runSilenceClock(input: SilenceClockInput): SilenceClockResult {
  const entries: ClockEntry[] = [];
  const adjustments: ThresholdAdjustment[] = [];

  const unmonitorable = new Map(
    input.index.unmonitorable.map((item) => [item.identity, item]),
  );
  const unattributable = new Map(
    input.index.unattributable.map((item) => [item.identity, item]),
  );

  for (const lead of input.leads) {
    const touches = input.touchesByIdentity.get(lead.identity) ?? [];
    const shared = unattributable.get(lead.identity);
    const base = {
      identity: lead.identity,
      leadRef: lead.leadRef,
      evidence: {
        ...evidenceBasis(touches, input.coverage),
        // A partially shared lead names the half it cannot see. A wholly shared
        // one never reaches here as a stall, so this is the case that matters.
        invisibleFields: shared?.sharedFields ?? [],
      },
    };

    const notClocked = readStage(lead);
    if ("reason" in notClocked) {
      entries.push({
        ...base,
        outcome: "not-clocked",
        notClockedReason: notClocked.reason,
      });
      continue;
    }
    const stage = notClocked.stage;

    // Reachability before recency. A lead nobody could have been recorded
    // talking to has a meaningless quiet count, and printing one would be the
    // system asserting a fact it does not have.
    const missing = unmonitorable.get(lead.identity);
    if (missing) {
      entries.push({
        ...base,
        outcome: "unmonitorable",
        stage,
        missingFields: missing.missingFields,
      });
      continue;
    }
    if (shared?.wholly) {
      // Indexed, not disputed, and still unable to be credited a touch: every
      // message on its details resolves ambiguous. It used to pass every count
      // as healthy, which is exactly why it gets its own outcome.
      entries.push({
        ...base,
        outcome: "unattributable",
        stage,
        sharedFields: shared.sharedFields,
      });
      continue;
    }

    // A snooze outranks the quiet count but not reachability: a lead nobody
    // could ever be recorded talking to is still worth surfacing, and holding
    // it back would hide the reason rather than the noise.
    const heldUntil = input.snoozedUntil?.get(lead.identity);
    if (heldUntil && heldUntil.getTime() > input.now.getTime()) {
      entries.push({
        ...base,
        outcome: "snoozed",
        stage,
        snoozedUntil: heldUntil,
      });
      continue;
    }

    const booked = nextScheduledTouch(touches, input.now);
    if (booked) {
      entries.push({
        ...base,
        outcome: "booked",
        stage,
        nextBooked: booked.occurredAt,
      });
      continue;
    }

    const resolved = thresholdFor(
      stage,
      touches,
      input.thresholds,
      input.policy,
      lead,
    );
    if (!resolved) {
      // A live stage with no threshold configured. Its own reason, because
      // calling it closed would say the lead is finished when what actually
      // happened is that somebody removed a setting.
      entries.push({
        ...base,
        outcome: "not-clocked",
        stage,
        notClockedReason: "no-threshold",
      });
      continue;
    }
    if (resolved.adjustment) adjustments.push(resolved.adjustment);

    const last = lastOccurredTouch(touches);
    const leadDate = parseLeadDate(lead);
    const from = last?.occurredAt ?? leadDate;
    if (!from) {
      // Never touched and no lead date. The silence is real but its length is
      // not knowable, and a fabricated zero would read as fresh.
      entries.push({
        ...base,
        outcome: "unmeasurable",
        stage,
        thresholdDays: resolved.days,
      });
      continue;
    }

    const daysQuiet = daysBetween(from, input.now);
    const overdueDays = daysQuiet - resolved.days;
    entries.push({
      ...base,
      outcome: overdueDays > 0 ? "stall" : "within-threshold",
      stage,
      daysQuiet,
      measuredFrom: last ? "last-touch" : "lead-date",
      thresholdDays: resolved.days,
      overdueDays,
      lastTouch: last
        ? {
            basis: last.basis,
            sourceRef: last.sourceRef,
            occurredAt: last.occurredAt,
            matchedField: last.matchedField,
          }
        : undefined,
    });
  }

  const stalls = entries
    .filter((entry) => entry.outcome === "stall")
    .sort(rankStalls);
  const needsAttention = entries.filter(
    (entry) =>
      entry.outcome === "unmonitorable" ||
      entry.outcome === "unattributable" ||
      entry.outcome === "unmeasurable",
  );

  return {
    entries,
    stalls,
    needsAttention,
    adjustments,
    // Every lead left in exactly one outcome. The same invariant the import and
    // the touch scan carry, and it means the same thing: nothing was dropped.
    balanced: entries.length === input.leads.length,
    coverage: input.coverage,
  };
}

/**
 * How far past due a lead is, measured in its own stage's terms.
 *
 * Ranking on absolute overdue days systematically buries the urgent stages.
 * A Cold lead has a 30 day threshold, so a year of neglect scores 335; a
 * Negotiate lead has a 3 day threshold, so ten days of silence scores 7 - and
 * the Cold lead wins, although it is the Negotiate lead that is about to close
 * or be lost.
 *
 * Against the live export this was not marginal. On the clock's first run every
 * lead is measured from its lead date, and the single Negotiate lead in the
 * whole pipeline ranked twelfth of fifteen, held back behind Cold leads from
 * mid-2025 that nobody is working. The five-item cap meant it would not have
 * been shown at all.
 *
 * The ratio is the honest comparison: ten days quiet against a three day
 * threshold is 3.3 times past due, and forty days against thirty is 1.3.
 */
function overdueRatio(entry: ClockEntry): number {
  const threshold = entry.thresholdDays ?? 0;
  const quiet = entry.daysQuiet ?? 0;
  if (threshold <= 0) return quiet > 0 ? Number.POSITIVE_INFINITY : 0;
  return quiet / threshold;
}

function rankStalls(left: ClockEntry, right: ClockEntry): number {
  const byRatio = overdueRatio(right) - overdueRatio(left);
  if (byRatio !== 0) return byRatio;
  const byStage =
    STAGE_URGENCY.indexOf(left.stage as CrmStatus) -
    STAGE_URGENCY.indexOf(right.stage as CrmStatus);
  if (byStage !== 0) return byStage;
  const byOverdue = (right.overdueDays ?? 0) - (left.overdueDays ?? 0);
  if (byOverdue !== 0) return byOverdue;
  // Deterministic, so two runs over unchanged data produce the same order.
  return left.leadRef.localeCompare(right.leadRef);
}

function readStage(
  lead: CrmLeadView,
): { stage: CrmStatus } | { reason: NotClockedReason } {
  if (lead.disputedFields.includes("status"))
    return { reason: "disputed-stage" };
  const raw = actionableValue(lead, "status");
  if (!raw) return { reason: "no-stage" };
  const read = readStatus(raw);
  if (read.unmapped) return { reason: "unmapped-stage" };
  if (!isLiveStatus(read.value)) return { reason: "closed-stage" };
  return { stage: read.value as CrmStatus };
}

/**
 * One stall as a line a human reads.
 *
 * The number never appears without what produced it. "Quiet 11 days" is the
 * sentence the acceptance criteria single out as a failure, because it reads as
 * a complete picture when only two mailboxes were searched.
 */
export function describeStall(entry: ClockEntry): string {
  const parts = [`${entry.leadRef} ${entry.stage}`];
  if (entry.daysQuiet !== undefined) {
    parts.push(
      `quiet ${entry.daysQuiet} days against a ${entry.thresholdDays} day threshold`,
    );
  }
  parts.push(
    entry.lastTouch
      ? `last ${entry.lastTouch.basis} touch ${entry.lastTouch.occurredAt.toISOString().slice(0, 10)}`
      : "no touch on record, measured from the lead date",
  );
  parts.push(
    entry.evidence.searched.length > 0
      ? `searched ${entry.evidence.searched.join(" and ")}`
      : "searched nothing on this run",
  );
  parts.push(`blind to ${entry.evidence.blindTo.join(", ")}`);
  if (entry.evidence.invisibleFields.length > 0) {
    parts.push(
      `${entry.evidence.invisibleFields.join(", ")} shared with another lead and invisible`,
    );
  }
  return parts.join("; ");
}
