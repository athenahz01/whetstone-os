import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { toLeadView, type CrmLeadView } from "../lib/crm/actionable";
import { buildContactIndex, lookupContact } from "../lib/crm/contacts";
import { mergeCrmSources, type CrmSourceRow } from "../lib/crm/merge";
import {
  assertedTouch,
  detectTouches,
  evidenceBasis,
  isTouchScanBalanced,
  meetingMilestones,
  nextScheduledTouch,
  subjectReference,
  touchKey,
  touchState,
  type TouchCandidate,
  type TouchProvider,
  type TouchRecord,
} from "../lib/crm/touches";
import { assertRegistrable } from "../lib/core/registry";
import {
  createTouchScanWorkflow,
  type TouchScanBatch,
} from "../lib/workflows/s4-touch-scan";
import {
  classifyScanFailure,
  runTouchScan,
  type TouchRepository,
  type TouchScanRecord,
} from "../lib/crm/touch-store";

/**
 * Addresses here are invented and use the reserved documentation domain.
 *
 * The real records carry minors and their parents' contact details, and section
 * 5.3 flags exactly that. A fixture is the wrong place for them: it would put
 * them in the repository, in every clone, forever, to prove something the
 * structure proves on its own.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");

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

/**
 * Leads with the contact shapes touch detection has to survive.
 *
 * A student with their own email, a lead reachable only through a parent, a
 * parent address shared by two siblings, a lead with a disputed address, and a
 * lead with no usable contact detail at all. 52 of 69 real rows have no student
 * email, so the last of those is the common case and not an edge.
 */
