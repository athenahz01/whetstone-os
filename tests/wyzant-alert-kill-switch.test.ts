import { describe, expect, it, vi } from "vitest";
import { runWyzantAlerts } from "../lib/core/wyzant-notifier";
import { DEFAULT_WYZANT_MIN_RATE } from "../lib/core/wyzant-alert";
import type { Lead } from "../lib/core/types";

/**
 * The audit of the alert-rule pass found the alert running before
 * `runProspecting`, which is where the governor and therefore the kill switch
 * live. Tripping the switch stopped qualification and drafting and left these
 * emails sending.
 *
 * The owner asked for the alert not to be gated by the *score*. That is
 * separable from it not being gated by the *kill switch*, and a safety control
 * that stops covering a path is not a capacity question.
 */

const lead = (id: string, rate?: string): Lead =>
  ({
    id,
    channel: "wyzant",
    author: "someone",
    text: "an inquiry",
    subject: "Essay Writing",
    url: "https://highered.wyzant.com/tutor/jobs/1",
    postedAt: new Date().toISOString(),
    raw: rate === undefined ? {} : { recommendedRate: rate },
  }) as Lead;

function harness() {
  const sent: unknown[] = [];
  const notifier = {
    isEnabled: () => true,
    notifyWyzantJob: async (job: unknown) => void sent.push(job),
  };
  const store = {
    reserveAlert: async () => true,
    markAlerted: async () => undefined,
  };
  return { sent, notifier, store } as never as {
    sent: unknown[];
    notifier: Parameters<typeof runWyzantAlerts>[0]["notifier"];
    store: Parameters<typeof runWyzantAlerts>[0]["store"];
  };
}

const run = (leads: Lead[], killSwitchEngaged: boolean) => {
  const h = harness();
  return runWyzantAlerts({
    leads,
    rule: { minRate: DEFAULT_WYZANT_MIN_RATE },
    notifier: h.notifier,
    store: h.store,
    now: new Date(),
    killSwitchEngaged,
  }).then((result) => ({ result, sent: h.sent }));
};

describe("the kill switch stops the alert", () => {
  it("sends a qualifying job when the switch is off", async () => {
    const { result, sent } = await run([lead("a", "None")], false);
    expect(result.sent).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("sends nothing at all when the switch is on", async () => {
    const { result, sent } = await run([lead("a", "None")], true);
    expect(sent).toHaveLength(0);
    expect(result.sent).toBe(0);
  });

  it("suppresses with a reason rather than skipping the lead", async () => {
    const { result } = await run([lead("a", "None")], true);
    expect(result.suppressed).toBe(1);
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]!.reason).toBe("kill_switch_engaged");
  });

  it("still balances under the kill switch", async () => {
    const { result } = await run([lead("a", "None"), lead("b", "$250")], true);
    expect(result.balanced).toBe(true);
    expect(result.considered).toBe(2);
    expect(result.suppressed).toBe(2);
  });

  it("stops the rate rule from being consulted at all", async () => {
    // A $50 job and a None job are suppressed for the same reason under the
    // switch. The rate is not why they were held back, and saying it was would
    // send someone to the wrong setting.
    const { result } = await run([lead("a", "$50"), lead("b", "None")], true);
    expect(result.outcomes.map((o) => o.reason)).toEqual([
      "kill_switch_engaged",
      "kill_switch_engaged",
    ]);
  });

  it("defaults to sending when the caller does not say", async () => {
    // Explicitly asserted so the default is a decision, not an oversight - but
    // the route always passes it, and a caller that forgets gets the old
    // behaviour, which is why the route test matters more than this one.
    const h = harness();
    const result = await runWyzantAlerts({
      leads: [lead("a", "None")],
      rule: { minRate: DEFAULT_WYZANT_MIN_RATE },
      notifier: h.notifier,
      store: h.store,
      now: new Date(),
    });
    expect(result.sent).toBe(1);
  });
});

describe("the route reads the switch", () => {
  it("passes killSwitchEngaged from the governor's flag store", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("app/api/ingest/route.ts", "utf8"),
    );
    // The route needs a live database to invoke, the same limitation every
    // other assertion about this file carries. Checked by shape.
    expect(source).toContain("KILL_SWITCH_KEY");
    expect(source).toContain("PrismaFlagStore");
    // It must be read before the alert call, not after it.
    expect(source.indexOf("killSwitchEngaged = await")).toBeLessThan(
      source.indexOf("runWyzantAlerts({"),
    );
    // And it must actually be *passed*. The first version of this test matched
    // the declaration, so deleting the argument from the call left it green -
    // a test that asserts a name exists somewhere in a file rather than that
    // the value reaches the function. Caught by mutating the route.
    const call = source.slice(
      source.indexOf("runWyzantAlerts({"),
      source.indexOf("});", source.indexOf("runWyzantAlerts({")),
    );
    expect(call).toContain("killSwitchEngaged");
  });
});
