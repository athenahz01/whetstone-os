import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  backfillMeetings,
  backfillRowMeetings,
  meetingSourceRef,
  MEETING_SLOTS,
  parseMeetingDate,
  summariseBackfill,
  type MeetingBackfillResult,
} from "../lib/crm/meeting-backfill";
import { assertedTouch, touchKey } from "../lib/crm/touches";
import { meetingMilestones } from "../lib/crm/touches";
import type { CrmSourceRow } from "../lib/crm/merge";

/**
 * Names here are invented. The real records are minors.
 *
 * Closer initials and the client roles are not: `R`, `C` and `Jayden` are
 * Whetstone staff, and `P` / `S` are the roles parent and student. Neither
 * identifies a learner, which is why they are the only cell contents this
 * conversion carries.
 */

const LEAD = { identity: "ug_sales::U001::ada sparrow", leadRef: "U001" };

function row(cells: Record<string, string | undefined>): CrmSourceRow {
  return {
    source: "dashboard_rebuilt",
    tab: "ug_sales",
    rowNumber: 2,
    cells: { ID: "U001", "S First": "Ada", "S Last": "Sparrow", ...cells },
  };
}

const convert = (cells: Record<string, string | undefined>) =>
  backfillRowMeetings(row(cells), LEAD);

describe("7.5a backfill: a typed meeting becomes an asserted touch", () => {
  it("converts a dated, signed meeting", () => {
    const result = convert({
      "M1 Date": "2026-02-11",
      "M1 Med": "Video",
      "M1 Client": "P, S",
      "M1 Closer": "R",
    });
    expect(result.touches).toHaveLength(1);
    const touch = result.touches[0]!;
    // `asserted` is the basis that already means a human says this happened
    // and no mailbox can corroborate it. Calling it `calendar` would be the
    // evidence line claiming a search nothing performed.
    expect(touch.basis).toBe("asserted");
    expect(touch.kind).toBe("meeting");
    expect(touch.state).toBe("occurred");
    expect(touch.assertedBy).toBe("R");
    expect(touch.occurredAt.toISOString()).toContain("2026-02-11");
    expect(touch.leadRef).toBe("U001");
    expect(result.unconverted).toHaveLength(0);
  });

  it("converts all three slots independently", () => {
    const result = convert({
      "M1 Date": "2026-01-05",
      "M1 Closer": "R",
      "M2 Date": "2026-02-11",
      "M2 Closer": "C",
      "M3 Date": "2026-03-02",
      "M3 Closer": "Jayden",
    });
    expect(result.touches).toHaveLength(3);
    expect(result.touches.map((touch) => touch.assertedBy)).toEqual([
      "R",
      "C",
      "Jayden",
    ]);
    expect(result.emptySlots).toBe(0);
  });

  it("keys each slot separately, so two meetings on one day are two touches", () => {
    const result = convert({
      "M1 Date": "2026-02-11",
      "M1 Closer": "R",
      "M2 Date": "2026-02-11",
      "M2 Closer": "C",
    });
    // `assertedTouch` keys on the day, which would have collapsed these into
    // one row. A second conversation is a second conversation.
    expect(new Set(result.touches.map(touchKey)).size).toBe(2);
    expect(result.touches.map((touch) => touch.sourceRef)).toEqual([
      "sheet-meeting:M1",
      "sheet-meeting:M2",
    ]);
  });

  it("cannot collide with a human answering already spoke to them", () => {
    const sameDay = assertedTouch({
      ...LEAD,
      assertedBy: "ren",
      occurredAt: new Date("2026-02-11T00:00:00.000Z"),
    });
    const backfilled = convert({
      "M1 Date": "2026-02-11",
      "M1 Closer": "R",
    }).touches[0]!;
    // Both are `asserted` on the same day for the same lead. A shared key would
    // let a sheet import overwrite something a person said this morning.
    expect(backfilled.sourceRef).not.toBe(sameDay.sourceRef);
    expect(touchKey(backfilled)).not.toBe(touchKey(sameDay));
  });

  it("writes the same rows when the sheet is imported again", () => {
    const first = convert({ "M1 Date": "2026-02-11", "M1 Closer": "R" });
    const second = convert({ "M1 Date": "2026-02-11", "M1 Closer": "R" });
    expect(first.touches.map(touchKey)).toEqual(second.touches.map(touchKey));
  });

  it("feeds the milestone view the sheet's own columns used to hold", () => {
    const result = convert({
      "M1 Date": "2026-01-05",
      "M1 Closer": "R",
      "M2 Date": "2026-02-11",
      "M2 Closer": "C",
    });
    const milestones = meetingMilestones(result.touches);
    // 1M and 2M come back as a view over `crm_touches`, which is where 7.5b
    // put them. Nobody types them again.
    expect(milestones.first?.toISOString()).toContain("2026-01-05");
    expect(milestones.second?.toISOString()).toContain("2026-02-11");
    expect(milestones.third).toBeUndefined();
  });
});

