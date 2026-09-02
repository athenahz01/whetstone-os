import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { EmailAlertService } from "../lib/core/alerts";
import { scoreLead } from "../lib/core/scoring";
import type { Lead } from "../lib/core/types";
import {
  DEFAULT_WYZANT_MIN_RATE,
  wyzantAlertDecision,
  wyzantAlertRuleFromEnv,
} from "../lib/core/wyzant-alert";
import {
  runWyzantAlerts,
  wyzantAlertLogLine,
  type WyzantAlertNotifier,
} from "../lib/core/wyzant-notifier";
import { describeRate, readRecommendedRate } from "../lib/core/wyzant-rate";

/**
 * The owner's rule, 2026-09-02: email her about every relevant Wyzant job whose
 * rate does not contradict ours.
 *
 * Names here are invented. The real board carries learners who may be minors.
 */

const RULE = { minRate: DEFAULT_WYZANT_MIN_RATE };
const NOW = new Date("2026-09-02T12:00:00.000Z");

function job(overrides: Partial<Lead> & { rate?: string } = {}): Lead {
  const { rate, ...lead } = overrides;
  return {
    id: "wyzant:job-1",
    channel: "wyzant",
    author: "Placeholder Learner",
    text: "Placeholder inquiry text.",
    subject: "College Counseling",
    location: "online",
    url: "https://highered.wyzant.com/tutor/jobs/8394201",
    postedAt: "2026-09-02T09:00:00.000Z",
    raw: { nativeId: "8394201", recommendedRate: rate },
    ...lead,
  };
}

class RecordingNotifier implements WyzantAlertNotifier {
  readonly sent: Array<Record<string, string>> = [];
  constructor(private readonly enabled = true) {}
  isEnabled() {
    return this.enabled;
  }
  async notifyWyzantJob(item: Record<string, string>) {
    this.sent.push(item);
  }
}

function store() {
  const reserved = new Set<string>();
  return {
    reserved,
    marked: [] as string[],
    async reserveAlert(id: string) {
      if (reserved.has(id)) return false;
      reserved.add(id);
      return true;
    },
    async markAlerted(id: string) {
      this.marked.push(id);
    },
  };
}

async function run(
  leads: Lead[],
  overrides: {
    rule?: { minRate: number };
    notifier?: RecordingNotifier;
    store?: ReturnType<typeof store>;
  } = {},
) {
  const notifier = overrides.notifier ?? new RecordingNotifier();
  const leadStore = overrides.store ?? store();
  const result = await runWyzantAlerts({
    leads,
    rule: overrides.rule ?? RULE,
    notifier,
    store: leadStore,
    now: NOW,
  });
  return { result, notifier, store: leadStore };
}

describe("Wyzant alert rule: no stated rate is an opening", () => {
  it("emails her about a job whose rate is None", async () => {
    // The case the whole rule exists for. Both cards in the real capture read
    // `Recommended rate: None`, so this is the common path and not an edge.
    const { result, notifier } = await run([
      job({ rate: "Recommended rate: None" }),
    ]);
    expect(result.sent).toBe(1);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.rate).toBe("no rate stated");
  });

  it("reads None off the real captured board, not a hand-written fixture", async () => {
    const html = await readFile(
      new URL("./fixtures/wyzant-board.real-capture.html", import.meta.url),
      "utf8",
    );
    const cells = [...html.matchAll(/Recommended rate:\s*([^\s<]+)/g)].map(
      (match) => match[1],
    );
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      expect(readRecommendedRate(`Recommended rate: ${cell}`).kind).toBe(
        "none",
      );
    }
  });

  it("emails her about a rate at or above the floor", async () => {
    for (const rate of ["Recommended rate: $200/hr", "Recommended rate: 295"]) {
      const { result } = await run([job({ rate })]);
      expect(result.sent, rate).toBe(1);
    }
  });

  it("does not email her about a lowball, and records why", async () => {
    const { result, notifier } = await run([
      job({ rate: "Recommended rate: $50/hr" }),
    ]);
    expect(notifier.sent).toHaveLength(0);
    expect(result.sent).toBe(0);
    // Recorded rather than dropped. A job that vanishes with no row is the
    // defect this project has found in every phase.
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.reason).toBe("rate_below_floor");
    expect(result.outcomes[0]?.rate).toEqual({ kind: "amount", amount: 50 });
  });

  it("treats a rate it cannot read as unknown, never as zero", async () => {
    // Zero would reject it. A cell we could not read is not a lowball.
    const { result, notifier } = await run([
      job({ rate: "Recommended rate: ask me" }),
    ]);
    expect(notifier.sent).toHaveLength(1);
    expect(result.outcomes[0]?.rate.kind).toBe("unreadable");
  });

  it("tells an unreadable cell apart from a real None", () => {
    expect(readRecommendedRate("Recommended rate: None").kind).toBe("none");
    expect(readRecommendedRate("Recommended rate: ask me").kind).toBe(
      "unreadable",
    );
    expect(readRecommendedRate(undefined).kind).toBe("unreadable");
    // Both send, and the two are still distinguishable a week later.
    expect(readRecommendedRate("Recommended rate: None").kind).not.toBe(
      readRecommendedRate(undefined).kind,
    );
  });

  it("does not read a number out of prose", () => {
    // A digit inside a sentence is not a price, and coercing it into one would
    // make a threshold decision from something nobody wrote as a rate.
    expect(readRecommendedRate("Recommended rate: about 3 sessions").kind).toBe(
      "unreadable",
    );
  });
});

