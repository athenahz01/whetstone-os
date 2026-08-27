import { chromium } from "playwright";
import {
  assertAuthenticatedWyzantFeedUrl,
  DEFAULT_WYZANT_FEED_URL,
  extractCompleteWyzantBoard,
  filterWyzantJobs,
  parseWyzantPostedAt,
  resolveWyzantStorageState,
} from "../lib/adapters/wyzant";

const feedUrl = process.env.WYZANT_FEED_URL?.trim() || DEFAULT_WYZANT_FEED_URL;
const browser = await chromium.launch({
  headless: process.env.WYZANT_HEADLESS !== "false",
});

try {
  const context = await browser.newContext({
    storageState: resolveWyzantStorageState(),
  });
  const page = await context.newPage();
  await page.goto(feedUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  assertAuthenticatedWyzantFeedUrl(page.url());
  if ((await page.locator('input[type="password"]').count()) > 0) {
    throw new Error("Wyzant displayed a sign-in form.");
  }
  const diagnosedAt = Date.now();
  const failures: Array<{ nativeId: string; reason: string }> = [];
  const board = await extractCompleteWyzantBoard(page, {
    now: diagnosedAt,
    onMalformedJob: (failure) => failures.push(failure),
  });
  const jobs = board.jobs;
  const rejectedSubjectLabels = new Set<string>();
  filterWyzantJobs(
    jobs,
    {
      targetSubjects: split(
        process.env.WYZANT_TARGET_SUBJECTS,
        "College Counseling|English|Essay Writing|SAT Reading",
      ),
      targetLocations: split(
        process.env.WYZANT_TARGET_LOCATIONS,
        "Manhattan|New York, NY",
      ),
      includeOnlineJobs: process.env.WYZANT_INCLUDE_ONLINE_JOBS !== "false",
    },
    (subject) => rejectedSubjectLabels.add(subject),
  );
  const visibleCards = await page.locator("div.academy-card").evaluateAll(
    (cards, baseUrl) =>
      cards.map((card) => {
        const link =
          card.querySelector<HTMLAnchorElement>("a.job-details-link");
        const href = new URL(link?.getAttribute("href") ?? "", baseUrl);
        const cardText = (card.textContent ?? "").replace(/\s+/g, " ").trim();
        return {
          nativeId: href.pathname.split("/").filter(Boolean).at(-1) ?? "",
          author:
            card
              .querySelector("p.text-semibold.spc-zero-n.spc-tiny-s")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ?? "",
          subject: link?.textContent?.replace(/\s+/g, " ").trim() ?? "",
          location: cardText.match(
            /(?:Online|Remote|[A-Za-z ]+,\s*[A-Z]{2})/i,
          )?.[0],
          text:
            card
              .querySelector("p.spc-zero-s.job-description")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ?? "",
          url: href.toString(),
          postedAt:
            card
              .querySelector(".pull-right .text-semibold.text-light")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ?? "",
        };
      }),
    page.url(),
  );
  const fields = [
    "nativeId",
    "author",
    "subject",
    "location",
    "text",
    "url",
    "postedAt",
  ] as const;
  const fieldMatches = Object.fromEntries(
    fields.map((field) => {
      const matched = visibleCards.filter((visible) => {
        const parsed = jobs.find((job) => job.nativeId === visible.nativeId);
        if (!parsed) return false;
        const expected =
          field === "postedAt"
            ? parseWyzantPostedAt(visible.postedAt, diagnosedAt)
            : visible[field];
        return parsed[field] === expected;
      }).length;
      return [field, { matched, total: visibleCards.length }];
    }),
  );
  console.info("[wyzant-diagnose:read-only]", {
    authenticatedFeed: true,
    populated: jobs.length > 0,
    jobs: jobs.length,
    boardExpectedCount: board.expectedCount ?? "unavailable",
    extractedDistinctCards: board.extractedCount,
    inventoryComplete: board.complete,
    rejectedSubjectLabels: [...rejectedSubjectLabels].sort(),
    fieldCoverage: Object.fromEntries(
      fields.map((field) => [
        field,
        {
          present: jobs.filter((job) => Boolean(job[field])).length,
          total: jobs.length,
        },
      ]),
    ),
    fieldMatches,
    malformedCards: failures,
    piiPrinted: false,
    productionIngestCalled: false,
  });
  await context.close();
} finally {
  await browser.close();
}

function split(value: string | undefined, fallback: string): string[] {
  return (value || fallback)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}