function fixture() {
  rowCounter = 0;
  const primary: CrmSourceRow[] = [
    dashboard({
      ID: "U001",
      "S First": "Ada",
      "S Last": "Sparrow",
      Status: "Active",
      "S Email": "Ada.Sparrow@Example.com",
      "P1 Email": "rowan.sparrow@example.com",
      "P1 Phone": "(555) 010-1234",
    }),
    // No student email. Reachable only through a parent, like most real rows.
    dashboard({
      ID: "U002",
      "S First": "Bea",
      "S Last": "Marlow",
      Status: "Engage",
      "P1 Email": "shared.parent@example.com",
    }),
    // A sibling on the same parent address. One address, two leads.
    dashboard({
      ID: "U003",
      "S First": "Cy",
      "S Last": "Marlow",
      Status: "Prospect",
      "P1 Email": "shared.parent@example.com",
    }),
    // The two files disagree about this student's own address.
    dashboard({
      ID: "U004",
      "S First": "Dev",
      "S Last": "Ramanathan",
      Status: "Active",
      "S Email": "dev.r@example.com",
    }),
    // No contact detail of any kind. Unmonitorable, not healthy.
    dashboard({
      ID: "U005",
      "S First": "Ell",
      "S Last": "Trevino",
      Status: "Cold",
    }),
    // Their own address, so one message can reach two separate leads.
    dashboard({
      ID: "U006",
      "S First": "Fay",
      "S Last": "Bright",
      Status: "Active",
      "S Email": "fay.bright@example.com",
    }),
    // A cell holding something that is not an address at all.
    dashboard({
      ID: "U007",
      "S First": "Gus",
      "S Last": "Iyer",
      Status: "Cold",
      "S Email": "ask mum",
      "S Phone": "n/a",
    }),
  ];
  const secondary: CrmSourceRow[] = [
    copy({
      ID: "U004",
      "S First": "Dev",
      "S Last": "Ramanathan",
      "S Email": "d.ramanathan@example.com",
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

function index() {
  return buildContactIndex(leadViews());
}

function identityFor(leadRef: string): string {
  const lead = leadViews().find((candidate) => candidate.leadRef === leadRef);
  if (!lead) throw new Error(`no lead ${leadRef}`);
  return lead.identity;
}

const email = (
  sourceRef: string,
  to: string[],
  overrides: Partial<TouchCandidate> = {},
): TouchCandidate => ({
  sourceRef,
  basis: "email",
  kind: "email",
  direction: "inbound",
  occurredAt: new Date("2026-08-20T09:00:00.000Z"),
  participants: to.map((value) => ({ kind: "email" as const, value })),
  ...overrides,
});

class MemoryTouchRepository implements TouchRepository {
  readonly touches = new Map<string, TouchRecord>();
  readonly unmatched: Array<{
    sourceRef: string;
    reason: string;
    scannedAt: string;
  }> = [];
  readonly scans: TouchScanRecord[] = [];

  async upsertTouch(touch: TouchRecord) {
    const key = touchKey(touch);
    const held = this.touches.get(key);
    // Mirrors the Prisma upsert: a re-read updates only what can legitimately
    // change, and never creates a second row.
    this.touches.set(
      key,
      held
        ? { ...held, state: touch.state, occurredAt: touch.occurredAt }
        : { ...touch },
    );
  }
  async recordUnmatched(item: {
    sourceRef: string;
    reason: string;
    basis: string;
    scannedAt: Date;
  }) {
    const scannedAt = item.scannedAt.toISOString();
    // Mirrors the unique index on (basis, source_ref, scanned_at): the same
    // scan seeing the same message again is one row, not two.
    if (
      this.unmatched.some(
        (held) =>
          held.sourceRef === item.sourceRef && held.scannedAt === scannedAt,
      )
    ) {
      return;
    }
    this.unmatched.push({
      sourceRef: item.sourceRef,
      reason: item.reason,
      scannedAt,
    });
  }
  async recordScan(scan: TouchScanRecord) {
    this.scans.push(scan);
  }
  snapshot() {
    return JSON.stringify({
      touches: [...this.touches.entries()].sort(),
      unmatched: this.unmatched,
    });
  }
}

function provider(
  candidates: TouchCandidate[],
  name: TouchProvider["name"] = "email",
): TouchProvider {
  return { name, fetch: async () => candidates };
}

describe("7.5b: a seeded email produces exactly one touch, and re-running produces none", () => {
  it("writes one touch for a message to a known lead address", async () => {
    const repository = new MemoryTouchRepository();
    const outcome = await runTouchScan(
      provider([email("msg-1", ["ada.sparrow@example.com"])]),
      index(),
      repository,
      { since: new Date("2026-08-01T00:00:00.000Z"), until: NOW },
      NOW,
    );
    expect(outcome.touches).toHaveLength(1);
    expect(repository.touches.size).toBe(1);
    expect(outcome.touches[0]?.leadRef).toBe("U001");
    expect(outcome.scan.matched).toBe(1);
  });

  it("adds nothing on a second run over the same window", async () => {
    const repository = new MemoryTouchRepository();
    const candidates = [
      email("msg-1", ["ada.sparrow@example.com"]),
      email("msg-2", ["shared.parent@example.com"]),
    ];
    const window = { since: new Date("2026-08-01T00:00:00.000Z"), until: NOW };
    await runTouchScan(provider(candidates), index(), repository, window, NOW);
    const first = repository.snapshot();
    const countAfterFirst = repository.touches.size;

    await runTouchScan(provider(candidates), index(), repository, window, NOW);
    expect(repository.touches.size).toBe(countAfterFirst);
    expect(repository.snapshot()).toBe(first);
    // Two attempts, both recorded. Idempotent rows, not an idempotent record
    // of having run.
    expect(repository.scans).toHaveLength(2);
  });

  it("matches on a parent address when the student has no email of their own", async () => {
    const found = lookupContact(index(), "email", "rowan.sparrow@example.com");
    expect(found.outcome).toBe("matched");
    if (found.outcome === "matched") {
      expect(found.entry.leadRef).toBe("U001");
      expect(found.entry.field).toBe("parent1Email");
    }
  });

  it("normalises case and phone formatting before comparing", () => {
    const built = index();
    expect(
      lookupContact(built, "email", "ADA.SPARROW@EXAMPLE.COM").outcome,
    ).toBe("matched");
    expect(lookupContact(built, "phone", "+1 555 010 1234").outcome).toBe(
      "matched",
    );
  });
});

describe("7.5b: a non-match is recorded, and a failure never looks like a quiet day", () => {
  it("records an unmatched message with a reason rather than discarding it", async () => {
    const repository = new MemoryTouchRepository();
    const outcome = await runTouchScan(
      provider([email("msg-9", ["nobody@example.com"])]),
      index(),
      repository,
      { since: new Date("2026-08-01T00:00:00.000Z"), until: NOW },
      NOW,
    );
    expect(outcome.touches).toHaveLength(0);
    expect(repository.unmatched).toEqual([
      {
        sourceRef: "msg-9",
        reason: "no_matching_lead",
        scannedAt: NOW.toISOString(),
      },
    ]);
    expect(outcome.scan.unmatched).toBe(1);
  });

  it("distinguishes a quiet day from a broken job", async () => {
    const quiet = new MemoryTouchRepository();
    await runTouchScan(
      provider([]),
      index(),
      quiet,
      { since: new Date("2026-08-01T00:00:00.000Z"), until: NOW },
      NOW,
    );

    const broken = new MemoryTouchRepository();
    const failing: TouchProvider = {
      name: "email",
      fetch: async () => {
        throw new Error("connect ETIMEDOUT imap.example.com");
      },
    };
    await expect(
      runTouchScan(
        failing,
        index(),
        broken,
        { since: new Date("2026-08-01T00:00:00.000Z"), until: NOW },
        NOW,
      ),
    ).rejects.toThrow();

    // Both wrote no touches. Only one of them says why.
    expect(quiet.touches.size).toBe(0);
    expect(broken.touches.size).toBe(0);
    expect(quiet.scans[0]?.status).toBe("completed");
    expect(quiet.scans[0]?.failureReason).toBeNull();
    expect(broken.scans[0]?.status).toBe("failed");
    expect(broken.scans[0]?.failureReason).toBe("provider_timed_out");
  });

  it("records the attempt before it rethrows, so a failure cannot vanish", async () => {
    const repository = new MemoryTouchRepository();
    const failing: TouchProvider = {
      name: "calendar",
      fetch: async () => {
        throw new Error("401 invalid credentials");
      },
    };
    await expect(
      runTouchScan(
        failing,
        index(),
        repository,
        { since: NOW, until: NOW },
        NOW,
      ),
    ).rejects.toThrow(/invalid credentials/);
    expect(repository.scans).toHaveLength(1);
    expect(repository.scans[0]?.failureReason).toBe(
      "provider_rejected_credentials",
    );
  });

  it("classifies a failure into the closed list, never the provider's own words", () => {
    expect(classifyScanFailure(new Error("429 too many requests"))).toBe(
      "provider_rate_limited",
    );
    expect(classifyScanFailure(new Error("unexpected token in JSON"))).toBe(
      "malformed_provider_response",
    );
    expect(classifyScanFailure(new Error("getaddrinfo ENOTFOUND"))).toBe(
      "provider_unreachable",
    );
    // The point of the vocabulary: a message naming a person classifies to a
    // member and the message itself is not what gets stored.
    expect(
      classifyScanFailure(new Error("no mailbox for ada@example.com")),
    ).toBe("provider_unreachable");
  });

  it("accounts for every candidate read", async () => {
    const repository = new MemoryTouchRepository();
    const outcome = await runTouchScan(
      provider([
        email("m1", ["ada.sparrow@example.com"]),
        email("m2", ["nobody@example.com"]),
        email("m3", ["shared.parent@example.com"]),
        email("m4", []),
      ]),
      index(),
      repository,
      { since: new Date("2026-08-01T00:00:00.000Z"), until: NOW },
      NOW,
    );
    const scan = outcome.scan;
    // A message addressed to nobody is its own outcome, not a lead that could
    // not be found: there was never an address to look up.
    expect(scan.unaddressed).toBe(1);
    expect(
      repository.unmatched.find((item) => item.sourceRef === "m4")?.reason,
    ).toBe("no_participants");
    expect(scan.candidatesRead).toBe(4);
    expect(
      scan.matched + scan.unmatched + scan.ambiguous + scan.unaddressed,
    ).toBe(scan.candidatesRead);
    expect(scan.balanced).toBe(true);
  });

  it("calls a tally unbalanced when the numbers do not add up", () => {
    expect(
      isTouchScanBalanced({
        candidatesRead: 4,
        matched: 1,
        unmatched: 1,
        ambiguous: 0,
        unaddressed: 1,
      }),
    ).toBe(false);
    expect(
      isTouchScanBalanced({
        candidatesRead: 4,
        matched: 2,
        unmatched: 1,
        ambiguous: 0,
        unaddressed: 1,
      }),
    ).toBe(true);
  });

  it("refuses to write a scan whose totals do not account for what it read", async () => {
    const repository = new MemoryTouchRepository();
    const lying: TouchProvider = {
      name: "email",
      // A provider handing back the same id twice: two candidates read, one
      // touch, and the tally has to still add up.
      fetch: async () => [
        email("dup", ["ada.sparrow@example.com"]),
        email("dup", ["ada.sparrow@example.com"]),
      ],
    };
    const outcome = await runTouchScan(
      lying,
      index(),
      repository,
      { since: new Date("2026-08-01T00:00:00.000Z"), until: NOW },
      NOW,
    );
    // One stored touch, two candidates counted. The dedupe happens on the key,
    // not by quietly dropping one from the count.
    expect(outcome.touches).toHaveLength(1);
    expect(outcome.scan.candidatesRead).toBe(2);
    expect(outcome.scan.matched).toBe(2);
    expect(outcome.scan.balanced).toBe(true);
  });
});

describe("7.5b: a count of matches cannot prove the matches were right", () => {
  it("refuses to guess when one address reaches two leads", () => {
    const found = lookupContact(index(), "email", "shared.parent@example.com");
    // Two siblings on one parent address. Picking the first would attribute
    // the touch to whichever lead happened to be indexed first, and every
    // count downstream would still add up. That is the 7.5a split defect in a
    // different join.
    expect(found.outcome).toBe("ambiguous");
    if (found.outcome === "ambiguous") {
      expect(new Set(found.entries.map((entry) => entry.identity)).size).toBe(
        2,
      );
    }
  });

  it("counts an ambiguous message separately from one that matched nothing", async () => {
    const repository = new MemoryTouchRepository();
    const outcome = await runTouchScan(
      provider([
        email("amb", ["shared.parent@example.com"]),
        email("none", ["nobody@example.com"]),
      ]),
      index(),
      repository,
      { since: new Date("2026-08-01T00:00:00.000Z"), until: NOW },
      NOW,
    );
    expect(outcome.touches).toHaveLength(0);
    expect(outcome.scan.ambiguous).toBe(1);
    expect(outcome.scan.unmatched).toBe(1);
    expect(repository.unmatched.map((item) => item.reason).sort()).toEqual([
      "ambiguous_lead",
      "no_matching_lead",
    ]);
  });

  it("names how many leads an ambiguous address reached", () => {
    const result = detectTouches(
      index(),
      [email("amb", ["shared.parent@example.com"])],
      NOW,
    );
    expect(result.unmatched[0]?.candidateLeads).toBe(2);
  });

  it("is one touch, not two, when a message reaches a student and their parent", () => {
    const result = detectTouches(
      index(),
      [email("m", ["ada.sparrow@example.com", "rowan.sparrow@example.com"])],
      NOW,
    );
    expect(result.touches).toHaveLength(1);
    expect(result.tally.matched).toBe(1);
    // The cell that identified the lead is recorded, and it is the first one
    // that matched rather than whichever happened to be looked at last.
    expect(result.touches[0]?.matchedField).toBe("studentEmail");
  });

  it("is two touches when one message reaches two different leads", () => {
    const result = detectTouches(
      index(),
      [email("m", ["ada.sparrow@example.com", "fay.bright@example.com"])],
      NOW,
    );
    // One message, two families. Keying a touch on the provider id alone would
    // store one of them and lose the other, and the tally would still balance.
    expect(result.touches).toHaveLength(2);
    expect(result.touches.map((touch) => touch.leadRef).sort()).toEqual([
      "U001",
      "U006",
    ]);
    // One candidate read, so it counts once however many leads it reached.
    expect(result.tally.matched).toBe(1);
  });

  it("never matches on a contact cell the two files disagree about", () => {
    const built = index();
    // U004's own address is disputed, so neither value is a fact about who a
    // message was from until somebody rules.
    expect(lookupContact(built, "email", "dev.r@example.com").outcome).toBe(
      "unmatched",
    );
    expect(
      lookupContact(built, "email", "d.ramanathan@example.com").outcome,
    ).toBe("unmatched");
    expect(built.disputedContacts.map((item) => item.field)).toContain(
      "studentEmail",
    );
  });

  it("names the disputed cell among the fields it could not use", () => {
    const built = index();
    const dev = built.unmonitorable.find((item) => item.leadRef === "U004");
    // Unmonitorable because of a dispute, and the reason travels with the lead
    // rather than being recomputed by whoever displays it.
    expect(dev?.missingFields).toContain("studentEmail");
  });

  it("counts a cell holding something that is not an address as missing", () => {
    const built = index();
    const gus = built.unmonitorable.find((item) => item.leadRef === "U007");
    // "ask mum" is present and unusable. Present-but-unusable has to read as
    // missing, or the lead looks reachable and never gets matched on.
    expect(gus).toBeDefined();
    expect(gus?.missingFields).toContain("studentEmail");
    expect(gus?.missingFields).toContain("studentPhone");
    expect(built.entries.some((entry) => entry.leadRef === "U007")).toBe(false);
    // And it is not a dispute. Nobody disagreed; the cell just says nothing.
    expect(built.disputedContacts.some((item) => item.leadRef === "U007")).toBe(
      false,
    );
  });

  it("never lets one normalised value belong to two kinds", () => {
    const built = index();
    const kindsByValue = new Map<string, Set<string>>();
    for (const entry of built.entries) {
      const held = kindsByValue.get(entry.value) ?? new Set<string>();
      held.add(entry.kind);
      kindsByValue.set(entry.value, held);
    }
    // An email always contains an at sign and a comparable phone never does,
    // so a value cannot be both. This is why a lookup can trust its own kind.
    for (const [value, kinds] of kindsByValue) {
      expect(
        kinds.size,
        `${value} was indexed as ${[...kinds].join(" and ")}`,
      ).toBe(1);
    }
    expect(built.entries.some((entry) => entry.kind === "phone")).toBe(true);
    expect(built.entries.some((entry) => entry.kind === "email")).toBe(true);
  });

  it("names a lead with no usable contact detail, with the fields that were empty", () => {
    const built = index();
    const ell = built.unmonitorable.find((item) => item.leadRef === "U005");
    expect(ell).toBeDefined();
    expect(ell?.missingFields).toContain("studentEmail");
    expect(ell?.missingFields).toContain("parent1Email");
    // A lead that cannot be matched on is not a lead with nothing happening.
    expect(built.entries.some((entry) => entry.leadRef === "U005")).toBe(false);
  });

  it("counts a disputed address as unmonitorable rather than as absent", () => {
    const built = index();
    expect(built.unmonitorable.some((item) => item.leadRef === "U004")).toBe(
      true,
    );
    // The two are distinguishable: one lead never had an address, the other
    // has two nobody has chosen between.
    expect(built.disputedContacts.some((item) => item.leadRef === "U004")).toBe(
      true,
    );
    expect(built.disputedContacts.some((item) => item.leadRef === "U005")).toBe(
      false,
    );
  });
});

describe("7.5b: meeting and email are distinguishable, and so is a booked call", () => {
  it("keeps the kind that the thresholds depend on", () => {
    const result = detectTouches(
      index(),
      [
        email("e1", ["ada.sparrow@example.com"]),
        {
          sourceRef: "cal-1",
          basis: "calendar",
          kind: "meeting",
          direction: "outbound",
          occurredAt: new Date("2026-08-10T15:00:00.000Z"),
          participants: [{ kind: "email", value: "ada.sparrow@example.com" }],
        },
      ],
      NOW,
    );
    expect(result.touches.map((touch) => touch.kind).sort()).toEqual([
      "email",
      "meeting",
    ]);
  });

  it("stores a future calendar event as scheduled and a past one as occurred", () => {
    const past = {
      sourceRef: "cal-past",
      basis: "calendar" as const,
      kind: "meeting" as const,
      direction: "outbound" as const,
      occurredAt: new Date("2026-08-10T15:00:00.000Z"),
      participants: [
        { kind: "email" as const, value: "ada.sparrow@example.com" },
      ],
    };
    const future = {
      ...past,
      sourceRef: "cal-future",
      occurredAt: new Date("2026-09-04T15:00:00.000Z"),
    };
    const result = detectTouches(index(), [past, future], NOW);
    const byRef = new Map(
      result.touches.map((touch) => [touch.sourceRef, touch]),
    );
    expect(byRef.get("cal-past")?.state).toBe("occurred");
    expect(byRef.get("cal-future")?.state).toBe("scheduled");
  });

  it("never marks an email as scheduled, because nothing here sends", () => {
    expect(
      touchState(
        { basis: "email", occurredAt: new Date("2099-01-01T00:00:00.000Z") },
        NOW,
      ),
    ).toBe("occurred");
    expect(
      touchState(
        { basis: "calendar", occurredAt: new Date("2099-01-01T00:00:00.000Z") },
        NOW,
      ),
    ).toBe("scheduled");
  });

  it("finds the next booked call, which is what suppresses a stall", () => {
    const touches: TouchRecord[] = [
      {
        identity: identityFor("U001"),
        leadRef: "U001",
        basis: "calendar",
        kind: "meeting",
        direction: "outbound",
        state: "scheduled",
        occurredAt: new Date("2026-09-04T15:00:00.000Z"),
        sourceRef: "cal-future",
        subjectRef: null,
        matchedField: "studentEmail",
        assertedBy: null,
      },
    ];
    expect(nextScheduledTouch(touches, NOW)?.sourceRef).toBe("cal-future");
    // Once it has happened it is no longer a reason not to nag.
    expect(
      nextScheduledTouch(touches, new Date("2026-09-05T00:00:00.000Z")),
    ).toBeUndefined();
  });
});

describe("7.5b: 1M, 2M and 3M are derived, never written by a human", () => {
  const meeting = (day: string, state: "occurred" | "scheduled" = "occurred") =>
    ({
      identity: "i",
      leadRef: "U001",
      basis: "calendar",
      kind: "meeting",
      direction: "outbound",
      state,
      occurredAt: new Date(day),
      sourceRef: day,
      subjectRef: null,
      matchedField: null,
      assertedBy: null,
    }) satisfies TouchRecord;

  it("reads the three milestones out of the touch record in order", () => {
    const milestones = meetingMilestones([
      meeting("2026-03-02T10:00:00.000Z"),
      meeting("2026-01-05T10:00:00.000Z"),
      meeting("2026-02-11T10:00:00.000Z"),
    ]);
    expect(milestones.first?.toISOString()).toBe("2026-01-05T10:00:00.000Z");
    expect(milestones.second?.toISOString()).toBe("2026-02-11T10:00:00.000Z");
    expect(milestones.third?.toISOString()).toBe("2026-03-02T10:00:00.000Z");
  });

  it("does not count a booked call as a meeting that happened", () => {
    const milestones = meetingMilestones([
      meeting("2026-01-05T10:00:00.000Z"),
      meeting("2026-09-04T10:00:00.000Z", "scheduled"),
    ]);
    expect(milestones.first?.toISOString()).toBe("2026-01-05T10:00:00.000Z");
    expect(milestones.second).toBeUndefined();
  });

  it("does not count an email as a meeting", () => {
    const emailTouch = {
      ...meeting("2026-01-05T10:00:00.000Z"),
      kind: "email" as const,
    };
    expect(meetingMilestones([emailTouch]).first).toBeUndefined();
  });

  it("offers no writable field for the milestone columns", async () => {
    const source = await readFile(
      new URL("../lib/crm/merge.ts", import.meta.url),
      "utf8",
    );
    // The columns a human was supposed to keep current are not importable and
    // not storable. They are read out of `crm_touches` instead, which is the
    // whole point: nobody fills them in again.
    for (const column of ["1M Date", "2M Date", "3M Date"]) {
      expect(source).not.toContain(column);
    }
    for (const field of ["firstMeeting", "secondMeeting", "thirdMeeting"]) {
      expect(source).not.toContain(field);
    }
  });
});

describe("7.5b: every row says how it was learned", () => {
  it("carries a basis on every touch a scan produces", () => {
    const result = detectTouches(
      index(),
      [
        email("e1", ["ada.sparrow@example.com"]),
        {
          sourceRef: "cal-1",
          basis: "calendar",
          kind: "meeting",
          direction: "outbound",
          occurredAt: new Date("2026-08-10T15:00:00.000Z"),
          participants: [{ kind: "email", value: "ada.sparrow@example.com" }],
        },
      ],
      NOW,
    );
    expect(result.touches.map((touch) => touch.basis).sort()).toEqual([
      "calendar",
      "email",
    ]);
    for (const touch of result.touches) {
      expect(["email", "calendar", "asserted"]).toContain(touch.basis);
    }
  });

  it("writes a real row when a human says they already spoke to them", () => {
    const touch = assertedTouch({
      identity: identityFor("U005"),
      leadRef: "U005",
      assertedBy: "ren",
      occurredAt: NOW,
    });
    // A row, not a suppression flag, so the clock resets for the same reason
    // any other contact resets it and the claim is auditable afterwards.
    expect(touch.basis).toBe("asserted");
    expect(touch.assertedBy).toBe("ren");
    expect(touch.kind).toBe("meeting");
    expect(touch.state).toBe("occurred");
  });

  it("refuses an assertion that does not name who made it", () => {
    expect(() =>
      assertedTouch({
        identity: "i",
        leadRef: "U005",
        assertedBy: "   ",
        occurredAt: NOW,
      }),
    ).toThrow(/must name who asserted it/);
  });

  it("collapses repeated assertions on one day into one row", () => {
    const first = assertedTouch({
      identity: "i",
      leadRef: "U005",
      assertedBy: "ren",
      occurredAt: new Date("2026-08-28T09:00:00.000Z"),
    });
    const second = assertedTouch({
      identity: "i",
      leadRef: "U005",
      assertedBy: "ren",
      occurredAt: new Date("2026-08-28T17:30:00.000Z"),
    });
    // Tapping the button twice is not two conversations.
    expect(touchKey(first)).toBe(touchKey(second));
  });

  it("states what was searched and what it is blind to", () => {
    const basis = evidenceBasis([
      assertedTouch({
        identity: "i",
        leadRef: "U005",
        assertedBy: "ren",
        occurredAt: NOW,
      }),
    ]);
    // Section 7: roughly half of first meetings are phone calls that leave no
    // trace. A number offered without this is a claim the data cannot support.
    expect(basis.searched).toEqual(["calendar", "email"]);
    expect(basis.observed).toEqual(["asserted"]);
    expect(basis.blindTo.join(" ")).toMatch(/phone/i);
  });
});

describe("7.5b: no prose is stored", () => {
  it("reduces a subject line to a digest", () => {
    const ref = subjectReference("Tutoring for Ada next term");
    expect(ref).toMatch(/^subj_[0-9a-f]{16}$/);
    expect(ref).not.toMatch(/ada/i);
    expect(ref).not.toMatch(/tutoring/i);
  });

  it("correlates a reply with the message it answers", () => {
    const original = subjectReference("Session times");
    expect(subjectReference("Re: Session times")).toBe(original);
    expect(subjectReference("RE: FW: Session times")).toBe(original);
    expect(subjectReference("  session   TIMES ")).toBe(original);
  });

  it("stores a digest rather than the subject it was given", () => {
    const result = detectTouches(
      index(),
      [
        email("m", ["ada.sparrow@example.com"], {
          subject: "Ada Sparrow SAT prep and her Fulbright essay",
        }),
      ],
      NOW,
    );
    // The identity legitimately carries the student's name: it is the CRM
    // record's own key. What must never appear is anything from the subject.
    const stored = JSON.stringify(result.touches);
    expect(stored).not.toMatch(/Fulbright/i);
    expect(stored).not.toMatch(/SAT/i);
    expect(stored).not.toMatch(/prep/i);
    expect(stored).not.toMatch(/essay/i);
    expect(result.touches[0]?.subjectRef).toMatch(/^subj_[0-9a-f]{16}$/);
  });

  it("gives a touch record no field that could hold a body", () => {
    const result = detectTouches(
      index(),
      [
        email("m", ["ada.sparrow@example.com"], {
          subject: "anything at all",
        }),
      ],
      NOW,
    );
    const keys = Object.keys(result.touches[0] ?? {});
    for (const forbidden of ["body", "text", "snippet", "preview", "subject"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("gives the table no column that could hold a body", async () => {
    const sql = await readMigration();
    const table = sql.slice(
      sql.indexOf('CREATE TABLE "crm_touches"'),
      sql.indexOf('CREATE TABLE "crm_touch_unmatched"'),
    );
    for (const forbidden of [
      '"body"',
      '"text"',
      '"snippet"',
      '"preview"',
      '"subject"',
      '"participants"',
    ]) {
      expect(table).not.toContain(forbidden);
    }
    expect(table).toContain('"subject_ref"');
  });

  it("pins the digest shape in the database, not only in the writer", async () => {
    const sql = await readMigration();
    // A writer that starts storing prose fails here rather than passing every
    // test and shipping a student's name.
    expect(sql).toMatch(/subject_ref ~ '\^subj_\[0-9a-f\]\{16\}\$'/);
  });

  it("carries no real student names or addresses into the repository", async () => {
    const [brief, source] = await Promise.all([
      readFile(new URL("../docs/PHASE-7.5-CRM.md", import.meta.url), "utf8"),
      readFile(
        new URL("./phase-7-5b-touch-detection.test.ts", import.meta.url),
        "utf8",
      ),
    ]);
    // Read out of the brief rather than listed here, so this assertion cannot
    // become the thing it forbids.
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
    // Every address in the fixture is on the reserved documentation domain.
    for (const address of source.matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)) {
      expect(address[0]).toMatch(/@example\.com$/i);
    }
  });
});

describe("7.5b: the scan is a registered workflow", () => {
  it("registers, so KPI #1 can count it", () => {
    const workflow = createTouchScanWorkflow(scanOptions());
    expect(() => assertRegistrable(workflow)).not.toThrow();
    expect(workflow.id).toBe("S4.touch-scan");
    expect(workflow.approvalLevel).toBe("GREEN");
  });

  it("declares every table it writes and reads nothing it does not name", () => {
    const workflow = createTouchScanWorkflow(scanOptions());
    const tools = workflow.tools.map((tool) => tool.name);
    expect(tools).toContain("table:crm_touches");
    expect(tools).toContain("table:crm_touch_scans");
    expect(tools).toContain("table:crm_touch_unmatched");
    // Both mailboxes are declared read, and neither is declared write.
    for (const name of ["gmail", "google-calendar"]) {
      const tool = workflow.tools.find((item) => item.name === name);
      expect(tool?.access).toBe("read");
    }
  });

  it("claims no baseline it cannot evidence", () => {
    // Nothing in BASELINES.md measures noticing a contact and writing it down,
    // because in the spreadsheet era it was not done. Inventing a number here
    // would be self-report.
    expect(createTouchScanWorkflow(scanOptions()).baseline).toBeUndefined();
  });

  it("lets one provider fail without costing the other's evidence", async () => {
    const repository = new MemoryTouchRepository();
    const failing: TouchProvider = {
      name: "calendar",
      fetch: async () => {
        throw new Error("connect ETIMEDOUT");
      },
    };
    const working = provider([email("m1", ["ada.sparrow@example.com"])]);
    const workflow = createTouchScanWorkflow({
      ...scanOptions(),
      providers: [failing, working],
      repository,
    });
    const exceptions: Array<{ kind: string; message: string }> = [];
    const batch = (await workflow.steps[0]!.run({
      measure: () => {},
      recordException: async (exception: { kind: string; message: string }) => {
        exceptions.push(exception);
      },
      outputs: new Map(),
    } as never)) as TouchScanBatch;

    // The email evidence survived the calendar outage.
    expect(batch.providersFailed).toBe(1);
    expect(batch.providersRead).toBe(1);
    expect(batch.touches).toHaveLength(1);
    // Both attempts are on the record, and the failure names no provider prose.
    expect(repository.scans.map((scan) => scan.status).sort()).toEqual([
      "completed",
      "failed",
    ]);
    expect(exceptions[0]?.kind).toBe("TouchScanFailed");
    expect(exceptions[0]?.message).toBe("calendar: Error");
  });

  it("counts the leads it cannot monitor rather than passing over them", async () => {
    const workflow = createTouchScanWorkflow({
      ...scanOptions(),
      providers: [],
    });
    const batch = (await workflow.steps[0]!.run({
      measure: () => {},
      recordException: async () => {},
      outputs: new Map(),
    } as never)) as TouchScanBatch;
    // U004 is disputed and U005 and U007 have nothing usable. A lead that
    // cannot be matched on is not a lead with nothing happening.
    expect(batch.unmonitorableLeads).toBeGreaterThanOrEqual(3);
  });
});

describe("7.5b: the database side", () => {
  it("keys a touch write on the row, so a second scan is not a second copy", async () => {
    const source = await readRepository();
    expect(source).toMatch(/crmTouch\.upsert/);
    expect(source).toMatch(/crmTouchUnmatched\.upsert/);
    expect(source).toMatch(/identity_basis_sourceRef/);
  });

  it("cannot rewrite who asserted a touch when it re-reads a message", async () => {
    const source = await readRepository();
    const update = source.slice(
      source.indexOf("async upsertTouch"),
      source.indexOf("async recordUnmatched"),
    );
    // A calendar event moving from booked to happened is the one legitimate
    // change. Everything else about a touch is fixed by the message itself.
    expect(update).toMatch(
      /update: \{ state: touch\.state, occurredAt: touch\.occurredAt \}/,
    );
    for (const field of ["assertedBy", "basis", "subjectRef", "direction"]) {
      expect(update.slice(update.indexOf("update:"))).not.toContain(field);
    }
  });

  it("writes every scan attempt as its own row", async () => {
    const source = await readRepository();
    const record = source.slice(source.indexOf("async recordScan"));
    // A create, never an upsert. Collapsing two attempts into one row is how a
    // failed scan stops being visible.
    expect(record).toMatch(/crmTouchScan\.create/);
    expect(record).not.toMatch(/crmTouchScan\.upsert/);
  });
});

describe("7.5b: the job reads and never sends", () => {
  it("gives the provider interface no way to send", async () => {
    const source = await readFile(
      new URL("../lib/crm/touches.ts", import.meta.url),
      "utf8",
    );
    const contract = source.slice(
      source.indexOf("export interface TouchProvider"),
      source.indexOf("export function subjectReference"),
    );
    // G1 by shape rather than by rule: there is no method to call.
    for (const forbidden of ["send", "reply", "post", "write", "compose"]) {
      expect(contract.toLowerCase()).not.toContain(`${forbidden}(`);
    }
    expect(contract).toContain("fetch(");
  });

  it("calls nothing on a provider except fetch", async () => {
    const calls: string[] = [];
    const watched = new Proxy(
      { name: "email" as const, fetch: async () => [] },
      {
        get(target, property) {
          if (typeof property === "string") calls.push(property);
          return Reflect.get(target, property);
        },
      },
    ) as TouchProvider;
    await runTouchScan(
      watched,
      index(),
      new MemoryTouchRepository(),
      { since: NOW, until: NOW },
      NOW,
    );
    expect([...new Set(calls)].sort()).toEqual(["fetch", "name"]);
  });

  it("keeps the touch tables under row level security", async () => {
    const sql = await readMigration();
    for (const table of [
      "crm_touches",
      "crm_touch_unmatched",
      "crm_touch_scans",
    ]) {
      expect(sql).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`,
      );
    }
  });

  it("constrains the vocabularies and the scan totals in the database", async () => {
    const sql = await readMigration();
    expect(sql).toMatch(
      /CHECK \(basis IN \('email', 'calendar', 'asserted'\)\)/,
    );
    expect(sql).toMatch(/CHECK \(kind IN \('email', 'meeting'\)\)/);
    expect(sql).toMatch(/CHECK \(state IN \('occurred', 'scheduled'\)\)/);
    // Only a calendar can know about contact that has not happened yet.
    expect(sql).toMatch(/state <> 'scheduled' OR basis = 'calendar'/);
    // A row can always say whether a human or a mailbox produced it.
    expect(sql).toMatch(
      /basis = 'asserted' AND btrim\(coalesce\(asserted_by, ''\)\) <> ''/,
    );
    expect(sql).toMatch(
      /balanced = \(matched \+ unmatched \+ ambiguous \+ unaddressed = candidates_read\)/,
    );
  });

  it("makes a duplicate touch impossible at the database level", async () => {
    const sql = await readMigration();
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "crm_touches_identity_basis_source_ref_key"/,
    );
  });
});

function scanOptions() {
  return {
    providers: [] as TouchProvider[],
    repository: new MemoryTouchRepository(),
    leads: leadViews(),
    window: { since: new Date("2026-08-01T00:00:00.000Z"), until: NOW },
    now: NOW,
  };
}

async function readRepository(): Promise<string> {
  return readFile(
    new URL("../lib/crm/prisma-touch-repository.ts", import.meta.url),
    "utf8",
  );
}

async function readMigration(): Promise<string> {
  return readFile(
    new URL(
      "../prisma/migrations/202608280001_phase_7_5b_touch_detection/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
}