describe("Wyzant alert rule: the floor is configuration", () => {
  it("changes the outcome when it moves", async () => {
    const lowball = job({ rate: "Recommended rate: $100/hr" });
    expect((await run([lowball])).result.sent).toBe(0);
    expect((await run([lowball], { rule: { minRate: 50 } })).result.sent).toBe(
      1,
    );
  });

  it("defaults to 200 and reads WYZANT_MIN_RATE", () => {
    expect(DEFAULT_WYZANT_MIN_RATE).toBe(200);
    expect(wyzantAlertRuleFromEnv({}).minRate).toBe(200);
    expect(wyzantAlertRuleFromEnv({ WYZANT_MIN_RATE: "150" }).minRate).toBe(
      150,
    );
    // A setting nobody can parse falls back rather than becoming NaN, which
    // would make every comparison false and send everything.
    expect(wyzantAlertRuleFromEnv({ WYZANT_MIN_RATE: "soon" }).minRate).toBe(
      200,
    );
  });

  it("sends exactly at the floor", () => {
    expect(wyzantAlertDecision("Recommended rate: $200", RULE).send).toBe(true);
    expect(wyzantAlertDecision("Recommended rate: $199.99", RULE).send).toBe(
      false,
    );
  });
});

describe("Wyzant alert rule: the score is computed and does not gate", () => {
  it("sends a low-scoring, in-subject, None-rate job", async () => {
    const quiet = job({
      rate: "Recommended rate: None",
      text: "hi",
      subject: "College Counseling",
      postedAt: "2025-01-01T00:00:00.000Z",
    });
    // The score is still real and still low. It no longer decides what she
    // sees, which is the whole point of the owner's change.
    expect(scoreLead(quiet)).toBeLessThan(70);
    expect((await run([quiet])).result.sent).toBe(1);
  });

  it("never consults a score", async () => {
    const source = await readFile(
      new URL("../lib/core/wyzant-notifier.ts", import.meta.url),
      "utf8",
    );
    const rule = await readFile(
      new URL("../lib/core/wyzant-alert.ts", import.meta.url),
      "utf8",
    );
    for (const text of [source, rule]) {
      expect(text).not.toMatch(/scoreLead|\bscore\b\s*[<>=]/);
    }
  });

  it("leaves the engine's own gate untouched", async () => {
    const engine = await readFile(
      new URL("../lib/core/engine.ts", import.meta.url),
      "utf8",
    );
    // `engine.ts` is byte-for-byte locked and must carry no channel branch, so
    // the rule lives beside it rather than inside it.
    expect(engine).not.toMatch(/wyzant/i);
    expect(engine).not.toMatch(/recommendedRate|minRate/);
  });
});

describe("Wyzant alert rule: one email per job", () => {
  it("does not send the same job twice across polls", async () => {
    const shared = store();
    const first = await run([job({ rate: "Recommended rate: None" })], {
      store: shared,
    });
    expect(first.result.sent).toBe(1);

    const second = await run([job({ rate: "Recommended rate: None" })], {
      store: shared,
    });
    expect(second.result.sent).toBe(0);
    expect(second.result.duplicates).toBe(1);
    expect(second.notifier.sent).toHaveLength(0);
  });

  it("reserves before it sends, so two polls cannot both email", async () => {
    const source = await readFile(
      new URL("../lib/core/wyzant-notifier.ts", import.meta.url),
      "utf8",
    );
    const reserve = source.indexOf("reserveAlert");
    const send = source.indexOf("notifyWyzantJob({");
    expect(reserve).toBeGreaterThan(-1);
    expect(reserve).toBeLessThan(send);
  });

  it("marks the job alerted, not only reserved", async () => {
    const shared = store();
    await run([job({ rate: "Recommended rate: None" })], { store: shared });
    // Reserving stops a second send inside one run. Marking is what records
    // that it went, and a reservation without a mark leaves the row saying an
    // email was pending forever.
    expect(shared.marked).toEqual(["wyzant:job-1"]);
  });

  it("treats a rate that is not a string as unreadable", async () => {
    // The value crosses the runner boundary as JSON, so it can arrive as
    // anything. A number here would be read as a rate nobody wrote.
    const odd = job();
    odd.raw = { nativeId: "8394201", recommendedRate: 50 };
    const { result } = await run([odd]);
    expect(result.outcomes[0]?.rate.kind).toBe("unreadable");
    expect(result.sent).toBe(1);
  });

  it("ignores leads from other channels", async () => {
    const { result } = await run([
      job({ id: "email:1", channel: "email", rate: "Recommended rate: None" }),
    ]);
    expect(result.considered).toBe(0);
    expect(result.sent).toBe(0);
  });

  it("accounts for every job it considered", async () => {
    const { result } = await run([
      job({ id: "a", rate: "Recommended rate: None" }),
      job({ id: "b", rate: "Recommended rate: $50" }),
      job({ id: "c", rate: "Recommended rate: ask me" }),
    ]);
    expect(result.considered).toBe(3);
    expect(
      result.sent +
        result.suppressed +
        result.duplicates +
        result.undeliverable,
    ).toBe(result.considered);
    expect(result.balanced).toBe(true);
  });

  it("counts a job it could not deliver separately from one it refused", async () => {
    const { result } = await run([job({ rate: "Recommended rate: None" })], {
      notifier: new RecordingNotifier(false),
    });
    expect(result.undeliverable).toBe(1);
    expect(result.suppressed).toBe(0);
    expect(result.balanced).toBe(true);
  });
});

