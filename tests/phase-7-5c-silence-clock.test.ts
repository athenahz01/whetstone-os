import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { toLeadView, type CrmLeadView } from "../lib/crm/actionable";
import {
  daysBetween,
  describeStall,
  runSilenceClock,
  type ClockEntry,
} from "../lib/crm/clock";
import { buildContactIndex } from "../lib/crm/contacts";
import { mergeCrmSources, type CrmSourceRow } from "../lib/crm/merge";
import type { ThresholdRepository } from "../lib/crm/threshold-store";
import {
  assertedRunLength,
  DEFAULT_SILENCE_THRESHOLDS,
  DEFAULT_WIDENING_POLICY,
  thresholdFor,
  type ThresholdAdjustment,
} from "../lib/crm/thresholds";
import type { TouchBasis, TouchRecord } from "../lib/crm/touches";
import { assertRegistrable } from "../lib/core/registry";
import {
  createSilenceClockWorkflow,
  type SilenceClockBatch,
} from "../lib/workflows/s5-silence-clock";

/**
 * Names and addresses here are invented, on the reserved documentation domain.
 *
 * The real records carry minors and their parents' contact details. What the
 * fixture reproduces is the shape the live export has: a lead with its own
 * address, two siblings on one parent address, a lead with nothing usable, a
 * lead with a disputed stage, and closed leads that must stay out.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

let rowCounter = 0;
function row(
  source: CrmSourceRow["source"],
  cells: Record<string, string | undefined>,
): CrmSourceRow {
  rowCounter += 1;
  return { source, tab: "ug_sales", rowNumber: rowCounter, cells };
}
const dashboard = (cells: Record<string, string | undefined>) =>
  row("dashboard", cells);
const copy = (cells: Record<string, string | undefined>) =>
  row("dashboard_copy", cells);

function fixture() {
  rowCounter = 0;
  const primary: CrmSourceRow[] = [
    // Negotiate, the tightest threshold in the map.
    dashboard({
      ID: "U001",
      "S First": "Ada",
      "S Last": "Sparrow",
      Status: "Negotiate",
      "Lead Date": "2026-01-05",
      "S Email": "ada.sparrow@example.com",
    }),
    // Cold, the loosest.
    dashboard({
      ID: "U002",
      "S First": "Bea",
      "S Last": "Marlow",
      Status: "Cold",
      "Lead Date": "2026-02-01",
      "S Email": "bea.marlow@example.com",
    }),
    // Two siblings on one parent address: wholly unattributable.
    dashboard({
      ID: "U003",
      "S First": "Cy",
      "S Last": "Okafor",
      Status: "Active",
      "P1 Email": "shared.parent@example.com",
    }),
    dashboard({
      ID: "U004",
      "S First": "Dev",
      "S Last": "Okafor",
      Status: "Prospect",
      "P1 Email": "shared.parent@example.com",
    }),
    // Nothing usable at all.
    dashboard({
      ID: "U005",
      "S First": "Ell",
      "S Last": "Trevino",
      Status: "Active",
      "Lead Date": "2026-03-01",
    }),
    // Closed. Not quiet, finished.
    dashboard({
      ID: "U006",
      "S First": "Fay",
      "S Last": "Bright",
      Status: "Complete",
      "S Email": "fay.bright@example.com",
    }),
    // The two files disagree about the stage, so nothing may act on it.
    dashboard({
      ID: "U007",
      "S First": "Gus",
      "S Last": "Iyer",
      Status: "Active",
      "S Email": "gus.iyer@example.com",
    }),
    // Partially shared: one unshared address, one shared with U009.
    dashboard({
      ID: "U008",
      "S First": "Hal",
      "S Last": "Nakamura",
      Status: "Active",
      "Lead Date": "2026-01-10",
      "S Email": "hal.nakamura@example.com",
      "P1 Email": "second.parent@example.com",
    }),
    dashboard({
      ID: "U009",
      "S First": "Ira",
      "S Last": "Nakamura",
      Status: "Cold",
      "S Email": "ira.nakamura@example.com",
      "P1 Email": "second.parent@example.com",
    }),
    // Reachable, live, and no lead date and no touch: unmeasurable.
    dashboard({
      ID: "U010",
      "S First": "Jo",
      "S Last": "Padilla",
      Status: "Engage",
      "S Email": "jo.padilla@example.com",
    }),
    // A stage outside the vocabulary. Not live, not closed, not guessable.
    dashboard({
      ID: "U011",
      "S First": "Kit",
      "S Last": "Alvarez",
      Status: "Warm",
      "Lead Date": "2026-01-02",
      "S Email": "kit.alvarez@example.com",
    }),
    // No stage at all. 24 of 69 real rows are in this state.
    dashboard({
      ID: "U012",
      "S First": "Lou",
      "S Last": "Fontaine",
      "Lead Date": "2026-01-02",
      "S Email": "lou.fontaine@example.com",
    }),
    // Negotiate, and its reference sorts after the Cold leads it ties with, so
    // stage urgency and alphabetical order disagree about it.
    dashboard({
      ID: "U013",
      "S First": "Max",
      "S Last": "Delgado",
      Status: "Negotiate",
      "S Email": "max.delgado@example.com",
    }),
    // Last in the file and first alphabetically, so insertion order and
    // reference order disagree about it.
    dashboard({
      ID: "U000",
      "S First": "Nia",
      "S Last": "Whitfield",
      Status: "Cold",
      "S Email": "nia.whitfield@example.com",
    }),
  ];
  const secondary: CrmSourceRow[] = [
    copy({
      ID: "U007",
      "S First": "Gus",
      "S Last": "Iyer",
      Status: "Cold",
    }),
  ];
  return { primary, secondary };
}

function leadViews(): CrmLeadView[] {
  const { primary, secondary } = fixture();
  return mergeCrmSources(primary, secondary).leads.map((lead) =>
    toLeadView(lead),
  );
}

function identityFor(leadRef: string): string {
  const lead = leadViews().find((candidate) => candidate.leadRef === leadRef);
  if (!lead) throw new Error(`no lead ${leadRef}`);
  return lead.identity;
}

function touch(
  leadRef: string,
  overrides: Partial<TouchRecord> = {},
): TouchRecord {
  return {
    identity: identityFor(leadRef),
    leadRef,
    basis: "email",
    kind: "email",
    direction: "inbound",
    state: "occurred",
    occurredAt: daysAgo(1),
    sourceRef: `${leadRef}-msg`,
    subjectRef: null,
    matchedField: "studentEmail",
    assertedBy: null,
    ...overrides,
  };
}

function touchMap(touches: TouchRecord[]): Map<string, TouchRecord[]> {
  const byIdentity = new Map<string, TouchRecord[]>();
  for (const item of touches) {
    const held = byIdentity.get(item.identity) ?? [];
    held.push(item);
    byIdentity.set(item.identity, held);
  }
  return byIdentity;
}

function runClock(
  touches: TouchRecord[] = [],
  overrides: Partial<Parameters<typeof runSilenceClock>[0]> = {},
) {
  const leads = leadViews();
  return runSilenceClock({
    leads,
    index: buildContactIndex(leads),
    touchesByIdentity: touchMap(touches),
    thresholds: DEFAULT_SILENCE_THRESHOLDS,
    now: NOW,
    coverage: { read: ["calendar", "email"], failed: [] },
    ...overrides,
  });
}

function entryFor(result: { entries: ClockEntry[] }, leadRef: string) {
  const entry = result.entries.find((item) => item.leadRef === leadRef);
  if (!entry) throw new Error(`no entry for ${leadRef}`);
  return entry;
}

class MemoryThresholdRepository implements ThresholdRepository {
  readonly recorded: ThresholdAdjustment[] = [];
  readonly cleared: string[] = [];
  async recordAdjustment(adjustment: ThresholdAdjustment) {
    this.recorded.push(adjustment);
  }
  async clearAdjustments(identities: string[]) {
    this.cleared.push(...identities);
  }
}

describe("7.5c: a ranked stall list on the first execution", () => {
  it("produces stalls without needing a previous run to compare against", () => {
    const result = runClock();
    // Nothing is stored between runs, so the first execution is the same as
    // every other one. A clock that needs yesterday's state to work would never
    // produce a first day.
    expect(result.stalls.length).toBeGreaterThan(0);
    expect(result.stalls.every((entry) => entry.outcome === "stall")).toBe(
      true,
    );
  });

  it("ranks by how far past due, in each stage's own terms", () => {
    // Updated by the 7.5c audit. Ranking was by absolute overdue days, which
    // systematically buries the urgent stages: a Cold lead has a 30 day
    // threshold so a year of neglect scores 335, while a Negotiate lead has a
    // 3 day threshold so ten days of silence scores 7.
    //
    // U001 comes first in the fixture and is the least overdue, so insertion
    // order and rank order disagree. An unsorted list fails this.
    //   U008 Active   60 quiet / 7 threshold  = 8.6x past due
    //   U002 Cold    100 quiet / 15 threshold = 6.7x past due
    //   U001 Negotiate 5 quiet / 2 threshold  = 2.5x past due
    // Under the old absolute rule U002 led on 70 overdue days, although Cold is
    // the stage that is *expected* to be quiet - which is what its threshold
    // says.
    const result = runClock([
      touch("U001", { occurredAt: daysAgo(5) }),
      touch("U002", { occurredAt: daysAgo(100) }),
      touch("U008", { occurredAt: daysAgo(60) }),
    ]);
    expect(result.stalls.map((entry) => entry.leadRef)).toEqual([
      "U008",
      "U002",
      "U001",
    ]);
    const ratios = result.stalls.map(
      (entry) => (entry.daysQuiet ?? 0) / (entry.thresholdDays ?? 1),
    );
    expect(ratios).toEqual([...ratios].sort((left, right) => right - left));
  });

  it("does not let a slow stage bury an urgent one on absolute days", () => {
    // The live export's shape: on the first run everything is measured from the
    // lead date, and the single Negotiate lead in the whole pipeline ranked
    // twelfth of fifteen behind Cold leads from mid-2025 that nobody is
    // working. The five-item cap meant it would never have been shown.
    const result = runClock([
      touch("U002", { occurredAt: daysAgo(400) }), // Cold, 26.7x past due
      touch("U001", { occurredAt: daysAgo(60) }), // Negotiate, 30x past due
    ]);
    const order = result.stalls.map((entry) => entry.leadRef);
    const negotiate = result.stalls.find((e) => e.leadRef === "U001")!;
    const cold = result.stalls.find((e) => e.leadRef === "U002")!;
    expect(order.indexOf("U001")).toBeLessThan(order.indexOf("U002"));
    // And the old rule would have put them the other way round: the Cold lead
    // holds far more absolute overdue days and still ranks below.
    expect(negotiate.overdueDays).toBeLessThan(cold.overdueDays ?? 0);
  });

  it("breaks a tie by stage urgency, not by whichever lead sorts first", () => {
    const result = runClock([
      // A real tie in the terms the ranking actually uses. Eight days against
      // Negotiate's two and sixty against Cold's fifteen are both exactly four
      // times past due, so the ratio separates none of them and stage urgency
      // is the only rule left.
      //
      // The previous version of this tied on absolute overdue days, which the
      // ratio rule does not tie on, so stage urgency never decided anything
      // here and deleting it changed nothing.
      touch("U013", { occurredAt: daysAgo(8) }),
      touch("U000", { occurredAt: daysAgo(60) }),
      touch("U002", { occurredAt: daysAgo(60) }),
      touch("U009", { occurredAt: daysAgo(60) }),
    ]);
    const tied = result.stalls
      .filter(
        (entry) => (entry.daysQuiet ?? 0) / (entry.thresholdDays ?? 1) === 4,
      )
      .map((entry) => entry.leadRef);
    expect(tied).toEqual(["U013", "U000", "U002", "U009"]);
    // U013 is the Negotiate lead, it sorts last of the four by reference, and
    // it holds the fewest overdue days. Every other rule would bury it.
    expect(tied[0]).not.toBe([...tied].sort()[0]);
    expect(
      result.stalls.find((entry) => entry.leadRef === "U013")?.overdueDays,
    ).toBeLessThan(
      result.stalls.find((entry) => entry.leadRef === "U000")?.overdueDays ?? 0,
    );
  });

  it("separates two leads of one stage whose thresholds differ", () => {
    // Stage urgency cannot decide between two Negotiate leads, and the ratio
    // cannot either when both are exactly four times past due. What separates
    // them is that one has been widened by the asserted-run rule, so it carries
    // a four day threshold against the other's two - the only way two leads of
    // one stage can tie on ratio and still differ in absolute days.
    const result = runClock([
      touch("U013", {
        basis: "asserted",
        kind: "meeting",
        direction: "outbound",
        sourceRef: "asserted:U013:1",
        matchedField: null,
        assertedBy: "ren",
        occurredAt: daysAgo(16),
      }),
      touch("U013", {
        basis: "asserted",
        kind: "meeting",
        direction: "outbound",
        sourceRef: "asserted:U013:2",
        matchedField: null,
        assertedBy: "ren",
        occurredAt: daysAgo(23),
      }),
      touch("U013", {
        basis: "asserted",
        kind: "meeting",
        direction: "outbound",
        sourceRef: "asserted:U013:3",
        matchedField: null,
        assertedBy: "ren",
        occurredAt: daysAgo(30),
      }),
      touch("U001", { occurredAt: daysAgo(8) }),
    ]);
    const negotiate = result.stalls.filter(
      (entry) => entry.stage === "Negotiate",
    );
    expect(negotiate.map((entry) => entry.thresholdDays)).toEqual([4, 2]);
    expect(negotiate.map((entry) => entry.daysQuiet)).toEqual([16, 8]);
    // Twelve days past due outranks six, although the reference would put them
    // the other way round.
    expect(negotiate.map((entry) => entry.leadRef)).toEqual(["U013", "U001"]);
  });

  it("orders two equally overdue leads of one stage deterministically", () => {
    // Three Cold leads, all quiet 40 days. Nothing but the reference separates
    // them. U000 is last in the file and first alphabetically, so insertion
    // order cannot stand in for a rule.
    const touches = [
      touch("U009", { occurredAt: daysAgo(40) }),
      touch("U002", { occurredAt: daysAgo(40) }),
      touch("U000", { occurredAt: daysAgo(40) }),
    ];
    const cold = () =>
      runClock(touches)
        .stalls.filter(
          (entry) => entry.stage === "Cold" && entry.overdueDays === 25,
        )
        .map((entry) => entry.leadRef);
    expect(cold()).toEqual(["U000", "U002", "U009"]);
    expect(cold()).toEqual(cold());
  });

  it("counts the days from the last touch that actually happened", () => {
    const result = runClock([
      touch("U001", { occurredAt: daysAgo(11) }),
      touch("U001", {
        sourceRef: "U001-booked",
        occurredAt: daysAgo(30),
      }),
    ]);
    const ada = entryFor(result, "U001");
    expect(ada.daysQuiet).toBe(11);
    expect(ada.measuredFrom).toBe("last-touch");
  });

  it("falls back to the lead date when nothing has ever been recorded", () => {
    const result = runClock();
    const bea = entryFor(result, "U002");
    expect(bea.measuredFrom).toBe("lead-date");
    expect(bea.daysQuiet).toBe(daysBetween(new Date("2026-02-01"), NOW));
  });

  it("puts every lead in exactly one outcome", () => {
    const result = runClock();
    const leads = leadViews();
    expect(result.entries).toHaveLength(leads.length);
    expect(result.balanced).toBe(true);
    expect(new Set(result.entries.map((entry) => entry.identity)).size).toBe(
      leads.length,
    );
    // Nothing falls between the lists, which is the invariant the import and
    // the touch scan carry for the same reason.
    for (const entry of result.entries) {
      expect(entry.outcome).toBeTruthy();
    }
  });
});

describe("7.5c: a lead that cannot be measured is never healthy", () => {
  it("names the missing fields on an unmonitorable lead", () => {
    const entry = entryFor(runClock(), "U005");
    expect(entry.outcome).toBe("unmonitorable");
    expect(entry.missingFields).toContain("studentEmail");
    expect(entry.missingFields).toContain("parent1Email");
    // It is live and it is visible. It never reads as no action needed.
    expect(entry.stage).toBe("Active");
    expect(runClock().needsAttention.map((item) => item.leadRef)).toContain(
      "U005",
    );
  });

  it("treats a wholly unattributable lead the same way, and says which fields", () => {
    const result = runClock();
    for (const leadRef of ["U003", "U004"]) {
      const entry = entryFor(result, leadRef);
      // Indexed, not disputed, and every message on its details is ambiguous.
      // Before this outcome existed it passed every count as healthy.
      expect(entry.outcome).toBe("unattributable");
      expect(entry.sharedFields).toEqual(["parent1Email"]);
      expect(result.needsAttention.map((item) => item.leadRef)).toContain(
        leadRef,
      );
    }
  });

  it("keeps unmonitorable and unattributable distinct", () => {
    const result = runClock();
    const outcomes = new Map(
      result.entries.map((entry) => [entry.leadRef, entry.outcome]),
    );
    // One lead has nothing to match on; the other has details that reach
    // somebody else. Folding them together loses the reason.
    expect(outcomes.get("U005")).toBe("unmonitorable");
    expect(outcomes.get("U003")).toBe("unattributable");
  });

  it("still clocks a partially shared lead, and names what is invisible", () => {
    const entry = entryFor(runClock(), "U008");
    // It matches on its own unshared address, so it is measurable. Its parent
    // address is not, and the line has to say so rather than implying the
    // silence was complete.
    expect(entry.outcome).toBe("stall");
    expect(entry.evidence.invisibleFields).toEqual(["parent1Email"]);
  });

  it("marks a reachable lead with no touch and no date as unmeasurable", () => {
    const entry = entryFor(runClock(), "U010");
    // Not a stall, because no length can be defended, and certainly not fresh.
    // The Wyzant rule: a thing that cannot be re-checked is unverified, never
    // expired.
    expect(entry.outcome).toBe("unmeasurable");
    expect(entry.daysQuiet).toBeUndefined();
    expect(entry.thresholdDays).toBe(3);
  });

  it("gives each uncounted lead its own reason, never one catch-all", () => {
    const result = runClock();
    const reasons = new Map(
      result.entries.map((entry) => [entry.leadRef, entry.notClockedReason]),
    );
    // Four different situations. Collapsing any of them into "closed" would
    // say the lead is finished when it is disputed, unrecognised, or blank.
    expect(reasons.get("U006")).toBe("closed-stage");
    expect(reasons.get("U007")).toBe("disputed-stage");
    expect(reasons.get("U011")).toBe("unmapped-stage");
    expect(reasons.get("U012")).toBe("no-stage");
    expect(new Set([...reasons.values()].filter(Boolean)).size).toBe(4);
  });

  it("keeps a closed stage and a disputed stage out of the clock", () => {
    const result = runClock();
    expect(entryFor(result, "U006").outcome).toBe("not-clocked");
    expect(entryFor(result, "U006").notClockedReason).toBe("closed-stage");
    expect(entryFor(result, "U007").outcome).toBe("not-clocked");
    expect(entryFor(result, "U007").notClockedReason).toBe("disputed-stage");
    // A disputed stage is excluded because nothing may act on it, not because
    // the lead is fine. It is out of the stall list either way.
    expect(result.stalls.map((entry) => entry.leadRef)).not.toContain("U007");
  });
});

describe("7.5c: a booked call is not a stall", () => {
  it("suppresses the stall for a lead with a call ahead of it", () => {
    const quiet = runClock([touch("U001", { occurredAt: daysAgo(90) })]);
    expect(entryFor(quiet, "U001").outcome).toBe("stall");

    const booked = runClock([
      touch("U001", { occurredAt: daysAgo(90) }),
      touch("U001", {
        sourceRef: "U001-cal",
        basis: "calendar",
        kind: "meeting",
        state: "scheduled",
        occurredAt: new Date(NOW.getTime() + 3 * DAY),
      }),
    ]);
    const entry = entryFor(booked, "U001");
    // However quiet it has been. Ninety days and a call on Friday is not a
    // lead anybody needs reminding about today.
    expect(entry.outcome).toBe("booked");
    expect(entry.nextBooked?.toISOString()).toBe(
      new Date(NOW.getTime() + 3 * DAY).toISOString(),
    );
    expect(booked.stalls.map((item) => item.leadRef)).not.toContain("U001");
  });

  it("does not count a stale booking as contact that happened", () => {
    const result = runClock([
      touch("U001", {
        sourceRef: "U001-cal",
        basis: "calendar",
        kind: "meeting",
        state: "scheduled",
        // Booked, the date passed, and no scan has revisited it. It is not a
        // call ahead and it is not evidence anyone spoke.
        occurredAt: daysAgo(20),
      }),
    ]);
    const entry = entryFor(result, "U001");
    expect(entry.outcome).toBe("stall");
    expect(entry.measuredFrom).toBe("lead-date");
    expect(entry.lastTouch).toBeUndefined();
  });

  it("does not suppress on a meeting that has already happened", () => {
    const result = runClock([
      touch("U001", {
        sourceRef: "U001-cal",
        basis: "calendar",
        kind: "meeting",
        state: "occurred",
        occurredAt: daysAgo(60),
      }),
    ]);
    // A meeting sixty days ago is evidence of contact, not a reason to wait.
    expect(entryFor(result, "U001").outcome).toBe("stall");
    expect(entryFor(result, "U001").daysQuiet).toBe(60);
  });
});

describe("7.5c: a number never travels without its evidence", () => {
  it("states what was searched and what nothing can see", () => {
    const entry = entryFor(runClock(), "U001");
    expect(entry.evidence.searched).toEqual(["calendar", "email"]);
    // Section 7: roughly half of first meetings are phone calls from personal
    // mobiles. A stall that implies otherwise is a claim the data cannot back.
    expect(entry.evidence.blindTo.join(" ")).toMatch(/phone/i);
  });

  it("writes a line that says what it searched, not only a number", () => {
    const result = runClock([touch("U001", { occurredAt: daysAgo(11) })]);
    const line = describeStall(entryFor(result, "U001"));
    // The threshold travels with the count. "Quiet 11 days" alone is the
    // sentence the acceptance criteria name as a failure.
    expect(line).toContain("quiet 11 days against a 2 day threshold");
    // The sentence the acceptance criteria name as a failure is "quiet 11
    // days" on its own.
    expect(line).toMatch(/searched calendar and email/);
    expect(line).toMatch(/blind to .*phone/i);
    expect(line).toContain("U001");
  });

  it("names the row and the touch that produced the number", () => {
    const result = runClock([
      touch("U001", { occurredAt: daysAgo(11), sourceRef: "gmail-771" }),
    ]);
    const entry = entryFor(result, "U001");
    expect(entry.leadRef).toBe("U001");
    expect(entry.identity).toBe(identityFor("U001"));
    expect(entry.lastTouch?.sourceRef).toBe("gmail-771");
    expect(entry.lastTouch?.basis).toBe("email");
    expect(entry.lastTouch?.matchedField).toBe("studentEmail");
    expect(entry.lastTouch?.occurredAt).toEqual(daysAgo(11));
  });

  it("says so plainly when the number came from a lead date, not a touch", () => {
    const line = describeStall(entryFor(runClock(), "U002"));
    expect(line).toContain("no touch on record, measured from the lead date");
  });

  it("names the invisible half on a partially shared lead", () => {
    const result = runClock([touch("U008", { occurredAt: daysAgo(40) })]);
    const line = describeStall(entryFor(result, "U008"));
    expect(line).toMatch(/parent1Email shared with another lead and invisible/);
  });
});

describe("7.5c: thresholds are configuration", () => {
  it("changes the output when a threshold is flipped", () => {
    const touches = [touch("U002", { occurredAt: daysAgo(10) })];
    // Cold is 15 days, so 10 days quiet is not yet a stall.
    const asConfigured = runClock(touches);
    expect(entryFor(asConfigured, "U002").outcome).toBe("within-threshold");

    const tightened = runClock(touches, {
      thresholds: { ...DEFAULT_SILENCE_THRESHOLDS, Cold: 7 },
    });
    expect(entryFor(tightened, "U002").outcome).toBe("stall");
    expect(entryFor(tightened, "U002").thresholdDays).toBe(7);
  });

  it("takes a stage out of the clock entirely when its threshold is removed", () => {
    const { Cold, ...withoutCold } = DEFAULT_SILENCE_THRESHOLDS;
    expect(Cold).toBe(15);
    const result = runClock([], { thresholds: withoutCold });
    const entry = entryFor(result, "U002");
    expect(entry.outcome).toBe("not-clocked");
    // Its own reason. Somebody removed a setting; the lead is not finished.
    expect(entry.notClockedReason).toBe("no-threshold");
  });

  it("ships Whetstone's own cadence, not the build plan's placeholders", () => {
    // The CRM Action Sheet v1.0, which is what the rebuilt !Dashboard drives
    // its own Chase After and Chase Flag columns from. The placeholders these
    // replaced were uniformly about twice too slow, so the sheet and the clock
    // were chasing on two different cadences.
    expect(DEFAULT_SILENCE_THRESHOLDS).toEqual({
      Negotiate: 2,
      Active: 3,
      Engage: 3,
      Prospect: 7,
      Cold: 15,
    });
    // Complete, Lost, NQ and Inactive are absent rather than set high. They are
    // not slow, they are finished.
    for (const closed of ["Complete", "Lost", "NQ", "Inactive"]) {
      expect(DEFAULT_SILENCE_THRESHOLDS).not.toHaveProperty(closed);
    }
  });

  it("keeps the defaults frozen, so a caller cannot tune them by accident", () => {
    expect(Object.isFrozen(DEFAULT_SILENCE_THRESHOLDS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_WIDENING_POLICY)).toBe(true);
  });
});

describe("7.5c: a lead run by phone widens, and never silently", () => {
  const asserted = (leadRef: string, days: number, index: number) =>
    touch(leadRef, {
      basis: "asserted",
      kind: "meeting",
      direction: "outbound",
      sourceRef: `asserted:${leadRef}:${index}`,
      matchedField: null,
      assertedBy: "ren",
      occurredAt: daysAgo(days),
    });

  it("counts the asserted run back from the most recent touch", () => {
    expect(
      assertedRunLength([
        asserted("U001", 2, 1),
        asserted("U001", 9, 2),
        asserted("U001", 16, 3),
      ]),
    ).toBe(3);
  });

  it("does not count a booking as one of the assertions", () => {
    // A scheduled row is contact that has not happened. Counting it would let
    // a booked call push a lead over the widening trigger.
    expect(
      assertedRunLength([
        {
          ...asserted("U001", -3, 0),
          basis: "calendar",
          state: "scheduled",
        },
        asserted("U001", 9, 1),
        asserted("U001", 16, 2),
        asserted("U001", 23, 3),
      ]),
    ).toBe(3);
  });

  it("applies the widened number, not just records it", () => {
    const touches = [
      asserted("U001", 3, 1),
      asserted("U001", 10, 2),
      asserted("U001", 17, 3),
    ];
    const resolved = thresholdFor(
      "Negotiate",
      touches,
      DEFAULT_SILENCE_THRESHOLDS,
    );
    expect(resolved?.days).toBe(4);
    expect(resolved?.adjustment?.adjustedDays).toBe(4);
    // Three days quiet against a widened four is not a stall. Against the
    // unwidened two it would be, so the number has to actually be in use.
    expect(entryFor(runClock(touches), "U001").outcome).toBe(
      "within-threshold",
    );
  });

  it("stops counting at the first email or calendar touch", () => {
    // Three assertions, but a real message since. The mailbox can see this
    // lead again, so the cadence has evidence behind it.
    expect(
      assertedRunLength([
        touch("U001", { occurredAt: daysAgo(1) }),
        asserted("U001", 9, 1),
        asserted("U001", 16, 2),
        asserted("U001", 23, 3),
      ]),
    ).toBe(0);
  });

  it("widens the threshold after three assertions with nothing between", () => {
    const touches = [
      asserted("U001", 3, 1),
      asserted("U001", 10, 2),
      asserted("U001", 17, 3),
    ];
    const result = runClock(touches);
    const entry = entryFor(result, "U001");
    // Negotiate is 2 days. A relationship run entirely by phone is nagged on a
    // cadence the system has no evidence for, so it doubles.
    expect(entry.thresholdDays).toBe(4);
    expect(result.adjustments).toHaveLength(1);
  });

  it("records the change with its reason and its evidence", () => {
    const result = runClock([
      asserted("U001", 3, 1),
      asserted("U001", 10, 2),
      asserted("U001", 17, 3),
    ]);
    expect(result.adjustments[0]).toMatchObject({
      leadRef: "U001",
      stage: "Negotiate",
      baseDays: 2,
      adjustedDays: 4,
      reason: "asserted_only_run",
      assertedRunLength: 3,
    });
  });

  it("does not widen on two assertions", () => {
    const result = runClock([asserted("U001", 3, 1), asserted("U001", 10, 2)]);
    expect(result.adjustments).toHaveLength(0);
    expect(entryFor(result, "U001").thresholdDays).toBe(2);
  });

  it("takes its trigger and its multiplier from the policy, not from a constant", () => {
    const touches = [asserted("U001", 3, 1), asserted("U001", 10, 2)];
    const result = runClock(touches, {
      policy: { afterAssertedRun: 2, multiplier: 5 },
    });
    expect(entryFor(result, "U001").thresholdDays).toBe(10);
    expect(result.adjustments[0]?.adjustedDays).toBe(10);
  });

  it("returns no threshold at all for a stage the clock does not watch", () => {
    expect(
      thresholdFor("Complete", [], DEFAULT_SILENCE_THRESHOLDS),
    ).toBeUndefined();
  });
});

describe("7.5c: the clock is a registered workflow", () => {
  function options(touches: TouchRecord[] = []) {
    const leads = leadViews();
    return {
      leads,
      index: buildContactIndex(leads),
      touchesByIdentity: touchMap(touches),
      thresholds: DEFAULT_SILENCE_THRESHOLDS,
      thresholdRepository: new MemoryThresholdRepository(),
      now: NOW,
      coverage: {
        read: ["calendar", "email"] as TouchBasis[],
        failed: [] as TouchBasis[],
      },
    };
  }

  async function runStep(
    workflow: ReturnType<typeof createSilenceClockWorkflow>,
  ) {
    return (await workflow.steps[0]!.run({
      measure: () => {},
      recordException: async () => {},
      outputs: new Map(),
    } as never)) as SilenceClockBatch;
  }

  it("registers, so KPI #1 can count it", () => {
    const workflow = createSilenceClockWorkflow(options());
    expect(() => assertRegistrable(workflow)).not.toThrow();
    expect(workflow.id).toBe("S5.silence-clock");
    expect(workflow.approvalLevel).toBe("GREEN");
  });

  it("declares the one table it writes, and reads the rest", () => {
    const workflow = createSilenceClockWorkflow(options());
    const write = workflow.tools.filter((tool) => tool.access === "write");
    // The stall list is derived on every run and never stored. A stored copy
    // of a derived fact is the fork this phase exists to undo.
    expect(write.map((tool) => tool.name)).toEqual([
      "table:crm_threshold_overrides",
    ]);
  });

  it("claims no baseline it cannot evidence", () => {
    expect(createSilenceClockWorkflow(options()).baseline).toBeUndefined();
  });

  it("persists a widening rather than applying it in memory only", async () => {
    const repository = new MemoryThresholdRepository();
    const touches = [1, 2, 3].map((index) =>
      touch("U001", {
        basis: "asserted",
        kind: "meeting",
        direction: "outbound",
        sourceRef: `asserted:U001:${index}`,
        matchedField: null,
        assertedBy: "ren",
        occurredAt: daysAgo(index * 7),
      }),
    );
    await runStep(
      createSilenceClockWorkflow({
        ...options(touches),
        thresholdRepository: repository,
      }),
    );
    expect(repository.recorded).toHaveLength(1);
    expect(repository.recorded[0]?.reason).toBe("asserted_only_run");
  });

  it("lapses an override for a lead whose run has broken", async () => {
    const repository = new MemoryThresholdRepository();
    await runStep(
      createSilenceClockWorkflow({
        ...options(),
        thresholdRepository: repository,
      }),
    );
    // Nothing widened this run, so every lead is a candidate to be released
    // back to its stage default. A suppression nobody remembers switching on
    // is how a lead goes quiet for six months.
    expect(repository.cleared).toContain(identityFor("U001"));
    expect(repository.recorded).toHaveLength(0);
  });

  it("does not lapse the override of a lead that just widened", async () => {
    const repository = new MemoryThresholdRepository();
    const touches = [1, 2, 3].map((index) =>
      touch("U001", {
        basis: "asserted",
        kind: "meeting",
        direction: "outbound",
        sourceRef: `asserted:U001:${index}`,
        matchedField: null,
        assertedBy: "ren",
        occurredAt: daysAgo(index * 7),
      }),
    );
    await runStep(
      createSilenceClockWorkflow({
        ...options(touches),
        thresholdRepository: repository,
      }),
    );
    // Recording the widening and then clearing it in the same run would leave
    // the lead widened in memory and released in the database.
    expect(repository.recorded[0]?.identity).toBe(identityFor("U001"));
    expect(repository.cleared).not.toContain(identityFor("U001"));
  });

  it("fails its own gate when a lead read did not land anywhere", () => {
    const workflow = createSilenceClockWorkflow(options());
    const gate = workflow.qaGates.find(
      (item) => item.id === "every-lead-lands-somewhere",
    );
    const lost = {
      entries: [],
      stalls: [],
      needsAttention: [],
      adjustments: [],
      balanced: true,
      leadsRead: 3,
      stallCount: 0,
      needsAttentionCount: 0,
    };
    // Three leads read and nothing came back. The gate has to notice, or a
    // clock that silently drops a lead reports a clean run.
    expect(
      gate?.check({ outputs: new Map([["run-clock", lost]]) } as never),
    ).toBe(false);
  });

  it("passes its own gate that every lead landed somewhere", async () => {
    const workflow = createSilenceClockWorkflow(options());
    const batch = await runStep(workflow);
    const outputs = new Map([["run-clock", batch]]);
    for (const gate of workflow.qaGates) {
      expect(gate.check({ outputs } as never), gate.id).toBe(true);
    }
  });

  it("fails its own gate when a stall carries a number with no basis", () => {
    const workflow = createSilenceClockWorkflow(options());
    const gate = workflow.qaGates.find(
      (item) => item.id === "no-stall-states-a-number-without-its-basis",
    );
    const stripped = {
      entries: [],
      leadsRead: 0,
      balanced: true,
      needsAttention: [],
      adjustments: [],
      stallCount: 1,
      needsAttentionCount: 0,
      stalls: [
        {
          identity: "i",
          leadRef: "U001",
          outcome: "stall",
          daysQuiet: 11,
          thresholdDays: 3,
          evidence: {
            searched: [],
            observed: [],
            blindTo: [],
            invisibleFields: [],
          },
        },
      ],
    };
    // The gate has to reject "quiet 11 days" with nothing behind it, or it is
    // not a gate.
    expect(
      gate?.check({ outputs: new Map([["run-clock", stripped]]) } as never),
    ).toBe(false);
  });
});

describe("7.5c: the override table", () => {
  async function readMigration(): Promise<string> {
    return readFile(
      new URL(
        "../prisma/migrations/202608280002_phase_7_5c_silence_clock/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
  }

  it("ships with row level security", async () => {
    expect(await readMigration()).toContain(
      "ALTER TABLE public.crm_threshold_overrides ENABLE ROW LEVEL SECURITY;",
    );
  });

  it("pins the reason vocabulary and demands the evidence", async () => {
    const sql = await readMigration();
    expect(sql).toMatch(/CHECK \(reason IN \('asserted_only_run'\)\)/);
    expect(sql).toMatch(/CHECK \(asserted_run_length > 0\)/);
    // An override that changes nothing is not a record of a change.
    expect(sql).toMatch(
      /CHECK \(adjusted_days > base_days AND base_days > 0\)/,
    );
  });

  it("refuses a threshold for a stage the clock does not watch", async () => {
    const sql = await readMigration();
    expect(sql).toMatch(
      /CHECK \(stage IN \('Negotiate', 'Active', 'Engage', 'Prospect', 'Cold'\)\)/,
    );
  });

  it("keeps one live override per lead and stage", async () => {
    expect(await readMigration()).toMatch(
      /CREATE UNIQUE INDEX "crm_threshold_overrides_identity_stage_key"/,
    );
  });

  it("upserts a widening rather than writing a second one each run", async () => {
    const source = await readFile(
      new URL("../lib/crm/threshold-store.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/crmThresholdOverride\.upsert/);
    expect(source).not.toMatch(/crmThresholdOverride\.create\(/);
    // Re-widening a lead whose run has grown makes the same override live
    // again rather than leaving it marked lapsed while it is in force.
    expect(source).toMatch(/clearedAt: null,/);
  });

  it("only lapses overrides that are currently in force", async () => {
    const source = await readFile(
      new URL("../lib/crm/threshold-store.ts", import.meta.url),
      "utf8",
    );
    const clear = source.slice(source.indexOf("async clearAdjustments"));
    // Without the clearedAt filter every historical row would be restamped on
    // every run and the date a widening actually ended would be lost.
    expect(clear).toMatch(/clearedAt: null/);
  });

  it("never deletes a widening, so the history survives it", async () => {
    const source = await readFile(
      new URL("../lib/crm/threshold-store.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\.delete\(|deleteMany/);
    expect(source).toMatch(/clearedAt/);
  });

  it("stores no stall list, because a derived fact stored twice is the defect", async () => {
    const sql = await readFile(
      new URL(
        "../prisma/migrations/202608280002_phase_7_5c_silence_clock/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const tables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(tables).toEqual(["crm_threshold_overrides"]);
  });

  it("carries no real student names into the repository", async () => {
    const [brief, source] = await Promise.all([
      readFile(new URL("../docs/PHASE-7.5-CRM.md", import.meta.url), "utf8"),
      readFile(
        new URL("./phase-7-5c-silence-clock.test.ts", import.meta.url),
        "utf8",
      ),
    ]);
    const students = [...brief.matchAll(/^\| \d+ \| U\d+ \| ([^|]+?) \|/gm)]
      .map((match) => match[1].trim())
      .filter((name) => /^[A-Z][a-z]+ [A-Z]/.test(name));
    expect(
      students.length,
      "no student names found in the brief",
    ).toBeGreaterThan(3);
    for (const name of students) {
      for (const part of name.split(/\s+/)) {
        expect(source.toLowerCase()).not.toContain(part.toLowerCase());
      }
    }
    for (const address of source.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)) {
      expect(address[0]).toMatch(/@example\.com$/i);
    }
  });
});
