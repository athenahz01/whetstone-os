import { chromium } from "playwright";
import {
  assertAuthenticatedWyzantFeedUrl,
  extractJobs,
  parseWyzantStorageState,
} from "../lib/adapters/wyzant";

const feedUrl =
  process.env.WYZANT_FEED_URL?.trim() || "https://www.wyzant.com/tutor/jobs";
const browser = await chromium.launch({
  headless: process.env.WYZANT_HEADLESS !== "false",
});

try {
  const context = await browser.newContext({
    storageState: parseWyzantStorageState(),
  });
  const page = await context.newPage();
  await page.goto(feedUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  assertAuthenticatedWyzantFeedUrl(page.url());
  if ((await page.locator('input[type="password"]').count()) > 0) {
    throw new Error("Wyzant displayed a sign-in form.");
  }
  const jobs = await extractJobs(page);
  const fields = [
    "nativeId",
    "author",
    "subject",
    "location",
    "text",
    "url",
    "postedAt",
  ] as const;
  console.info("[wyzant-diagnose:read-only]", {
    authenticatedFeed: true,
    populated: jobs.length > 0,
    jobs: jobs.length,
    fieldCoverage: Object.fromEntries(
      fields.map((field) => [
        field,
        jobs.length > 0 && jobs.every((job) => Boolean(job[field])),
      ]),
    ),
    piiPrinted: false,
    productionIngestCalled: false,
  });
  await context.close();
} finally {
  await browser.close();
}