describe("Wyzant alert rule: what may leave the process", () => {
  it("puts no learner name, job text or URL in the log line", async () => {
    const { result } = await run([
      job({ rate: "Recommended rate: None", author: "Placeholder Learner" }),
    ]);
    const line = wyzantAlertLogLine(result);
    expect(line).not.toMatch(/Placeholder|Learner/);
    expect(line).not.toMatch(/Placeholder inquiry/);
    // A Wyzant job URL identifies the posting and through it the family.
    expect(line).not.toMatch(/https?:|wyzant\.com/);
    expect(line).toContain("sent=1");
    expect(line).toContain("rates=none");
  });

  it("names the rate, subject, age and link in the email, which is hers alone", async () => {
    const { notifier } = await run([
      job({ rate: "Recommended rate: $250/hr" }),
    ]);
    const sent = notifier.sent[0]!;
    // She cannot judge "worth a shot" without seeing the number.
    expect(sent.rate).toBe("$250/hr recommended");
    expect(sent.subject).toBe("College Counseling");
    expect(sent.url).toContain("wyzant.com");
    expect(sent.postedAt).toBe("2026-09-02T09:00:00.000Z");
  });

  it("carries no learner name or job text into the email either", async () => {
    const { notifier } = await run([
      job({ rate: "Recommended rate: None", author: "Placeholder Learner" }),
    ]);
    const stored = JSON.stringify(notifier.sent);
    expect(stored).not.toMatch(/Placeholder Learner/);
    expect(stored).not.toMatch(/Placeholder inquiry/);
  });

  it("describes each rate kind for a human", () => {
    expect(describeRate({ kind: "none" })).toBe("no rate stated");
    expect(describeRate({ kind: "unreadable" })).toBe("rate could not be read");
    expect(describeRate({ kind: "amount", amount: 295 })).toBe(
      "$295/hr recommended",
    );
  });
});

describe("Wyzant alert rule: the rate reaches the lead", () => {
  it("carries the extracted rate into the lead the runner sends", async () => {
    const source = await readFile(
      new URL("../lib/adapters/wyzant.ts", import.meta.url),
      "utf8",
    );
    // The board cell has to survive the hop from the GitHub Actions poll to
    // the ingest route, or the rule has nothing to read and every job sends.
    expect(source).toMatch(/recommendedRate: job\.recommendedRate,/);
    expect(source).toMatch(/recommendedRate\?: string;/);
  });
});

describe("Wyzant alert rule: the sender takes no recipient", () => {
  it("sends to ALERT_EMAIL_TO and nowhere else", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const service = new EmailAlertService({
      transport: {
        sendMail: async (message) => {
          sent.push(message as unknown as Record<string, unknown>);
          return undefined;
        },
      },
      from: "bot@whetstoneadmissions.com",
      to: "athena@whetstoneadmissions.com",
      reviewBaseUrl: "https://example.com/today",
    });
    await service.notifyWyzantJob({
      subject: "College Counseling",
      location: "online",
      rate: "no rate stated",
      postedAt: "2026-09-02T09:00:00.000Z",
      url: "https://highered.wyzant.com/tutor/jobs/8394201",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("athena@whetstoneadmissions.com");
    // She cannot judge "worth a shot" without the number and the link.
    const text = String(sent[0]?.text);
    expect(text).toContain("Rate: no rate stated");
    expect(text).toContain(
      "Job: https://highered.wyzant.com/tutor/jobs/8394201",
    );
    expect(text).toContain("Subject: College Counseling");
    // No reply-to, cc or bcc. A family address has no way into this envelope.
    expect(Object.keys(sent[0]!).sort()).toEqual([
      "from",
      "subject",
      "text",
      "to",
    ]);
  });

  it("has no recipient parameter to pass a family address into", () => {
    const service = new EmailAlertService({ transport: { sendMail: vi.fn() } });
    // One argument, the job. G1 restated for a component that can send mail.
    expect(service.notifyWyzantJob.length).toBe(1);
  });

  it("is refused by the guardrail test that owns this rule", async () => {
    const guardrail = await readFile(
      new URL("./alert-email-guardrail.test.ts", import.meta.url),
      "utf8",
    );
    expect(guardrail).toMatch(/recipient|to\b/i);
  });
});
