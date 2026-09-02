import type { CrmSourceRow } from "./merge";
import { assertedTouch, type TouchRecord } from "./touches";
import { readMeetingMedium, type CrmMeetingMedium } from "./vocabulary";

/**
 * The meetings the sheet already knows about, converted into touches.
 *
 * The rebuilt `!Dashboard` records 34 first meetings on the UG tab and knows the
 * medium, who attended and who closed for all 34. It holds a date for 8. Until
 * this ran, the importer brought across none of them, so the first daily message
 * would have read "no touch on record, measured from the lead date" on every
 * line while the source it had just read held evidence of 34 conversations.
 *
 * These become `asserted` touches, which is the basis that already means "a
 * human says this happened and no mailbox can corroborate it". A meeting typed
 * into a spreadsheet after a call is exactly that. It is not `calendar`: nothing
 * read a calendar, and claiming otherwise would be the evidence line asserting a
 * search that never happened.
 *
 * Two things this deliberately does not do.
 *
 * It invents no dates. A meeting with a medium and no date is carried out as an
 * unconverted row with its reason, not given a plausible day. 26 rows are in
 * that state and the rule for them is a decision, not an implementation - see
 * `docs/MEETING-BACKFILL-RULING.md`.
 *
 * It carries no notes. `M1 Notes` is free prose a human wrote about a student,
 * and `crm_touches` has nowhere to put prose by design.
 */

/** The three meeting slots the sheet holds, in order. */
export const MEETING_SLOTS = ["M1", "M2", "M3"] as const;
export type MeetingSlot = (typeof MEETING_SLOTS)[number];

/**
 * Why a slot the sheet filled in did not become a touch.
 *
 * A closed vocabulary, following the rule carried forward from the exception
 * channel. These reasons are read next to a lead record and counted in a report,
 * which is where a free-text reason would eventually carry a student's name.
 */
export const MEETING_SKIP_REASONS = [
  /** Evidence of a meeting, and no day to put it on. The 26. */
  "no-date",
  /** A date the sheet holds that is not a date. */
  "unparsable-date",
  /** A dated meeting nobody signed. `asserted` has to name a human. */
  "no-closer",
] as const;
export type MeetingSkipReason = (typeof MEETING_SKIP_REASONS)[number];

export interface UnconvertedMeeting {
  identity: string;
  leadRef: string;
  slot: MeetingSlot;
  reason: MeetingSkipReason;
  /** Read through the closed vocabulary, so an unknown medium stays visible. */
  medium: CrmMeetingMedium | null;
  mediumRaw: string;
  mediumUnmapped: boolean;
  /** `P`, `S` or `P, S`. Roles, never names. */
  client: string;
  /** Whetstone staff initials. The person who would have asserted it. */
  closer: string;
  /** Exactly what the date cell held, so a human can see what failed. */
  dateRaw: string;
}

export interface MeetingBackfillResult {
  touches: TouchRecord[];
  unconverted: UnconvertedMeeting[];
  /** Slots holding nothing at all. No meeting, nothing to convert. */
  emptySlots: number;
  slotsRead: number;
  /**
   * Every slot read left as a touch, an unconverted row, or an empty slot.
   *
   * The same invariant the import and the touch scan carry. It proves nothing
   * was dropped; it cannot prove a conversion was right, which is why the
   * unconverted rows carry their reason rather than a count alone.
   */
  balanced: boolean;
}

function cell(row: CrmSourceRow, column: string): string {
  return (row.cells[column] ?? "").trim();
}

/**
 * A date the sheet holds, or nothing.
 *
 * Strict on purpose. The rebuilt sheet stores real dates, so a cell that will
 * not parse is a fact about the sheet worth surfacing rather than a value to
 * coerce until it works.
 */
