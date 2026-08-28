import { actionableValue, type CrmLeadView } from "./actionable";
import {
  describeStall,
  type ClockEntry,
  type SilenceClockResult,
} from "./clock";
import { evidenceBasis } from "./touches";

/**
 * The one message a day, and the numbers that answer it.
 *
 * Everything here follows from a single observation in the diagnosis: a
 * spreadsheet is a pull surface, and "what needs checking in on" only gets
 * asked when somebody remembers to ask. So this is a push, it is short enough
 * to read on a phone, and the reply is a number rather than a form.
 *
 * Three rules the acceptance criteria turn on.
 *
 *   A truncated list must never read as complete. Five items is the cap and the
 *   count held back is printed whether or not anything was held back, so the
 *   absence of that line can never be mistaken for nothing being cut.
 *
 *   Silence must never be ambiguous. Zero stalls sends a message saying zero,
 *   because a day with nothing to do and a day where the job died look
 *   identical when the response to both is no email.
 *
 *   A student's name reaches the recipient and nowhere else. The body is read
 *   by Ren and Athena; the subject is a phone notification preview, a log line
 *   is read by anyone with the logs, and an exception payload crosses a runner
 *   boundary. Names belong in exactly one of those four.
 */

/** The most stalls one message may carry. */
export const MAX_DIGEST_ITEMS = 5;

export const DIGEST_ACTIONS = ["draft", "snooze", "lost", "spoke"] as const;
export type DigestAction = (typeof DIGEST_ACTIONS)[number];

/** What each number does, in the order it is printed. */
export const DIGEST_ACTION_LABELS: Record<DigestAction, string> = {
  draft: "draft a follow-up",
  snooze: "snooze a week",
  lost: "mark lost",
  spoke: "already spoke to them",
};

export interface DigestItem {
  /** 1 through 5, and the first digit of every reply code for this lead. */
  position: number;
  identity: string;
  leadRef: string;
  /** Shown to the recipient only. Never in a subject, log, or payload. */
  studentName: string;
  stage: string;
  daysQuiet: number;
  thresholdDays: number;
  /** The stall line, carrying its evidence rather than only its number. */
  line: string;
  /** The reply code for each action, as printed. */
  codes: Record<DigestAction, string>;
}

export type DigestStatus =
  /** Stalls to work. */
  | "stalls"
  /** The clock ran and found nothing. Said out loud, never implied. */
  | "clear"
  /** The clock ran but read no mailbox, so "clear" would be a guess. */
  | "degraded";

export interface DailyDigest {
  status: DigestStatus;
  items: DigestItem[];
  /** Stalls that did not fit. Printed even when zero. */
  heldBack: number;
  totalStalls: number;
  /** Leads that cannot be measured at all, by outcome. */
  attention: {
    unmonitorable: number;
    unattributable: number;
    unmeasurable: number;
  };
  /** Leads a human held back, and not counted as healthy. */
  snoozed: number;
  searched: string[];
  blindTo: string[];
}

/**
 * The reply code for one lead and one action.
 *
 * Two digits: the lead's position, then the action. Unique across the message,
 * so "24" can only mean one thing and a reply needs no context to interpret.
 * A single digit could not address both a lead and an action, and asking for
 * "2, then 4" is a conversation rather than a reply.
 */
export function digestCode(position: number, action: DigestAction): string {
  return `${position}${DIGEST_ACTIONS.indexOf(action) + 1}`;
}

function studentNameOf(lead: CrmLeadView | undefined): string {
  if (!lead) return "";
  const first = actionableValue(lead, "studentFirst") ?? "";
  const last = actionableValue(lead, "studentLast") ?? "";
  return `${first} ${last}`.trim();
}

export interface BuildDigestOptions {
  result: SilenceClockResult;
  leads: CrmLeadView[];
  maxItems?: number;
}

export function buildDailyDigest(options: BuildDigestOptions): DailyDigest {
  const { result } = options;
  const maxItems = options.maxItems ?? MAX_DIGEST_ITEMS;
  const byIdentity = new Map(
    options.leads.map((lead) => [lead.identity, lead]),
  );

  const items = result.stalls.slice(0, maxItems).map((entry, index) => {
    const position = index + 1;
    return {
      position,
      identity: entry.identity,
      leadRef: entry.leadRef,
      studentName: studentNameOf(byIdentity.get(entry.identity)),
      stage: entry.stage ?? "",
      daysQuiet: entry.daysQuiet ?? 0,
      thresholdDays: entry.thresholdDays ?? 0,
      line: describeStall(entry),
      codes: Object.fromEntries(
        DIGEST_ACTIONS.map((action) => [action, digestCode(position, action)]),
      ) as Record<DigestAction, string>,
    };
  });

  const attention = {
    unmonitorable: count(result.entries, "unmonitorable"),
    unattributable: count(result.entries, "unattributable"),
    unmeasurable: count(result.entries, "unmeasurable"),
  };

  // Read off the run's own coverage, not reconstructed from the entries. A day
  // with no live leads has no entries to reconstruct from, and inferring from
  // an empty list would report that nothing was searched on a healthy run.
  const { searched, blindTo } = evidenceBasis([], result.coverage);

  return {
    // A run that read no mailbox is not a clear day. Calling it clear would be
    // the message asserting a fact nothing established.
    status:
      result.stalls.length > 0
        ? "stalls"
        : searched.length === 0
          ? "degraded"
          : "clear",
    items,
    heldBack: Math.max(0, result.stalls.length - items.length),
    totalStalls: result.stalls.length,
    attention,
    snoozed: count(result.entries, "snoozed"),
    searched,
    blindTo,
  };
}

