import { describe, expect, it } from "vitest";
import { buildContactIndex } from "../lib/crm/contacts";
import { describeStall, runSilenceClock } from "../lib/crm/clock";
import { DEFAULT_SILENCE_THRESHOLDS } from "../lib/crm/thresholds";
import { evidenceBasis, type TouchRecord } from "../lib/crm/touches";

/**
 * The audit of `d75bfa1` found `evidenceBasis` returning the constant
 * `["calendar", "email"]` for `searched`, whatever the run had actually read.
 *
 * `S4.touch-scan` isolates provider failures on purpose, so a calendar outage
 * does not cost a day of email evidence. That means a scan can succeed having
 * read only half of what it names - and every stall line still claimed both
 * mailboxes. A person reading "quiet 11 days, searched calendar and email"
 * would conclude nobody had emailed, when the truth was that nobody had looked.
 *
 * Section 7 of the brief makes the rule binding: the clock states its evidence,
 * never just its number. Stating evidence it does not have is the same defect
 * as `exceptionsRecorded` reporting what was accepted while naming what was
 * written.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");

const lead = (leadRef: string) =>
  ({
    identity: `i-${leadRef}`,
    leadRef,
    tab: "ug_sales",
    values: {
      status: "Active",
      studentEmail: `${leadRef.toLowerCase()}@example.com`,
      leadDate: "01-02-2026",
    },
    disputedFields: [],
  }) as never;

const clock = (coverage: Parameters<typeof runSilenceClock>[0]["coverage"]) => {
  const leads = [lead("U042")];
  return runSilenceClock({
    leads,
    index: buildContactIndex(leads),
    touchesByIdentity: new Map<string, TouchRecord[]>(),
    thresholds: DEFAULT_SILENCE_THRESHOLDS,
    now: NOW,
    coverage,
  });
};

describe("the stall line reports what was searched, not what was intended", () => {
  it("names both mailboxes when both were read", () => {
    const stall = clock({ read: ["calendar", "email"], failed: [] }).stalls[0]!;
    expect(stall.evidence.searched).toEqual(["calendar", "email"]);
    expect(describeStall(stall)).toContain("searched calendar and email");
  });

  it("does not claim email when the email provider failed", () => {
    const stall = clock({ read: ["calendar"], failed: ["email"] }).stalls[0]!;
    expect(stall.evidence.searched).toEqual(["calendar"]);
    const line = describeStall(stall);
    expect(line).toContain("searched calendar");
    expect(line).not.toContain("searched calendar and email");
    expect(line).toContain("email, which was attempted and failed");
  });

  it("says so plainly when nothing was read at all", () => {
    const stall = clock({ read: [], failed: ["calendar", "email"] }).stalls[0]!;
    expect(stall.evidence.searched).toEqual([]);
    expect(describeStall(stall)).toContain("searched nothing on this run");
  });

  it("keeps the standing phone blindness whatever the coverage", () => {
    for (const coverage of [
      { read: ["calendar", "email"] as const, failed: [] },
      { read: [], failed: ["calendar", "email"] as const },
    ]) {
      const stall = clock({
        read: [...coverage.read],
        failed: [...coverage.failed],
      }).stalls[0]!;
      expect(stall.evidence.blindTo.join(" ")).toMatch(/phone calls/i);
    }
  });

  it("still prints the number, so a degraded run is not a silent one", () => {
    const line = describeStall(
      clock({ read: [], failed: ["calendar", "email"] }).stalls[0]!,
    );
    expect(line).toMatch(/quiet \d+ days/);
  });
});

describe("evidenceBasis reads coverage rather than assuming it", () => {
  it("reports a failed provider as stale as well as unsearched", () => {
    const basis = evidenceBasis([], { read: ["email"], failed: ["calendar"] });
    expect(basis.searched).toEqual(["email"]);
    expect(basis.staleBases).toEqual(["calendar"]);
  });

  it("separates what was searched from what turned up", () => {
    const basis = evidenceBasis([], {
      read: ["calendar", "email"],
      failed: [],
    });
    expect(basis.searched).toEqual(["calendar", "email"]);
    expect(basis.observed).toEqual([]);
  });
});