export function parseMeetingDate(raw: string): Date | undefined {
  // No early return for a blank cell: `new Date("")` is already an invalid
  // date, so a guard for it was a line no test could reach.
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * The key one backfilled meeting is stored under.
 *
 * Keyed on the slot rather than the day, for two reasons. Two meetings on one
 * date are two meetings, and `assertedTouch`'s own day-based key would collapse
 * them. And a human answering "already spoke to them" on the same day writes
 * `asserted:<identity>:<date>`, so the two schemes cannot collide and a
 * backfill can never overwrite something a person said.
 *
 * Stable across runs, so re-importing the sheet writes the same rows.
 */
export function meetingSourceRef(slot: MeetingSlot): string {
  return `sheet-meeting:${slot}`;
}

/**
 * Converts one sheet row's three meeting slots.
 *
 * `identity` is passed in rather than derived, because the merge owns identity
 * and two places computing it is how the two halves drift apart.
 */
export function backfillRowMeetings(
  row: CrmSourceRow,
  lead: { identity: string; leadRef: string },
): MeetingBackfillResult {
  const touches: TouchRecord[] = [];
  const unconverted: UnconvertedMeeting[] = [];
  let emptySlots = 0;

  for (const slot of MEETING_SLOTS) {
    const dateRaw = cell(row, `${slot} Date`);
    const mediumRaw = cell(row, `${slot} Med`);
    const client = cell(row, `${slot} Client`);
    const closer = cell(row, `${slot} Closer`);
    // Notes are read by nobody here. `M1 Notes` is prose about a student and
    // there is deliberately nowhere for it to go.

    if (!dateRaw && !mediumRaw && !client && !closer) {
      emptySlots += 1;
      continue;
    }

    const medium = readMeetingMedium(mediumRaw);
    const skip = (reason: MeetingSkipReason) =>
      unconverted.push({
        identity: lead.identity,
        leadRef: lead.leadRef,
        slot,
        reason,
        medium: medium.value,
        mediumRaw: medium.raw,
        mediumUnmapped: medium.unmapped,
        client,
        closer,
        dateRaw,
      });

    if (!dateRaw) {
      // The 26. Evidence a conversation happened, and no day to put it on.
      skip("no-date");
      continue;
    }
    const occurredAt = parseMeetingDate(dateRaw);
    if (!occurredAt) {
      skip("unparsable-date");
      continue;
    }
    if (!closer) {
      // `asserted` means a named human says this happened. The database
      // refuses a blank `asserted_by`, and inventing one would put a claim in
      // somebody's mouth.
      skip("no-closer");
      continue;
    }

    touches.push({
      ...assertedTouch({
        identity: lead.identity,
        leadRef: lead.leadRef,
        assertedBy: closer,
        occurredAt,
      }),
      sourceRef: meetingSourceRef(slot),
    });
  }

  const slotsRead = MEETING_SLOTS.length;
  return {
    touches,
    unconverted,
    emptySlots,
    slotsRead,
    balanced: touches.length + unconverted.length + emptySlots === slotsRead,
  };
}

/** Runs the backfill across every row, keeping the same invariant. */
export function backfillMeetings(
  rows: Array<{
    row: CrmSourceRow;
    lead: { identity: string; leadRef: string };
  }>,
): MeetingBackfillResult {
  const touches: TouchRecord[] = [];
  const unconverted: UnconvertedMeeting[] = [];
  let emptySlots = 0;

  for (const { row, lead } of rows) {
    const one = backfillRowMeetings(row, lead);
    touches.push(...one.touches);
    unconverted.push(...one.unconverted);
    emptySlots += one.emptySlots;
  }

  const slotsRead = rows.length * MEETING_SLOTS.length;
  return {
    touches,
    unconverted,
    emptySlots,
    slotsRead,
    balanced: touches.length + unconverted.length + emptySlots === slotsRead,
  };
}

/**
 * What the backfill found, for a human to read before it writes.
 *
 * Counts and references only. No names, no notes, no cell contents beyond the
 * medium, which is a four-member vocabulary.
 */
export function summariseBackfill(result: MeetingBackfillResult): string {
  const byReason = new Map<MeetingSkipReason, number>();
  for (const item of result.unconverted) {
    byReason.set(item.reason, (byReason.get(item.reason) ?? 0) + 1);
  }
  return [
    `slots=${result.slotsRead}`,
    `converted=${result.touches.length}`,
    `empty=${result.emptySlots}`,
    ...MEETING_SKIP_REASONS.map(
      (reason) => `${reason}=${byReason.get(reason) ?? 0}`,
    ),
    `balanced=${result.balanced}`,
  ].join(" ");
}