function count(entries: ClockEntry[], outcome: ClockEntry["outcome"]): number {
  return entries.filter((entry) => entry.outcome === outcome).length;
}

/**
 * The subject line, which is also the phone notification preview.
 *
 * Counts only. A lock screen is read by whoever is holding the phone and by
 * anyone standing next to them, so it is the one surface in this system where
 * a minor's name is most likely to be seen by someone with no reason to see
 * it. `renderDigestSubject` therefore takes the digest and never the leads.
 */
export function renderDigestSubject(digest: DailyDigest): string {
  if (digest.status === "degraded") {
    return "Daily check-in: the clock ran but read no mailbox";
  }
  if (digest.status === "clear") return "Daily check-in: nothing overdue";
  const held = digest.heldBack > 0 ? `, ${digest.heldBack} held back` : "";
  return `Daily check-in: ${digest.totalStalls} overdue${held}`;
}

/**
 * The message body. The only surface a student's name may appear on.
 *
 * Deliberately plain text with no draft in it. The standing binding is that no
 * surface renders a draft until it has passed `voiceLint`, and this surface
 * renders none at all: "draft a follow-up" is a reply that starts `S3.draft`,
 * not something already written and waiting here.
 */
export function renderDigestBody(digest: DailyDigest): string {
  const lines: string[] = [];

  if (digest.status === "degraded") {
    lines.push(
      "The clock ran and no mailbox was read, so nothing here is a clear day.",
      "Treat this as a broken run, not a quiet one.",
      "",
    );
  } else if (digest.status === "clear") {
    lines.push(
      "Nothing is overdue today.",
      `Searched ${digest.searched.join(" and ")}.`,
      "",
    );
  }

  for (const item of digest.items) {
    const who = item.studentName
      ? `${item.studentName} (${item.leadRef})`
      : item.leadRef;
    lines.push(`${item.position}. ${who} - ${item.stage}`);
    lines.push(`   ${item.line}`);
    lines.push(
      `   reply ${DIGEST_ACTIONS.map(
        (action) => `${item.codes[action]} ${DIGEST_ACTION_LABELS[action]}`,
      ).join(", ")}`,
    );
    lines.push("");
  }

  // Printed unconditionally. A held-back line that only appears when something
  // was cut means its absence has to be interpreted, and a truncated list that
  // reads as complete is named in the acceptance criteria as failing the phase.
  lines.push(
    digest.heldBack > 0
      ? `${digest.heldBack} more overdue and not shown.`
      : "Nothing else is overdue and unshown.",
  );

  const attention =
    digest.attention.unmonitorable +
    digest.attention.unattributable +
    digest.attention.unmeasurable;
  if (attention > 0) {
    lines.push(
      `${attention} lead(s) cannot be measured at all: ` +
        `${digest.attention.unmonitorable} with nothing to match on, ` +
        `${digest.attention.unattributable} whose contacts reach another lead, ` +
        `${digest.attention.unmeasurable} never contacted and with no lead date. ` +
        "These are not healthy and they are not in the list above.",
    );
  }
  if (digest.snoozed > 0) {
    lines.push(`${digest.snoozed} snoozed and due back later.`);
  }
  if (digest.blindTo.length > 0) {
    lines.push(`Blind to ${digest.blindTo.join("; ")}.`);
  }
  return lines.join("\n");
}

/**
 * What may be written to a log.
 *
 * References and counts. No name, and no free text that a name could later be
 * interpolated into, which is the finding carried forward from the Wyzant
 * exception channel.
 */
export function digestLogLine(digest: DailyDigest): string {
  return [
    `status=${digest.status}`,
    `stalls=${digest.totalStalls}`,
    `shown=${digest.items.length}`,
    `held_back=${digest.heldBack}`,
    `attention=${digest.attention.unmonitorable + digest.attention.unattributable + digest.attention.unmeasurable}`,
    `snoozed=${digest.snoozed}`,
    `leads=${digest.items.map((item) => item.leadRef).join("|")}`,
  ].join(" ");
}
