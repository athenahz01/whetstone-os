import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import {
  assertAuthenticatedWyzantFeedUrl,
  resolveWyzantStorageState,
} from "../lib/adapters/wyzant";

const feedUrl =
  process.env.WYZANT_FEED_URL?.trim() || "https://www.wyzant.com/tutor/jobs";
const outputPath =
  process.env.WYZANT_CAPTURE_OUTPUT?.trim() || "playwright/.auth/board.html";
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    storageState: resolveWyzantStorageState(),
  });
  const page = await context.newPage();
  await page.goto(feedUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  assertAuthenticatedWyzantFeedUrl(page.url());
  await writeFile(outputPath, await page.content(), "utf8");
  const structure = await page.evaluate(() => ({
    cards: document.querySelectorAll("div.academy-card").length,
    jobLinks: document.querySelectorAll("a.job-details-link").length,
    timeElements: document.querySelectorAll("time").length,
    compactTimes: document.querySelectorAll(
      ".pull-right .text-semibold.text-light",
    ).length,
  }));
  console.info("[wyzant-capture:local-only]", {
    finalUrl: page.url(),
    outputPath,
    ...structure,
    piiPrinted: false,
    productionIngestCalled: false,
  });
  await context.close();
} finally {
  await browser.close();
}
