import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { toLeadView, type CrmLeadView } from "../lib/crm/actionable";
import { runSilenceClock, type SilenceClockResult } from "../lib/crm/clock";
import { buildContactIndex } from "../lib/crm/contacts";
import {
  buildDailyDigest,
  digestCode,
  digestLogLine,
  renderDigestBody,
  renderDigestSubject,
  MAX_DIGEST_ITEMS,
} from "../lib/crm/digest";
import {
  applyDigestReply,
  parseDigestReply,
  UnattributedReplyError,
  type DigestActionRepository,
  type LeadActionRecord,
  type SnoozeRecord,
} from "../lib/crm/digest-actions";
import { mergeCrmSources, type CrmSourceRow } from "../lib/crm/merge";
import { DEFAULT_SILENCE_THRESHOLDS } from "../lib/crm/thresholds";
import type { ScanCoverage, TouchRecord } from "../lib/crm/touches";
import { assertRegistrable } from "../lib/core/registry";
import {
  createDailyMessageWorkflow,
  type DailyMessageBatch,
} from "../lib/workflows/s6-daily-message";

/**
 * Names here are invented, on the reserved documentation domain.
 *
 * This phase is the one that renders a student's name, so the fixture has to
 * contain names to prove where they may and may not appear. They are made up
 * for the same reason as everywhere else: the real records are minors.
 */