describe("7.5a backfill: no date is ever invented", () => {
  it("carries a medium with no date out unconverted, with its reason", () => {
    // The 26. The sheet knows a conversation happened, who was on it and who
    // closed, and not when.
    const result = convert({
      "M1 Med": "Phone",
      "M1 Client": "P",
      "M1 Closer": "R",
    });
    expect(result.touches).toHaveLength(0);
    expect(result.unconverted).toHaveLength(1);
    const skipped = result.unconverted[0]!;
    expect(skipped.reason).toBe("no-date");
    expect(skipped.medium).toBe("Phone");
    expect(skipped.closer).toBe("R");
    expect(skipped.slot).toBe("M1");
  });

  it("does not fall back to the lead date, or to today", () => {
    const result = convert({
      "M1 Med": "Phone",
      "M1 Closer": "R",
      "Lead Date": "2026-01-05",
    });
    // Both are defensible rules and neither is chosen here. A date the sheet
    // does not hold is a decision, and the decision is not the importer's.
    expect(JSON.stringify(result.touches)).not.toContain("2026-01-05");
    expect(result.touches).toHaveLength(0);
  });

  it("surfaces a date the sheet holds that is not a date", () => {
    const result = convert({
      "M1 Date": "sometime in spring",
      "M1 Med": "Video",
      "M1 Closer": "R",
    });
    expect(result.unconverted[0]?.reason).toBe("unparsable-date");
    // Kept verbatim, so whoever fixes the sheet can see what was in the cell.
    expect(result.unconverted[0]?.dateRaw).toBe("sometime in spring");
  });

  it("refuses to assert a dated meeting nobody signed", () => {
    const result = convert({ "M1 Date": "2026-02-11", "M1 Med": "HC" });
    // The database refuses a blank `asserted_by`, and inventing one would put
    // a claim in somebody's mouth.
    expect(result.unconverted[0]?.reason).toBe("no-closer");
    expect(result.touches).toHaveLength(0);
  });

  it("keeps an unrecognised medium rather than snapping it to a member", () => {
    const result = convert({ "M1 Med": "Carrier pigeon", "M1 Closer": "R" });
    expect(result.unconverted[0]?.medium).toBeNull();
    expect(result.unconverted[0]?.mediumRaw).toBe("Carrier pigeon");
    expect(result.unconverted[0]?.mediumUnmapped).toBe(true);
  });

  it("reads the four media the sheet actually uses", () => {
    for (const medium of ["Video", "Phone", "HC", "Meet"]) {
      const result = convert({ "M1 Med": medium, "M1 Closer": "R" });
      expect(result.unconverted[0]?.medium).toBe(medium);
      expect(result.unconverted[0]?.mediumUnmapped).toBe(false);
    }
  });
});

describe("7.5a backfill: every slot is accounted for", () => {
  it("counts an untouched slot as empty rather than losing it", () => {
    const result = convert({ "M1 Date": "2026-02-11", "M1 Closer": "R" });
    expect(result.emptySlots).toBe(2);
    expect(result.slotsRead).toBe(3);
    expect(result.balanced).toBe(true);
  });

  it("balances across a whole sheet", () => {
    const result = backfillMeetings([
      { row: row({ "M1 Date": "2026-02-11", "M1 Closer": "R" }), lead: LEAD },
      { row: row({ "M1 Med": "Phone", "M1 Closer": "C" }), lead: LEAD },
      { row: row({}), lead: LEAD },
    ]);
    expect(result.slotsRead).toBe(9);
    expect(result.touches).toHaveLength(1);
    expect(result.unconverted).toHaveLength(1);
    expect(result.emptySlots).toBe(7);
    expect(
      result.touches.length + result.unconverted.length + result.emptySlots,
    ).toBe(result.slotsRead);
    expect(result.balanced).toBe(true);
  });

  it("reproduces the shape the live sheet has", () => {
    // The UG tab holds 34 first meetings with a medium and 8 with a date, so
    // 26 carry evidence of a conversation and no day. That ratio is the whole
    // reason a ruling is needed.
    const rows = [
      ...Array.from({ length: 8 }, (_, index) => ({
        row: row({
          "M1 Date": `2026-02-${String(index + 1).padStart(2, "0")}`,
          "M1 Med": "Video",
          "M1 Closer": "R",
        }),
        lead: LEAD,
      })),
      ...Array.from({ length: 26 }, () => ({
        row: row({ "M1 Med": "Phone", "M1 Closer": "R" }),
        lead: LEAD,
      })),
    ];
    const result = backfillMeetings(rows);
    expect(result.touches).toHaveLength(8);
    expect(
      result.unconverted.filter((item) => item.reason === "no-date"),
    ).toHaveLength(26);
    expect(result.balanced).toBe(true);
  });

  it("summarises in counts a log can carry", () => {
    const line = summariseBackfill(
      backfillMeetings([
        { row: row({ "M1 Date": "2026-02-11", "M1 Closer": "R" }), lead: LEAD },
        { row: row({ "M1 Med": "Phone", "M1 Closer": "R" }), lead: LEAD },
      ]),
    );
    expect(line).toContain("converted=1");
    expect(line).toContain("no-date=1");
    expect(line).toContain("balanced=true");
    // Counts and vocabulary terms. Nothing a person wrote.
    expect(line).not.toMatch(/Ada|Sparrow|U001/);
  });
});

