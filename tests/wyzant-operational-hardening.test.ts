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
  filterWyzantJobs,
  readSettledWyzantPage,
  readWyzantRoute,
  withWyzantBrowserRetry,
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
