import { describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import {
  assertAuthenticatedWyzantMessagesUrl,
  DEFAULT_WYZANT_MESSAGES_URL,
  readOperatorWyzantMessagesInbox,
} from "../lib/adapters/wyzant-messages";
import {
  configuredWyzantLessonTypes,
  collectConfiguredWyzantJobs,
  dedupeWyzantJobs,
  DEFAULT_WYZANT_FEED_URL,
  extractCompleteWyzantBoard,
  filterWyzantJobs,
  readSettledWyzantPage,
  readWyzantRoute,
  withWyzantBrowserRetry,
  WyzantAdapter,
  wyzantFeedUrlForLessonType,
  type WyzantJobSnapshot,
} from "../lib/adapters/wyzant";

const baseJob: WyzantJobSnapshot = {
  nativeId: "job-1",
  author: "Wyzant learner",
  text: "Looking for help with the reading section.",
  subject: "SAT Reading",
  location: "New York, NY",
  url: "https://highered.wyzant.com/tutor/jobs/job-1",
  postedAt: "2026-08-27T12:00:00.000Z",
  lessonType: "in_person",
};

function boardHtml(subjects: string[], expectedCount = subjects.length) {
  const cards = subjects
    .map(
      (subject, index) => `
        <div class="academy-card" data-job-id="job-${index}">
          <p class="text-semibold spc-zero-n spc-tiny-s">Fixture learner ${index}</p>
          <h3><a class="job-details-link" href="/tutor/jobs/job-${index}">${subject}</a></h3>
          <span class="location">New York, NY</span>
          <p class="spc-zero-s job-description">Fixture description ${index}</p>
          <div class="pull-right"><span class="text-semibold text-light">5h</span></div>
        </div>`,
    )
    .join("");
  return `<div class="jobs-tutor-header"><h2 class="light-header"><span class="text-bold">${expectedCount}</span> jobs</h2></div><div id="jobs-list">${cards}</div>`;
}

const scope = {
  targetSubjects: [
    "College Counseling",
    "English",
    "Essay Writing",
    "SAT Reading",
  ],
  targetLocations: ["Manhattan", "New York, NY"],
  includeOnlineJobs: true,
};

describe("Wyzant operational hardening", () => {
  it("pins both production defaults to the observed highered host", () => {
    expect(DEFAULT_WYZANT_FEED_URL).toBe(
      "https://highered.wyzant.com/tutor/jobs",
    );
    expect(DEFAULT_WYZANT_MESSAGES_URL).toBe(
      "https://highered.wyzant.com/tutor/messaging",
    );
  });

  it("negative-probes targetSubjects by excluding an unapproved subject", () => {
    expect(
      filterWyzantJobs([{ ...baseJob, subject: "ACT English" }], scope),
    ).toEqual([]);
  });

  it("negative-probes targetLocations by excluding an out-of-area in-person job", () => {
    expect(
      filterWyzantJobs([{ ...baseJob, location: "Boston, MA" }], scope),
    ).toEqual([]);
  });

  it("negative-probes includeOnlineJobs with the same online job", () => {
    const online = {
      ...baseJob,
      location: "Online",
      lessonType: "online",
    } as const;
    expect(filterWyzantJobs([online], scope)).toEqual([online]);
    expect(
      filterWyzantJobs([online], { ...scope, includeOnlineJobs: false }),
    ).toEqual([]);
  });

  it("reads both lesson-type selections when online is enabled", () => {
    expect(configuredWyzantLessonTypes(true)).toEqual(["online", "in_person"]);
    expect(configuredWyzantLessonTypes(false)).toEqual(["in_person"]);
    expect(wyzantFeedUrlForLessonType(DEFAULT_WYZANT_FEED_URL, "online")).toBe(
      "https://highered.wyzant.com/tutor/jobs?subject_id=-1&lesson_type=online",
    );
    expect(
      wyzantFeedUrlForLessonType(DEFAULT_WYZANT_FEED_URL, "in_person"),
    ).toBe(
      "https://highered.wyzant.com/tutor/jobs?subject_id=-1&lesson_type=in_person",
    );
  });

  it("deduplicates inventory shared by the two lesson-type views", () => {
    expect(
      dedupeWyzantJobs([
        { ...baseJob, lessonType: "online" },
        { ...baseJob, lessonType: "in_person" },
      ]),
    ).toHaveLength(1);
  });

  it("wires both scoped views through collection instead of leaving options inert", async () => {
    const readView = vi.fn(
      async (_url: string, lessonType: "online" | "in_person") => [
        { ...baseJob, lessonType },
        { ...baseJob, nativeId: "wrong-subject", subject: "ACT English" },
        { ...baseJob, nativeId: "wrong-location", location: "Boston, MA" },
      ],
    );
    const jobs = await collectConfiguredWyzantJobs(
      { ...scope, feedUrl: DEFAULT_WYZANT_FEED_URL },
      readView,
    );
    expect(readView).toHaveBeenCalledTimes(2);
    expect(jobs.map((job) => job.nativeId)).toEqual(["job-1"]);
  });

  it("follows board pagination until the extracted distinct-card count matches the board total", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const firstPageSubjects = Array.from({ length: 10 }, () => "SAT Reading");
      const secondPageSubjects = Array.from({ length: 7 }, () => "SAT Reading");
      await page.route("https://highered.wyzant.com/tutor/jobs**", (route) => {
        const requestUrl = new URL(route.request().url());
        const pageNumber = requestUrl.searchParams.get("page");
        const html = boardHtml(
          pageNumber === "2" ? secondPageSubjects : firstPageSubjects,
          17,
        ).replaceAll(
          /job-(\d+)/g,
          (_match, index: string) =>
            `job-${Number(index) + (pageNumber === "2" ? 10 : 0)}`,
        );
        return route.fulfill({
          contentType: "text/html",
          body:
            pageNumber === "2"
              ? html
              : `${html}<ul class="pagination"><li class="active">1</li><li><a href="?page=2">2</a></li></ul>`,
        });
      });
      await page.goto("https://highered.wyzant.com/tutor/jobs");

      const result = await extractCompleteWyzantBoard(page, {
        lessonType: "online",
      });

      expect(result.complete).toBe(true);
      expect(result.expectedCount).toBe(17);
      expect(result.extractedCount).toBe(17);
      expect(result.jobs).toHaveLength(17);
      expect(page.url()).toBe("https://highered.wyzant.com/tutor/jobs?page=2");
      await page.close();
    } finally {
      await browser.close();
    }
  }, 15_000);

  it("treats an explicitly empty jobs list as a reconciled zero without waiting for a missing header", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<div id="jobs-list"></div>');

      await expect(extractCompleteWyzantBoard(page)).resolves.toEqual({
        jobs: [],
        expectedCount: 0,
        extractedCount: 0,
        complete: true,
      });
      await page.close();
    } finally {
      await browser.close();
    }
  });

  it("records both board and extracted counts when pagination cannot reconcile inventory", async () => {
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
                body: boardHtml(
                  Array.from({ length: 10 }, () => "SAT Reading"),
                  17,
                ),
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

    await expect(adapter.poll()).resolves.toHaveLength(10);
    expect(adapter.drainExceptions()).toContainEqual({
      kind: "WyzantBoardInventoryMismatch",
      severity: "critical",
      message:
        "in_person view: Wyzant board reported 17 jobs but 10 distinct cards were extracted.",
    });
  });

  it("records distinct rejected Wyzant subject labels without guessing mappings or logging card content", async () => {
    const rejectedSubjects = vi.fn();
    const subjects = [
      "Reading",
      "Writing",
      "College Essays",
      "ACT English",
      "Reading",
    ];
    const jobs = await collectConfiguredWyzantJobs(
      { ...scope, feedUrl: DEFAULT_WYZANT_FEED_URL },
      async (_url, lessonType) =>
        subjects.map((subject, index) => ({
          ...baseJob,
          nativeId: `${lessonType}-${index}`,
          author: "Private fixture author",
          text: "Private fixture message",
          subject,
          lessonType,
        })),
      { onRejectedSubjects: rejectedSubjects },
    );

    expect(jobs).toEqual([]);
    expect(rejectedSubjects).toHaveBeenCalledOnce();
    expect(rejectedSubjects).toHaveBeenCalledWith([
      "ACT English",
      "College Essays",
      "Reading",
      "Writing",
    ]);
    expect(JSON.stringify(rejectedSubjects.mock.calls)).not.toContain(
      "Private fixture",
    );
  });

  it("drains one label-only exception for subjects rejected during a poll", async () => {
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
                body: boardHtml([
                  "Reading",
                  "Writing",
                  "College Essays",
                  "ACT English",
                ]),
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

    await expect(adapter.poll()).resolves.toEqual([]);
    const exceptions = adapter.drainExceptions();
    expect(exceptions).toEqual([
      {
        kind: "WyzantSubjectsRejected",
        severity: "warning",
        message:
          "Rejected Wyzant subject labels: ACT English | College Essays | Reading | Writing",
      },
    ]);
    expect(JSON.stringify(exceptions)).not.toContain("Fixture learner");
    expect(JSON.stringify(exceptions)).not.toContain("Fixture description");
  });

  it("retries an evaluation interrupted by a client-side redirect to another official subdomain", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route(
        "https://www.wyzant.com/tutor/messaging",
        async (route) =>
          route.fulfill({
            contentType: "text/html",
            body: `<div id="messaging-app"><div class="inbox-main"></div></div>
              <script>
                setTimeout(() => {
                  location.href = "https://highered.wyzant.com/tutor/messaging";
                }, 350);
              </script>`,
          }),
      );
      await page.route(
        "https://highered.wyzant.com/tutor/messaging",
        async (route) =>
          route.fulfill({
            contentType: "text/html",
            body: '<div id="messaging-app"><div class="inbox-main"></div></div>',
          }),
      );
      await page.goto("https://www.wyzant.com/tutor/messaging", {
        waitUntil: "domcontentloaded",
      });
      const evaluate = vi.fn(async () =>
        page.evaluate(
          () =>
            new Promise<string>((resolve) => {
              setTimeout(() => resolve(location.href), 500);
            }),
        ),
      );

      await expect(
        readSettledWyzantPage(
          page,
          {
            assertUrl: assertAuthenticatedWyzantMessagesUrl,
            readySelector: "#messaging-app .inbox-main",
            stabilityMs: 200,
          },
          evaluate,
        ),
      ).resolves.toBe("https://highered.wyzant.com/tutor/messaging");
      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(page.url()).toBe("https://highered.wyzant.com/tutor/messaging");
      await page.close();
    } finally {
      await browser.close();
    }
  }, 15_000);

  it("lets the Messages adapter finish after its old page redirects during extraction", async () => {
    const actualBrowser = await chromium.launch({ headless: true });
    const browserFactory = vi.fn(async () => {
      return {
        newContext: async (options: Parameters<Browser["newContext"]>[0]) => {
          const context = await actualBrowser.newContext(options);
          await context.route(
            "https://www.wyzant.com/tutor/messaging",
            async (route) =>
              route.fulfill({
                contentType: "text/html",
                body: `<div id="messaging-app"><div class="inbox-main">
                    <div class="conversation-summary-wrap"><span class="username">Safe fixture</span></div>
                  </div></div>
                  <script>
                    const summary = document.querySelector(".conversation-summary-wrap");
                    summary.__vue__ = {
                      userId: "operator",
                      isUnread: true,
                      displayName: "Safe fixture",
                      thread: {
                        sid: "thread-fixture",
                        attributes: {},
                        _internalState: { lastMessage: { index: 0 } },
                        _messagesList: {
                          get: async () => {
                            await new Promise((resolve) => setTimeout(resolve, 500));
                            return { data: { author: "student", sid: "message-fixture", text: "fixture", timestamp: "2026-08-27T12:00:00.000Z" } };
                          }
                        }
                      }
                    };
                    setTimeout(() => {
                      location.href = "https://highered.wyzant.com/tutor/messaging";
                    }, 650);
                  </script>`,
              }),
          );
          await context.route(
            "https://highered.wyzant.com/tutor/messaging",
            async (route) =>
              route.fulfill({
                contentType: "text/html",
                body: "<main>Final Messages route</main>",
              }),
          );
          return context;
        },
        close: async () => actualBrowser.close(),
      } as unknown as Browser;
    });

    await expect(
      readOperatorWyzantMessagesInbox({
        storageState: { cookies: [], origins: [] },
        inboxUrl: "https://www.wyzant.com/tutor/messaging",
        headless: true,
        browserFactory,
      }),
    ).resolves.toEqual([]);
    expect(browserFactory).toHaveBeenCalledOnce();
  });

  it("replaces a page target that closes during a Wyzant read", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      await context.route(
        "https://highered.wyzant.com/tutor/messaging",
        async (route) =>
          route.fulfill({
            contentType: "text/html",
            body: '<div id="messaging-app"><div class="inbox-main"></div></div>',
          }),
      );
      const read = vi.fn(
        async (page: Awaited<ReturnType<typeof context.newPage>>) => {
          if (read.mock.calls.length === 1) {
            await page.close();
          }
          return page.evaluate(() => location.href);
        },
      );

      await expect(
        readWyzantRoute(
          context,
          "https://highered.wyzant.com/tutor/messaging",
          {
            assertUrl: assertAuthenticatedWyzantMessagesUrl,
            readySelector: "#messaging-app .inbox-main",
            stabilityMs: 0,
          },
          read,
        ),
      ).resolves.toBe("https://highered.wyzant.com/tutor/messaging");
      expect(read).toHaveBeenCalledTimes(2);
      await context.close();
    } finally {
      await browser.close();
    }
  });

  it("replaces the browser session when a redirect closes its context", async () => {
    const closeFirst = vi.fn(async () => undefined);
    const closeSecond = vi.fn(async () => undefined);
    const browsers = [
      { close: closeFirst } as unknown as Browser,
      { close: closeSecond } as unknown as Browser,
    ];
    const openBrowser = vi.fn(async () => browsers.shift()!);
    const read = vi
      .fn<(browser: Browser) => Promise<string>>()
      .mockRejectedValueOnce(
        new Error(
          "browserContext.newPage: Target page, context or browser has been closed",
        ),
      )
      .mockResolvedValueOnce("settled");

    await expect(withWyzantBrowserRetry(openBrowser, read)).resolves.toBe(
      "settled",
    );
    expect(openBrowser).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(2);
    expect(closeFirst).toHaveBeenCalledOnce();
    expect(closeSecond).toHaveBeenCalledOnce();
  });
});
