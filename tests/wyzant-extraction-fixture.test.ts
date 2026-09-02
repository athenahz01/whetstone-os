import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertAuthenticatedWyzantFeedUrl,
  extractJobs,
  parseWyzantPostedAt,
  resolveWyzantStorageState,
  WyzantAuthenticationError,
} from "../lib/adapters/wyzant";

let browser: Awaited<ReturnType<typeof chromium.launch>>;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

describe("Wyzant extraction against the saved sanitized page", () => {
  it("parses each visible field and accepts both observed job URL shapes", async () => {
    const page = await browser.newPage();
    const html = await readFile(
      new URL("./fixtures/wyzant-board.sanitized.html", import.meta.url),
      "utf8",
    );
    await page.setContent(html);
    const jobs = await extractJobs(page);
    expect(jobs).toEqual([
      {
        nativeId: "job-reading-101",
        author: "Sample learner",
        subject: "SAT Reading",
        location: "Online",
        text: "Grade 11 student wants a structured reading plan before the fall test.",
        url: "https://highered.wyzant.com/tutor/jobs/job-reading-101",
        postedAt: "2026-08-26T12:00:00.000Z",
      },
      {
        nativeId: "job-act-202",
        author: "Sample guardian",
        subject: "ACT English",
        location: "New York, NY",
        text: "Grade 10 student needs help with ACT English before a spring test.",
        url: "https://www.wyzant.com/tutoring-job/job-act-202",
        postedAt: "2026-08-26T12:05:00.000Z",
      },
    ]);
    await page.close();
  });

  it("parses the real captured board selectors, relative URLs, and one compact time per card", async () => {
    const page = await browser.newPage();
    const html = await readFile(
      new URL("./fixtures/wyzant-board.real-capture.html", import.meta.url),
      "utf8",
    );
    await page.setContent(html);
    const now = Date.parse("2026-08-27T18:00:00.000Z");
    const jobs = await extractJobs(page, { now });

    expect(
      await page.locator(".pull-right .text-semibold.text-light").count(),
    ).toBe(4);
    expect(jobs).toEqual([
      {
        nativeId: "8394201",
        author: "Placeholder Learner A",
        subject: "College Counseling",
        location: "online",
        text: "Placeholder inquiry text. Structure preserved; wording replaced.",
        url: "https://highered.wyzant.com/tutor/jobs/8394201",
        postedAt: "2026-08-27T13:00:00.000Z",
        // Both cards on the real board read `None`. That is the common case
        // the owner's rule exists for, not an edge case.
        recommendedRate: "Recommended rate: None",
      },
      {
        nativeId: "8393796",
        author: "Placeholder Learner B",
        subject: "Study Skills",
        location: undefined,
        text: "Placeholder inquiry text. Structure preserved; wording replaced.",
        url: "https://highered.wyzant.com/tutor/jobs/8393796",
        postedAt: "2026-08-27T06:00:00.000Z",
        recommendedRate: "Recommended rate: None",
      },
    ]);
    await page.close();
  });

  it("skips and names one malformed card without losing valid neighbors", async () => {
    const page = await browser.newPage();
    const html = await readFile(
      new URL("./fixtures/wyzant-board.real-capture.html", import.meta.url),
      "utf8",
    );
    await page.setContent(html.replace("5h", "unknown-time"));
    const failures: Array<{ nativeId: string; reason: string }> = [];
    const jobs = await extractJobs(page, {
      now: Date.parse("2026-08-27T18:00:00.000Z"),
      onMalformedJob: (failure) => failures.push(failure),
    });

    expect(jobs.map((job) => job.nativeId)).toEqual(["8393796"]);
    expect(failures).toEqual([
      {
        nativeId: "8394201",
        reason: "Wyzant job is missing a recognizable posted time.",
      },
    ]);
    await page.close();
  });

  it.each([
    ["12m", 12],
    ["5h", 300],
    ["2d", 2_880],
    ["3w", 30_240],
    ["2mo", 86_400],
    ["an hour ago", 60],
    ["a day ago", 1_440],
    ["2 months ago", 86_400],
  ])("parses Wyzant relative time %s", (value, minutes) => {
    const now = Date.parse("2026-08-27T18:00:00.000Z");
    expect(parseWyzantPostedAt(value, now)).toBe(
      new Date(now - minutes * 60_000).toISOString(),
    );
  });

  it("accepts JSON in hosted runs and a file path for local diagnosis", () => {
    const state = { cookies: [], origins: [] };
    expect(
      resolveWyzantStorageState({
        WYZANT_STORAGE_STATE_JSON: JSON.stringify(state),
        WYZANT_STORAGE_STATE_PATH: "playwright/.auth/ignored.json",
      }),
    ).toEqual(state);
    expect(
      resolveWyzantStorageState({
        WYZANT_STORAGE_STATE_PATH: "playwright/.auth/wyzant.json",
      }),
    ).toBe("playwright/.auth/wyzant.json");
    expect(() => resolveWyzantStorageState({})).toThrow(
      "WYZANT_STORAGE_STATE_JSON or WYZANT_STORAGE_STATE_PATH is required",
    );
  });

  it.each([
    ["https://www.wyzant.com/login?ReturnUrl=/tutor/jobs", "expired"],
    ["https://www.wyzant.com/tutor/messaging", "jobs feed"],
    ["https://wyzant.com.evil.test/tutor/jobs", "official HTTPS"],
    ["http://www.wyzant.com/tutor/jobs", "official HTTPS"],
  ])("negative-probes authenticated feed clause for %s", (url, message) => {
    expect(() => assertAuthenticatedWyzantFeedUrl(url)).toThrow(message);
  });

  it("uses a distinct authentication error for a login redirect", () => {
    expect(() =>
      assertAuthenticatedWyzantFeedUrl(
        "https://www.wyzant.com/login?ReturnUrl=/tutor/jobs",
      ),
    ).toThrow(WyzantAuthenticationError);
  });
});
