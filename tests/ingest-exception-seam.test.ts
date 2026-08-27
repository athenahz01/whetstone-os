import { readFile } from "node:fs/promises";
import { chromium, type Browser } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { BatchAdapter } from "../lib/adapters/batch";
import { DEFAULT_WYZANT_FEED_URL, WyzantAdapter } from "../lib/adapters/wyzant";
import {
  ADAPTER_EXCEPTION_KINDS,
  ADAPTER_EXCEPTION_REGISTRY,
  isTransportableAdapterException,
  MAX_ADAPTER_EXCEPTIONS,
  parseAdapterExceptions,
} from "../lib/core/adapter-exceptions";
import { runWorkflow } from "../lib/core/workflow";
import { createQualifyWorkflow } from "../lib/workflows/s1-qualify";
import type { AdapterException } from "../lib/core/types";
import { MemoryRunStore } from "./run-helpers";

/**
 * The seam test.
 *
 * Every piece of the exception channel was already covered. The adapter builds
 * its exceptions and a test proved it. The workflow drains an adapter and a
 * test proved that too. What nobody tested was the join: the adapter runs on
 * the GitHub runner, the drain runs on Vercel against a container that has
 * nothing to drain, and the wire between them had no field for exceptions at
 * all. Everything worked and the channel did not exist.
 *
 * So this test does not exercise a unit. It carries a real exception from the
 * real adapter, through the shape the poll script POSTs, through the route's
 * validator, into the workflow that records it, and asserts the row lands.
 */

const scope = {
  targetSubjects: ["SAT Reading", "Essay Writing", "College Counseling"],
  targetLocations: ["New York, NY", "Manhattan"],
};

function boardHtml(subjects: string[], expectedCount = subjects.length) {
  const cards = subjects
    .map(
      (subject, index) => `
        <div class="academy-card" data-job-id="job-${index}">
          <p class="text-semibold spc-zero-n spc-tiny-s">Fixture learner ${index}</p>
          <h3><a class="job-details-link" href="/tutor/jobs/job-${index}">${subject}</a></h3>
          <p class="job-description">Looking for help with the reading section.</p>
          <span class="job-location">New York, NY</span>
          <span class="job-posted">2 hours ago</span>
        </div>`,
    )
    .join("");
  return `<html><body>
    <div class="jobs-tutor-header"><h2 class="light-header"><span class="text-bold">${expectedCount}</span> jobs</h2></div>
    <div id="jobs-list">${cards}</div>
  </body></html>`;
}

async function pollRealAdapter(
  subjects: string[],
  expectedCount: number,
): Promise<AdapterException[]> {
  const actualBrowser = await chromium.launch({ headless: true });
  const browserFactory = vi.fn(async () => {
    return {
      newContext: async (options: Parameters<Browser["newContext"]>[0]) => {
        const context = await actualBrowser.newContext(options);
        await context.route(
          "https://highered.wyzant.com/tutor/jobs**",
          (route) =>
            route.fulfill({
              contentType: "text/html",
              body: boardHtml(subjects, expectedCount),
            }),
        );
        return context;
      },
      close: async () => actualBrowser.close(),
    } as unknown as Browser;
  });
  const adapter = new WyzantAdapter({
    storageState: { cookies: [], origins: [] },
    feedUrl: DEFAULT_WYZANT_FEED_URL,
    targetSubjects: scope.targetSubjects,
    targetLocations: scope.targetLocations,
    includeOnlineJobs: false,
    headless: true,
    browserFactory,
  });
  await adapter.poll();
  return adapter.drainExceptions();
}

/** The exact shape ops/wyzant-poll.ts puts on the wire, round-tripped. */
function overTheWire(exceptions: AdapterException[]): unknown {
  return JSON.parse(
    JSON.stringify({ leads: [], heartbeat: undefined, exceptions }),
  );
}

/** The workflow that drains adapters, with the route's container in front. */
async function recordThrough(
  exceptions: AdapterException[],
): Promise<MemoryRunStore> {
  const store = new MemoryRunStore();
  await runWorkflow(
    createQualifyWorkflow({ adapters: [new BatchAdapter([], exceptions)] }),
    { store, trigger: "seam-test" },
  );
  return store;
}

