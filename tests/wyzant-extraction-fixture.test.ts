import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertAuthenticatedWyzantFeedUrl,
  extractJobs,
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
