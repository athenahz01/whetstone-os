import { describe, expect, it } from "vitest";
import { buildContactIndex } from "../lib/crm/contacts";
import { runSilenceClock } from "../lib/crm/clock";
import { DEFAULT_SILENCE_THRESHOLDS } from "../lib/crm/thresholds";
import type { TouchRecord } from "../lib/crm/touches";
import { buildDailyDigest, renderDigestBody } from "../lib/crm/digest";
import { parseDigestReply, stripQuotedReply } from "../lib/crm/digest-actions";

/**
 * The audit of `1831727` sent a realistic reply through the parser.
 *
 * `parseDigestReply` split the whole text on non-digits, so every numeric run
 * anywhere in the message was a candidate command. The digest prints all four
 * codes for all five leads, and every mail client quotes the message being
 * answered underneath the reply.
 *
 * A reply of "13" from Gmail therefore parsed as twenty commands - the full
 * vocabulary - and the conflict guard refused all of them. The instruction was
 * discarded and the day's triage silently did nothing. Email is the defaulted
 * delivery channel, so that was every reply, every day.
 *
 * The second edge is quieter and worse: a date or a clock time yields a valid
 * code. "2026-08-24" and "08:24" both give "24", which addresses the second
 * lead. One spurious code raises no conflict, so it applies - a command nobody
 * typed.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");

const lead = (leadRef: string, status: string) =>
  ({
    identity: `i-${leadRef}`,
    leadRef,
    tab: "ug_sales",
    values: {
      status,
      studentFirst: "Given",
      studentLast: leadRef,
      studentEmail: `${leadRef.toLowerCase()}@example.com`,
      leadDate: "01-02-2026",
    },
    disputedFields: [],
  }) as never;

function digestOf(refs: Array<[string, string]>) {
  const leads = refs.map(([ref, status]) => lead(ref, status));
  const result = runSilenceClock({
    leads,
    index: buildContactIndex(leads),
    touchesByIdentity: new Map<string, TouchRecord[]>(),
    thresholds: DEFAULT_SILENCE_THRESHOLDS,
    now: NOW,
    coverage: { read: ["calendar", "email"], failed: [] },
  });
  return { digest: buildDailyDigest({ result, leads }), leads };
}

const FIVE = digestOf([
  ["U033", "Engage"],
  ["U036", "Negotiate"],
  ["U002", "Active"],
  ["U004", "Active"],
  ["U011", "Active"],
]);

describe("a reply sent from a mail client", () => {
  const quotedUnder = (typed: string) =>
    `${typed}\n\nOn Fri, 28 Aug 2026 at 08:00, Whetstone OS <ops@example.com> wrote:\n` +
    renderDigestBody(FIVE.digest)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

  it("reads only what was typed, not the quoted digest", () => {
    const reply = parseDigestReply(quotedUnder("13"), FIVE.digest);
    expect(reply.commands.map((c) => c.code)).toEqual(["13"]);
    expect(reply.conflicts).toEqual([]);
  });

  it("does not turn one instruction into a conflict on every lead", () => {
    // The failure this closes: twenty commands, five conflicts, nothing written.
    const reply = parseDigestReply(quotedUnder("13"), FIVE.digest);
    expect(reply.commands).toHaveLength(1);
    // Position 1 is whichever lead the clock ranked first, not whichever was
    // listed first in the fixture. With equal lead dates the Negotiate lead
    // leads on the ratio rule, which is the 7.5c fix doing its job.
    expect(reply.commands[0]!.item.leadRef).toBe(FIVE.digest.items[0]!.leadRef);
    expect(reply.commands[0]!.action).toBe("lost");
  });

  it("handles the Outlook and Apple Mail shapes too", () => {
    for (const marker of [
      "-----Original Message-----",
      "________________________________",
      "From: Whetstone OS",
      "Sent from my iPhone",
    ]) {
      const reply = parseDigestReply(
        `24\n\n${marker}\n${renderDigestBody(FIVE.digest)}`,
        FIVE.digest,
      );
      expect(reply.commands.map((c) => c.code)).toEqual(["24"]);
    }
  });

  it("still accepts several codes when the person really typed several", () => {
    const reply = parseDigestReply(quotedUnder("13, 24 and 51"), FIVE.digest);
    expect(reply.commands.map((c) => c.code)).toEqual(["13", "24", "51"]);
    expect(reply.conflicts).toEqual([]);
  });

  it("still accepts a code written among words", () => {
    expect(
      parseDigestReply("13 please, spoke to the dad", FIVE.digest).commands.map(
        (c) => c.code,
      ),
    ).toEqual(["13"]);
  });
});

describe("a number that is not a command", () => {
  it("does not read a date as one", () => {
    const reply = parseDigestReply("nothing today, 2026-08-24", FIVE.digest);
    expect(reply.commands).toEqual([]);
  });

  it("does not read a clock time as one", () => {
    expect(parseDigestReply("call at 08:24", FIVE.digest).commands).toEqual([]);
  });

  it("does not read a fragment of a longer number as one", () => {
    expect(parseDigestReply("ref 113355", FIVE.digest).commands).toEqual([]);
  });

  it("reports an unknown two-digit code rather than guessing", () => {
    const reply = parseDigestReply("99", FIVE.digest);
    expect(reply.commands).toEqual([]);
    expect(reply.unrecognised).toEqual(["99"]);
  });
});

describe("stripQuotedReply", () => {
  it("keeps everything above the first quote marker", () => {
    expect(stripQuotedReply("13\n\n> quoted\n> more").trim()).toBe("13");
  });

  it("leaves an unquoted reply untouched", () => {
    expect(stripQuotedReply("13 and 24")).toBe("13 and 24");
  });

  it("returns nothing when the whole message is quoted", () => {
    expect(stripQuotedReply("> 11\n> 12").trim()).toBe("");
  });
});