describe("the seam between the runner and the database", () => {
  it("carries an inventory mismatch from the real adapter into exceptions", async () => {
    const drained = await pollRealAdapter(
      Array.from({ length: 10 }, () => "SAT Reading"),
      17,
    );
    const mismatch = drained.find(
      (item) => item.kind === "WyzantBoardInventoryMismatch",
    );
    expect(mismatch, "the adapter raised no mismatch").toBeTruthy();

    const body = overTheWire(drained) as { exceptions: unknown };
    const validated = parseAdapterExceptions(body.exceptions);
    expect(
      validated,
      "the route rejected what the poll would send",
    ).not.toBeNull();

    const store = await recordThrough(validated ?? []);
    const recorded = store.exceptions.find(
      (item) => item.kind === "WyzantBoardInventoryMismatch",
    );
    expect(recorded).toBeTruthy();
    // Both numbers, which is the whole point of the exception.
    expect(recorded?.message).toContain("17");
    expect(recorded?.message).toContain("10");
    expect(recorded?.severity).toBe("critical");
    expect(recorded?.workflowId).toBe("S1.qualify");
  }, 60_000);

  it("carries rejected subject labels the same way", async () => {
    const drained = await pollRealAdapter(
      ["SAT Reading", "Elementary Math", "Writing"],
      3,
    );
    const rejected = drained.find(
      (item) => item.kind === "WyzantSubjectsRejected",
    );
    expect(rejected, "the adapter rejected no subjects").toBeTruthy();

    const body = overTheWire(drained) as { exceptions: unknown };
    const validated = parseAdapterExceptions(body.exceptions);
    expect(validated).not.toBeNull();

    const store = await recordThrough(validated ?? []);
    const recorded = store.exceptions.find(
      (item) => item.kind === "WyzantSubjectsRejected",
    );
    expect(recorded).toBeTruthy();
    // The labels Cole needs in order to rule on them.
    expect(recorded?.message).toContain("Elementary Math");
    expect(recorded?.message).toContain("Writing");
  }, 60_000);

  it("hands the validated exceptions to the container the workflow drains", async () => {
    // The one link in this chain that needs a live database to invoke, so it
    // is checked by shape rather than by execution. Said plainly rather than
    // counted as if it were exercised.
    const route = await readFile(
      new URL("../app/api/ingest/route.ts", import.meta.url),
      "utf8",
    );
    expect(route).toMatch(
      /new BatchAdapter\(\s*body\.leads,\s*exceptions \?\? \[\],?\s*\)/,
    );
  });

  it("would have failed before the wire carried exceptions", () => {
    // The contract field is the thing that did not exist. If it goes, the two
    // tests above stop meaning anything, so it is asserted directly.
    const validated = parseAdapterExceptions([
      {
        kind: "WyzantBoardInventoryMismatch",
        severity: "critical",
        message:
          "online view: Wyzant board reported 17 jobs but 10 distinct cards were extracted.",
      },
    ]);
    expect(validated).toHaveLength(1);
    expect(
      new BatchAdapter([], validated ?? []).drainExceptions(),
    ).toHaveLength(1);
  });
});