const NOW = new Date("2026-08-28T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const FULL_COVERAGE: ScanCoverage = { read: ["calendar", "email"], failed: [] };

let rowCounter = 0;
function dashboard(cells: Record<string, string | undefined>): CrmSourceRow {
  rowCounter += 1;
  return {
    source: "dashboard",
    tab: "ug_sales",
    rowNumber: rowCounter,
    cells,
  };
}

/** Seven live leads, so five are shown and two are held back. */
function fixture(): CrmSourceRow[] {
  rowCounter = 0;
  const live: Array<[string, string, string, string, string]> = [
    ["U001", "Ada", "Sparrow", "Negotiate", "2026-01-05"],
    ["U002", "Bea", "Marlow", "Active", "2026-01-06"],
    ["U003", "Cy", "Okafor", "Engage", "2026-01-07"],
    ["U004", "Dev", "Ramanathan", "Prospect", "2026-01-08"],
    ["U005", "Ell", "Trevino", "Cold", "2025-06-01"],
    ["U006", "Fay", "Bright", "Active", "2026-02-02"],
    ["U007", "Gus", "Iyer", "Cold", "2025-07-01"],
  ];
  return live.map(([id, first, last, status, leadDate]) =>
    dashboard({
      ID: id,
      "S First": first,
      "S Last": last,
      Status: status,
      "Lead Date": leadDate,
      "S Email": `${first}.${last}@example.com`.toLowerCase(),
    }),
  );
}

function leadViews(rows: CrmSourceRow[] = fixture()): CrmLeadView[] {
  return mergeCrmSources(rows, []).leads.map((lead) => toLeadView(lead));
}

function clock(
  overrides: Partial<Parameters<typeof runSilenceClock>[0]> = {},
): SilenceClockResult {
  const leads = overrides.leads ?? leadViews();
  return runSilenceClock({
    leads,
    index: buildContactIndex(leads),
    touchesByIdentity: new Map(),
    thresholds: DEFAULT_SILENCE_THRESHOLDS,
    now: NOW,
    coverage: FULL_COVERAGE,
    ...overrides,
  });
}

function digestOf(overrides: Parameters<typeof clock>[0] = {}) {
  const leads = overrides.leads ?? leadViews();
  return buildDailyDigest({ result: clock({ ...overrides, leads }), leads });
}

function identityFor(leadRef: string): string {
  const lead = leadViews().find((candidate) => candidate.leadRef === leadRef);
  if (!lead) throw new Error(`no lead ${leadRef}`);
  return lead.identity;
}

class MemoryDigestRepository implements DigestActionRepository {
  readonly actions: LeadActionRecord[] = [];
  readonly snoozes: SnoozeRecord[] = [];
  readonly lost: string[] = [];
  readonly touches: TouchRecord[] = [];

  async recordAction(action: LeadActionRecord) {
    // Mirrors the unique index: one reply per lead per action per message.
    if (
      this.actions.some(
        (held) =>
          held.identity === action.identity &&
          held.action === action.action &&
          held.digestDate.getTime() === action.digestDate.getTime(),
      )
    ) {
      return;
    }
    this.actions.push(action);
  }
  async recordSnooze(snooze: SnoozeRecord) {
    this.snoozes.push(snooze);
  }
  async markLost(input: { identity: string }) {
    this.lost.push(input.identity);
  }
  async upsertTouch(touch: TouchRecord) {
    this.touches.push(touch);
  }
}

describe("7.5d: at most five, worst first, and never reading as complete", () => {
  it("shows five and says how many were held back", () => {
    const digest = digestOf();
    expect(digest.totalStalls).toBe(7);
    expect(digest.items).toHaveLength(MAX_DIGEST_ITEMS);
    expect(digest.heldBack).toBe(2);
    expect(renderDigestBody(digest)).toContain("2 more overdue and not shown.");
  });

  it("says so even when nothing was held back", () => {
    const digest = digestOf({ leads: leadViews().slice(0, 3) });
    expect(digest.heldBack).toBe(0);
    // Printed unconditionally. A line that only appears when something was cut
    // means its absence has to be interpreted, and a truncated list that reads
    // as complete is named in the criteria as failing the phase.
    expect(renderDigestBody(digest)).toContain(
      "Nothing else is overdue and unshown.",
    );
  });

  it("puts the held-back count in the subject, which is the phone preview", () => {
    expect(renderDigestSubject(digestOf())).toBe(
      "Daily check-in: 7 overdue, 2 held back",
    );
  });

  it("accounts for every stall as shown or held back", () => {
    const digest = digestOf();
    expect(digest.items.length + digest.heldBack).toBe(digest.totalStalls);
  });

  it("carries each lead's stage, quiet count and evidence, not just a number", () => {
    const body = renderDigestBody(digestOf());
    expect(body).toMatch(/quiet \d+ days against a \d+ day threshold/);
    expect(body).toMatch(/searched calendar and email/);
    expect(body).toMatch(/blind to .*phone/i);
    expect(body).toContain("no touch on record, measured from the lead date");
  });

  it("ranks the message the way the clock ranked it", () => {
    const result = clock();
    const digest = buildDailyDigest({ result, leads: leadViews() });
    expect(digest.items.map((item) => item.leadRef)).toEqual(
      result.stalls.slice(0, MAX_DIGEST_ITEMS).map((entry) => entry.leadRef),
    );
    // The stages that tolerate silence are the ones held back, which is what a
    // per-stage threshold means.
    expect(digest.items.map((item) => item.stage)).not.toContain("Cold");
  });
});

describe("7.5d: silence is never ambiguous", () => {
  it("sends a message when there is nothing to do, and says so", () => {
    const quiet = clock({ leads: [] });
    const digest = buildDailyDigest({ result: quiet, leads: [] });
    expect(digest.status).toBe("clear");
    expect(renderDigestSubject(digest)).toBe("Daily check-in: nothing overdue");
    expect(renderDigestBody(digest)).toContain("Nothing is overdue today.");
    // It states what it searched, so "clear" is a finding and not an absence.
    expect(renderDigestBody(digest)).toContain("Searched calendar and email.");
  });

  it("refuses to call a run clear when it read no mailbox", () => {
    const degraded = clock({
      leads: [],
      coverage: { read: [], failed: ["calendar", "email"] },
    });
    const digest = buildDailyDigest({ result: degraded, leads: [] });
    // Nothing overdue and nothing searched is not a quiet day, it is a broken
    // one, and reporting it as clear would be the message asserting a fact
    // nothing established.
    expect(digest.status).toBe("degraded");
    expect(renderDigestSubject(digest)).toMatch(/read no mailbox/);
    expect(renderDigestBody(digest)).toContain(
      "Treat this as a broken run, not a quiet one.",
    );
  });

  it("names the leads it cannot measure, separately from the stalls", () => {
    const rows = [
      ...fixture(),
      dashboard({
        ID: "U008",
        "S First": "Hal",
        "S Last": "Nakamura",
        Status: "Active",
        "Lead Date": "2026-01-09",
      }),
    ];
    const leads = leadViews(rows);
    const digest = buildDailyDigest({ result: clock({ leads }), leads });
    expect(digest.attention.unmonitorable).toBe(1);
    const body = renderDigestBody(digest);
    expect(body).toContain("1 with nothing to match on");
    // Never folded into the stall list, and never read as healthy.
    expect(body).toContain(
      "These are not healthy and they are not in the list",
    );
    expect(digest.items.map((item) => item.leadRef)).not.toContain("U008");
  });
});

describe("7.5d: a student's name reaches the recipient and nowhere else", () => {
  it("puts the name in the body, where Ren reads it", () => {
    const body = renderDigestBody(digestOf());
    expect(body).toMatch(/Ada Sparrow \(U001\)/);
  });

  it("keeps every name out of the subject line", () => {
    const digest = digestOf();
    const subject = renderDigestSubject(digest);
    // The subject is the lock screen preview, read by whoever is holding the
    // phone and anyone standing next to them.
    for (const item of digest.items) {
      expect(subject).not.toContain(item.studentName);
      for (const part of item.studentName.split(" ")) {
        expect(subject).not.toContain(part);
      }
    }
  });

  it("keeps every name out of the log line", () => {
    const digest = digestOf();
    const line = digestLogLine(digest);
    for (const item of digest.items) {
      for (const part of item.studentName.split(" ")) {
        expect(line).not.toContain(part);
      }
      // References are fine and are what makes the line useful.
      expect(line).toContain(item.leadRef);
    }
  });

  it("keeps every name out of what a reply writes", async () => {
    const digest = digestOf();
    const repository = new MemoryDigestRepository();
    await applyDigestReply(
      parseDigestReply("11 24 33 42", digest),
      repository,
      { actor: "ren", now: NOW, digestDate: NOW },
    );
    const written = JSON.stringify({
      actions: repository.actions,
      snoozes: repository.snoozes,
      touches: repository.touches,
    });
    for (const item of digest.items) {
      for (const part of item.studentName.split(" ")) {
        expect(written).not.toContain(part);
      }
    }
  });

  it("gives the tables no column a name could land in", async () => {
    const sql = await readMigration();
    for (const forbidden of [
      '"student_name"',
      '"name"',
      '"note"',
      '"notes"',
      '"comment"',
      '"body"',
      '"subject"',
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });
});

describe("7.5d: the reply is a number, and the number is the CRM write", () => {
  it("gives every lead and action a code that means one thing", () => {
    const digest = digestOf();
    const codes = digest.items.flatMap((item) => Object.values(item.codes));
    expect(new Set(codes).size).toBe(codes.length);
    expect(digest.items[0]?.codes.draft).toBe("11");
    expect(digest.items[1]?.codes.spoke).toBe("24");
    expect(digestCode(3, "lost")).toBe("33");
  });

  it("prints what each number does next to the lead it belongs to", () => {
    const body = renderDigestBody(digestOf());
    expect(body).toContain(
      "reply 11 draft a follow-up, 12 snooze a week, 13 mark lost, 14 already spoke to them",
    );
  });

  it("reads several codes out of one reply, in any shape", () => {
    const digest = digestOf();
    const parsed = parseDigestReply("14, 22 and 33", digest);
    expect(parsed.commands.map((command) => command.code)).toEqual([
      "14",
      "22",
      "33",
    ]);
    expect(parsed.commands[0]?.action).toBe("spoke");
    expect(parsed.commands[1]?.action).toBe("snooze");
    expect(parsed.commands[2]?.action).toBe("lost");
  });

  it("reads a repeated code once", () => {
    const parsed = parseDigestReply("12 12 12", digestOf());
    // A person on a phone taps twice, and a reply repeated three times is one
    // decision, not a snooze extended threefold.
    expect(parsed.commands).toHaveLength(1);
    expect(parsed.unrecognised).toEqual([]);
  });

  it("reports a code that addresses nothing rather than ignoring it", () => {
    const parsed = parseDigestReply("11 99 61", digestOf());
    // A reply half understood and silently half applied is worse than one
    // refused: the sender believes all of it landed.
    expect(parsed.commands.map((c) => c.code)).toEqual(["11"]);
    expect(parsed.unrecognised).toEqual(["99", "61"]);
  });

  it("refuses to choose when one lead is answered twice", async () => {
    const digest = digestOf();
    const parsed = parseDigestReply("13 14", digest);
    expect(parsed.conflicts).toEqual([
      { leadRef: "U001", actions: ["lost", "spoke"] },
    ]);
    const repository = new MemoryDigestRepository();
    const applied = await applyDigestReply(parsed, repository, {
      actor: "ren",
      now: NOW,
      digestDate: NOW,
    });
    // Mark lost and already spoke to them are not reconcilable, and picking one
    // is a decision on somebody's behalf.
    expect(applied.applied).toHaveLength(0);
    expect(applied.refused.map((item) => item.reason)).toEqual([
      "conflicting_actions",
      "conflicting_actions",
    ]);
    expect(repository.actions).toHaveLength(0);
  });

  it("attributes every write with who and when", async () => {
    const digest = digestOf();
    const repository = new MemoryDigestRepository();
    await applyDigestReply(parseDigestReply("12", digest), repository, {
      actor: "ren",
      now: NOW,
      digestDate: NOW,
    });
    expect(repository.actions).toEqual([
      {
        identity: identityFor("U001"),
        leadRef: "U001",
        action: "snooze",
        actor: "ren",
        actedAt: NOW,
        digestDate: NOW,
      },
    ]);
  });

  it("refuses a reply that names nobody", async () => {
    await expect(
      applyDigestReply(
        parseDigestReply("11", digestOf()),
        new MemoryDigestRepository(),
        { actor: "  ", now: NOW, digestDate: NOW },
      ),
    ).rejects.toThrow(UnattributedReplyError);
  });

  it("writes one row when the same message is answered twice", async () => {
    const digest = digestOf();
    const repository = new MemoryDigestRepository();
    const reply = () =>
      applyDigestReply(parseDigestReply("12", digest), repository, {
        actor: "ren",
        now: NOW,
        digestDate: NOW,
      });
    await reply();
    await reply();
    // A person on a phone taps twice.
    expect(repository.actions).toHaveLength(1);
  });
});

describe("7.5d: already spoke to them is a real row, not a hidden one", () => {
  it("writes a touch dated today with basis asserted", async () => {
    const digest = digestOf();
    const repository = new MemoryDigestRepository();
    const applied = await applyDigestReply(
      parseDigestReply("14", digest),
      repository,
      { actor: "ren", now: NOW, digestDate: NOW },
    );
    expect(repository.touches).toHaveLength(1);
    const touch = repository.touches[0]!;
    expect(touch.basis).toBe("asserted");
    expect(touch.assertedBy).toBe("ren");
    expect(touch.occurredAt).toEqual(NOW);
    expect(touch.leadRef).toBe("U001");
    expect(applied.touches).toEqual(repository.touches);
  });

  it("resets the clock, because the touch is real", () => {
    const before = clock();
    expect(before.stalls.map((entry) => entry.leadRef)).toContain("U001");

    const touch = {
      identity: identityFor("U001"),
      leadRef: "U001",
      basis: "asserted" as const,
      kind: "meeting" as const,
      direction: "outbound" as const,
      state: "occurred" as const,
      occurredAt: NOW,
      sourceRef: "asserted:U001:2026-08-28",
      subjectRef: null,
      matchedField: null,
      assertedBy: "ren",
    };
    const after = clock({
      touchesByIdentity: new Map([[identityFor("U001"), [touch]]]),
    });
    // Not a suppression flag. The lead leaves the list because contact was
    // recorded, exactly as it would for an email nobody had to type.
    expect(after.stalls.map((entry) => entry.leadRef)).not.toContain("U001");
    const entry = after.entries.find((item) => item.leadRef === "U001");
    expect(entry?.outcome).toBe("within-threshold");
    expect(entry?.lastTouch?.basis).toBe("asserted");
  });
});

describe("7.5d: snooze returns the lead, it does not lose it", () => {
  it("suppresses for exactly the window", async () => {
    const digest = digestOf();
    const repository = new MemoryDigestRepository();
    await applyDigestReply(parseDigestReply("12", digest), repository, {
      actor: "ren",
      now: NOW,
      digestDate: NOW,
    });
    const snooze = repository.snoozes[0]!;
    expect(snooze.until).toEqual(new Date(NOW.getTime() + 7 * DAY));

    const held = new Map([[identityFor("U001"), snooze.until]]);
    const duringWindow = clock({ snoozedUntil: held });
    const entry = duringWindow.entries.find((item) => item.leadRef === "U001");
    expect(entry?.outcome).toBe("snoozed");
    expect(entry?.snoozedUntil).toEqual(snooze.until);
    expect(duringWindow.stalls.map((item) => item.leadRef)).not.toContain(
      "U001",
    );
  });

  it("returns the lead the moment the window lapses", () => {
    const until = new Date(NOW.getTime() + 7 * DAY);
    const held = new Map([[identityFor("U001"), until]]);
    const after = runSilenceClock({
      leads: leadViews(),
      index: buildContactIndex(leadViews()),
      touchesByIdentity: new Map(),
      thresholds: DEFAULT_SILENCE_THRESHOLDS,
      now: new Date(until.getTime() + 1),
      coverage: FULL_COVERAGE,
      snoozedUntil: held,
    });
    // It comes back on its own. Nobody has to remember to bring it back, which
    // is the difference between deferring a decision and losing one.
    expect(after.stalls.map((item) => item.leadRef)).toContain("U001");
  });

  it("counts a snoozed lead in the message rather than dropping it", () => {
    const until = new Date(NOW.getTime() + 7 * DAY);
    const leads = leadViews();
    const result = clock({
      leads,
      snoozedUntil: new Map([[identityFor("U001"), until]]),
    });
    const digest = buildDailyDigest({ result, leads });
    expect(digest.snoozed).toBe(1);
    expect(renderDigestBody(digest)).toContain("1 snoozed and due back later.");
  });

  it("cannot hide a lead for ever", async () => {
    const sql = await readMigration();
    // A snooze whose window never ends is a delete with better manners.
    expect(sql).toMatch(/CHECK \("until" > created_at\)/);
  });
});

describe("7.5d: mark lost writes the stage, and refuses a disputed one", () => {
  it("writes the stage change", async () => {
    const repository = new MemoryDigestRepository();
    await applyDigestReply(parseDigestReply("13", digestOf()), repository, {
      actor: "ren",
      now: NOW,
      digestDate: NOW,
    });
    expect(repository.lost).toEqual([identityFor("U001")]);
    expect(repository.actions[0]?.action).toBe("lost");
  });

  it("keys a reply write so a second tap is one row", async () => {
    const source = await readRepository();
    expect(source).toMatch(/crmLeadAction\.upsert/);
    expect(source).toMatch(/crmSnooze\.upsert/);
    expect(source).toMatch(/identity_action_digestDate/);
    expect(source).not.toMatch(/crmLeadAction\.create\(/);
  });

  it("lets the first answer stand when the same message is answered again", async () => {
    const source = await readRepository();
    const action = source.slice(
      source.indexOf("async recordAction"),
      source.indexOf("async recordSnooze"),
    );
    // An empty update branch. Restamping who decided and when is what would
    // make the audit row worthless.
    expect(action).toMatch(/update: \{\},/);
    expect(action.slice(action.indexOf("update:"))).not.toMatch(
      /actor|actedAt|digestDate/,
    );
  });

  it("re-reads the dispute at write time, not only at send time", async () => {
    const source = await readRepository();
    const markLost = source.slice(source.indexOf("async markLost"));
    // The read has to actually happen, not sit in a branch nothing enters.
    expect(markLost).toMatch(
      /const disputed = await transaction\.crmFieldDispute\.findUnique\(/,
    );
    // A reply can arrive long after the message was built, and the dispute may
    // have appeared in between.
    expect(markLost).toMatch(/\$transaction/);
    expect(markLost).toMatch(/resolvedAt === null/);
    expect(markLost).toMatch(/DisputedStageError/);
  });
});

describe("7.5d: a draft is a handoff, and the message carries none", () => {
  it("produces a request rather than writing anything", async () => {
    const repository = new MemoryDigestRepository();
    const applied = await applyDigestReply(
      parseDigestReply("11", digestOf()),
      repository,
      { actor: "ren", now: NOW, digestDate: NOW },
    );
    expect(applied.drafts).toEqual([
      {
        identity: identityFor("U001"),
        leadRef: "U001",
        requestedBy: "ren",
        requestedAt: NOW,
      },
    ]);
    // The handoff writes nothing to the lead record and sends nothing.
    expect(repository.touches).toHaveLength(0);
    expect(repository.lost).toHaveLength(0);
    expect(repository.snoozes).toHaveLength(0);
    // The attributed audit row is still written, so the request is traceable.
    expect(repository.actions[0]?.action).toBe("draft");
  });

  it("renders no draft text anywhere in the message", () => {
    const digest = digestOf();
    expect(Object.keys(digest)).not.toContain("drafts");
    const body = renderDigestBody(digest);
    // The standing binding is that no surface renders a drafts row until it has
    // passed voiceLint. This surface renders none at all, which is the version
    // of that rule with no way to get it wrong.
    expect(body).not.toMatch(/Hi |Hello |Best,|Thanks,/);
    expect(body).toContain("draft a follow-up");
  });

  it("keeps the send path out of the digest layer entirely", async () => {
    for (const file of ["digest.ts", "digest-actions.ts"]) {
      const source = await readFile(
        new URL(`../lib/crm/${file}`, import.meta.url),
        "utf8",
      );
      for (const forbidden of ["sendMail", "notifyDigest", "transport"]) {
        expect(source, `${file} names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe("7.5d: the message is a registered workflow", () => {
  class RecordingAlerts {
    readonly sent: Array<{ subject: string; body: string }> = [];
    enabled = true;
    isEnabled() {
      return this.enabled;
    }
    async notifyDigest(subject: string, body: string) {
      this.sent.push({ subject, body });
    }
  }

  function options(overrides: Partial<Parameters<typeof clock>[0]> = {}) {
    const leads = overrides.leads ?? leadViews();
    return {
      clock: clock({ ...overrides, leads }),
      leads,
      alerts: new RecordingAlerts(),
    };
  }

  async function runStep(
    workflow: ReturnType<typeof createDailyMessageWorkflow>,
  ) {
    return (await workflow.steps[0]!.run({
      measure: () => {},
      recordException: async () => {},
      outputs: new Map(),
    } as never)) as DailyMessageBatch;
  }

  it("registers, so KPI #1 can count it", () => {
    const workflow = createDailyMessageWorkflow(options());
    expect(() => assertRegistrable(workflow)).not.toThrow();
    expect(workflow.id).toBe("S6.daily-message");
  });

  it("sends one message, to the operator inbox and with no recipient argument", async () => {
    const alerts = new RecordingAlerts();
    const batch = await runStep(
      createDailyMessageWorkflow({ ...options(), alerts }),
    );
    expect(batch.sent).toBe(true);
    expect(alerts.sent).toHaveLength(1);
    expect(alerts.sent[0]?.subject).toBe(batch.subject);
    // notifyDigest takes a subject and a body. There is no address parameter
    // to pass a lead's, which is G1 restated for a component that sends mail.
    expect(alerts.notifyDigest.length).toBe(2);
  });

  it("sends on a clear day too", async () => {
    const alerts = new RecordingAlerts();
    await runStep(
      createDailyMessageWorkflow({ ...options({ leads: [] }), alerts }),
    );
    expect(alerts.sent).toHaveLength(1);
    expect(alerts.sent[0]?.subject).toMatch(/nothing overdue/);
  });

  it("claims no baseline it cannot evidence", () => {
    expect(createDailyMessageWorkflow(options()).baseline).toBeUndefined();
  });

  it("reads the lead records and writes only the mail", () => {
    const workflow = createDailyMessageWorkflow(options());
    const leads = workflow.tools.find(
      (tool) => tool.name === "table:crm_leads",
    );
    // The message reports. It changes no lead record; a reply does that, and a
    // reply is a different workflow with a different audit trail.
    expect(leads?.access).toBe("read");
    expect(
      workflow.tools
        .filter((tool) => tool.access === "write")
        .map((t) => t.name),
    ).toEqual(["alert-email"]);
  });

  it("passes its own gates", async () => {
    const workflow = createDailyMessageWorkflow(options());
    const batch = await runStep(workflow);
    for (const gate of workflow.qaGates) {
      expect(
        gate.check({ outputs: new Map([["send-digest", batch]]) } as never),
        gate.id,
      ).toBe(true);
    }
  });

  it("fails its own gate when the shown and held-back counts do not add up", () => {
    const workflow = createDailyMessageWorkflow(options());
    const gate = workflow.qaGates.find(
      (item) => item.id === "a-truncated-list-never-reads-as-complete",
    );
    const lying = {
      subject: "x",
      sent: true,
      logLine: "",
      digest: {
        ...buildDailyDigest({ result: clock(), leads: leadViews() }),
        heldBack: 0,
      },
    };
    // Seven stalls, five shown, and a claim that nothing was held back.
    expect(
      gate?.check({ outputs: new Map([["send-digest", lying]]) } as never),
    ).toBe(false);
  });

  it("fails its own gate when a name reaches the subject", () => {
    const workflow = createDailyMessageWorkflow(options());
    const gate = workflow.qaGates.find(
      (item) => item.id === "no-name-outside-the-body",
    );
    const digest = buildDailyDigest({ result: clock(), leads: leadViews() });
    expect(
      gate?.check({
        outputs: new Map([
          [
            "send-digest",
            {
              digest,
              sent: true,
              logLine: "",
              subject: `Daily check-in: ${digest.items[0]?.studentName} is overdue`,
            },
          ],
        ]),
      } as never),
    ).toBe(false);
  });
});

describe("7.5d: the tables", () => {
  it("ship with row level security", async () => {
    const sql = await readMigration();
    for (const table of ["crm_lead_actions", "crm_snoozes"]) {
      expect(sql).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`,
      );
    }
  });

  it("pin the four replies and demand attribution on both tables", async () => {
    const sql = await readMigration();
    expect(sql).toMatch(
      /CHECK \(action IN \('draft', 'snooze', 'lost', 'spoke'\)\)/,
    );
    // Named per table. Asserting the predicate alone passed while one of the
    // two constraints was missing entirely.
    expect(sql).toContain("crm_lead_actions_is_attributed");
    expect(sql).toContain("crm_snoozes_is_attributed");
    expect(sql.match(/CHECK \(btrim\(actor\) <> ''\)/g)).toHaveLength(2);
  });

  it("make a duplicate reply impossible", async () => {
    const sql = await readMigration();
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "crm_lead_actions_identity_action_digest_date_key"/,
    );
  });

  it("store no copy of the message itself", async () => {
    const sql = await readMigration();
    const tables = [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(
      (match) => match[1],
    );
    // The message is rendered from the clock on every run. A stored copy of a
    // derived fact is the fork this phase exists to end.
    expect(tables).toEqual(["crm_lead_actions", "crm_snoozes"]);
  });

  it("carries no real student names into the repository", async () => {
    const [brief, source] = await Promise.all([
      readFile(new URL("../docs/PHASE-7.5-CRM.md", import.meta.url), "utf8"),
      readFile(
        new URL("./phase-7-5d-daily-message.test.ts", import.meta.url),
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

async function readRepository(): Promise<string> {
  return readFile(
    new URL("../lib/crm/prisma-digest-repository.ts", import.meta.url),
    "utf8",
  );
}

async function readMigration(): Promise<string> {
  return readFile(
    new URL(
      "../prisma/migrations/202608280003_phase_7_5d_daily_message/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
}