describe("7.5a backfill: the notes column is never read", () => {
  it("carries no note into a touch", () => {
    const result = convert({
      "M1 Date": "2026-02-11",
      "M1 Closer": "R",
      "M1 Notes": "Ada is anxious about her mother losing the job",
    });
    const stored = JSON.stringify(result.touches);
    expect(stored).not.toMatch(/anxious|mother|losing/i);
    expect(result.touches[0]?.subjectRef).toBeNull();
  });

  it("carries no note into an unconverted row either", () => {
    const result = convert({
      "M1 Med": "Phone",
      "M1 Closer": "R",
      "M1 Notes": "Ada is anxious about her mother losing the job",
    });
    expect(JSON.stringify(result.unconverted)).not.toMatch(
      /anxious|mother|losing/i,
    );
  });

  it("never reads a notes column at all", async () => {
    const source = await readFile(
      new URL("../lib/crm/meeting-backfill.ts", import.meta.url),
      "utf8",
    );
    // `crm_touches` has nowhere to put prose by design, and the surest version
    // of that rule is code that never picks the cell up.
    expect(source).not.toMatch(/cell\(row, `\$\{slot\} Notes`\)/);
    expect(source).not.toMatch(/"M1 Notes"|Notes`\)/);
  });

  it("satisfies the asserted-touch constraints the database enforces", async () => {
    const sql = await readFile(
      new URL(
        "../prisma/migrations/202608280001_phase_7_5b_touch_detection/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toMatch(
      /basis = 'asserted' AND btrim\(coalesce\(asserted_by, ''\)\) <> ''/,
    );
    const result = convert({ "M1 Date": "2026-02-11", "M1 Closer": "R" });
    const touch = result.touches[0]!;
    // Every asserted row the database will accept: a named human, no subject,
    // and a source reference that is not blank.
    expect(touch.assertedBy?.trim()).toBeTruthy();
    expect(touch.subjectRef).toBeNull();
    expect(touch.sourceRef.trim()).toBeTruthy();
    expect(touch.state).not.toBe("scheduled");
  });
});

describe("7.5a backfill: the parts that are decisions stay decisions", () => {
  it("has a written proposal and picks none of its options", async () => {
    const doc = await readFile(
      new URL("../docs/MEETING-BACKFILL-RULING.md", import.meta.url),
      "utf8",
    );
    // Four options with their costs, a recommendation marked as one, and no
    // implementation. The code above reflects the only thing that needs no
    // ruling: not inventing a date.
    // Four options, each as its own section with what it costs and what it
    // buys. Asserting the bare string matched the recommendation paragraph too,
    // so a deleted option went unnoticed.
    for (const option of ["A", "B", "C", "D"]) {
      expect(doc, `Option ${option} must have its own section`).toMatch(
        new RegExp(`^## Option ${option} - `, "m"),
      );
    }
    expect(doc.match(/^- \*\*Costs:\*\*/gm) ?? []).toHaveLength(4);
    expect(doc.match(/^- \*\*Buys:\*\*/gm) ?? []).toHaveLength(4);
    expect(doc).toMatch(/Recommendation/i);
    expect(doc).toMatch(/Status: open/);
    expect(doc).toMatch(/Nothing here is implemented/i);
    expect(doc).toMatch(/recommendation, not a decision/i);
  });

  it("leaves the 26 out of the touch record until somebody rules", () => {
    const undated = convert({ "M1 Med": "Phone", "M1 Closer": "R" });
    expect(undated.touches).toHaveLength(0);
    // Visible and counted, which is the same shape as `disputed`: carried,
    // never resolved by a rule nobody chose.
    expect(undated.unconverted[0]?.reason).toBe("no-date");
  });

  it("exposes the slot list rather than hard-coding three", () => {
    expect(MEETING_SLOTS).toEqual(["M1", "M2", "M3"]);
    expect(meetingSourceRef("M2")).toBe("sheet-meeting:M2");
  });

  it("parses a date or says it could not", () => {
    expect(parseMeetingDate("2026-02-11")?.toISOString()).toContain(
      "2026-02-11",
    );
    expect(parseMeetingDate("")).toBeUndefined();
    expect(parseMeetingDate("not a date")).toBeUndefined();
  });
});

describe("7.5a backfill: no real student names in the fixture", () => {
  it("carries none of the brief's names", async () => {
    const [brief, source] = await Promise.all([
      readFile(new URL("../docs/PHASE-7.5-CRM.md", import.meta.url), "utf8"),
      readFile(
        new URL("./phase-7-5a-meeting-backfill.test.ts", import.meta.url),
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
  });
});

export type { MeetingBackfillResult };