describe("G5: what an exception message may carry", () => {
  const good: AdapterException = {
    kind: "WyzantSubjectsRejected",
    severity: "warning",
    message: "Rejected Wyzant subject labels: Elementary Math | Writing",
  };

  it("accepts the messages the adapter actually builds", () => {
    expect(isTransportableAdapterException(good)).toBe(true);
    for (const kind of ADAPTER_EXCEPTION_KINDS) {
      expect(ADAPTER_EXCEPTION_REGISTRY[kind].severity).toMatch(
        /^(warning|critical)$/,
      );
    }
  });

  it("refuses a job URL in any message", () => {
    for (const kind of ADAPTER_EXCEPTION_KINDS) {
      expect(
        isTransportableAdapterException({
          kind,
          severity: ADAPTER_EXCEPTION_REGISTRY[kind].severity,
          message: "https://www.wyzant.com/tutor/jobs/job-1",
        }),
        kind,
      ).toBe(false);
    }
  });

  it("refuses message body text", () => {
    expect(
      isTransportableAdapterException({
        ...good,
        message:
          "Rejected Wyzant subject labels: My daughter keeps running out of time on the reading section before the November test and we need help",
      }),
    ).toBe(false);
    expect(
      isTransportableAdapterException({
        ...good,
        message: "Rejected Wyzant subject labels: Writing\nLooking for help",
      }),
    ).toBe(false);
  });

  it("refuses a bare host that the kind's own shape would admit", () => {
    // The per-kind shapes reject a full URL on their own. This one does not:
    // "contact www.example" is all permitted characters, so the universal
    // guard is what stops it, and this is the case that reaches it.
    expect(
      isTransportableAdapterException({
        kind: "WyzantJobMalformed",
        severity: "warning",
        message: "job-1: contact www.example for the description",
      }),
    ).toBe(false);
  });

  it("bounds how long one subject label may be", () => {
    // One label, well under the word bound, far over the character bound.
    expect(
      isTransportableAdapterException({
        ...good,
        message: `Rejected Wyzant subject labels: ${"Subjectlabel".repeat(8)}`,
      }),
    ).toBe(false);
  });

  it("bounds how many subject labels one message may carry", () => {
    const many = Array.from({ length: 13 }, (_, index) => `Sub${index}`);
    expect(
      isTransportableAdapterException({
        ...good,
        message: `Rejected Wyzant subject labels: ${many.join(" | ")}`,
      }),
    ).toBe(false);
  });

  it("refuses an email address", () => {
    expect(
      isTransportableAdapterException({
        kind: "WyzantJobMalformed",
        severity: "warning",
        message: "job-1: parent@example.test asked about this",
      }),
    ).toBe(false);
  });

  it("refuses a learner name where a source ref belongs", () => {
    // A native id has no spaces, so a name cannot sit in that slot.
    expect(
      isTransportableAdapterException({
        kind: "WyzantJobMalformed",
        severity: "warning",
        message: "Jordan Lee: job description is missing",
      }),
    ).toBe(false);
  });

  it("refuses an unregistered kind, a wrong severity and an over-long message", () => {
    expect(
      isTransportableAdapterException({ ...good, kind: "SomethingNew" }),
    ).toBe(false);
    expect(
      isTransportableAdapterException({ ...good, severity: "critical" }),
    ).toBe(false);
    expect(
      isTransportableAdapterException({
        ...good,
        message: `Rejected Wyzant subject labels: ${"A".repeat(400)}`,
      }),
    ).toBe(false);
    expect(parseAdapterExceptions("not an array")).toBeNull();
    expect(
      parseAdapterExceptions(
        Array.from({ length: MAX_ADAPTER_EXCEPTIONS + 1 }, () => good),
      ),
    ).toBeNull();
  });

  it("rejects the whole batch rather than dropping what it cannot validate", async () => {
    const route = await readFile(
      new URL("../app/api/ingest/route.ts", import.meta.url),
      "utf8",
    );
    expect(route).toMatch(/parseAdapterExceptions/);
    expect(route).toMatch(/Invalid adapter exceptions/);
    expect(
      parseAdapterExceptions([good, { ...good, kind: "Nope" }]),
    ).toBeNull();
  });

  /**
   * The validator can refuse a URL, a body and an address by shape. It cannot
   * tell a learner's name from an unknown subject label, because both are two
   * capitalised words. That guarantee lives at the adapter instead: the labels
   * come from the job's subject field and from nowhere else.
   */
  it("takes rejected labels from the subject field and nothing else", async () => {
    const source = await readFile(
      new URL("../lib/adapters/wyzant.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /onRejectedSubject\?\.\(job\.subject\)|rejectedSubjects\.add\(subject\)/,
    );
    // The callback is fed by the subject filter, never by author or text.
    expect(source).not.toMatch(/onRejectedSubject.{0,40}job\.(author|text)/s);
    expect(source).not.toMatch(/rejectedSubjects\.add\(job\.(author|text)\)/);
  });
});

describe("the poll script sends what it drained", () => {
  it("drains every adapter in a finally, so a failed poll still reports", async () => {
    const script = await readFile(
      new URL("../ops/wyzant-poll.ts", import.meta.url),
      "utf8",
    );
    expect(script).toMatch(/\} finally \{[\s\S]*drainExceptions/);
    expect(script).toMatch(/exceptions: transportable/);
    // A failed adapter is itself reported, with the error name only.
    expect(script).toMatch(/kind: "AdapterPollFailed"/);
    expect(script).toMatch(
      /error instanceof Error \? error\.name : "UnknownError"/,
    );
    // And the throw that ends the job happens after the POST, not before it.
    expect(script.indexOf("body: JSON.stringify")).toBeLessThan(
      script.indexOf("Wyzant poll failed for adapter"),
    );
  });

  it("drops what would not validate rather than losing the whole POST", async () => {
    const script = await readFile(
      new URL("../ops/wyzant-poll.ts", import.meta.url),
      "utf8",
    );
    expect(script).toMatch(/filter\(isTransportableAdapterException\)/);
    expect(script).toMatch(/exceptionsDropped/);
  });
});
