import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright";
import { stableLeadId } from "../core/stable-id";
import type { ChannelAdapter, Lead } from "../core/types";

export interface WyzantAdapterOptions {
  storageState: BrowserContextOptions["storageState"];
  feedUrl: string;
  targetSubjects: string[];
  targetLocations: string[];
  includeOnlineJobs: boolean;
  tutorId?: string;
  headless?: boolean;
  browserFactory?: () => Promise<Browser>;
}

export class WyzantAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WyzantAuthenticationError";
  }
}

export class WyzantAdapter implements ChannelAdapter {
  readonly name = "wyzant";

  constructor(private readonly options: WyzantAdapterOptions) {
    if (!isOfficialWyzantUrl(options.feedUrl)) {
      throw new Error("Wyzant feed URL must use HTTPS on wyzant.com.");
    }
  }

  async poll(): Promise<Lead[]> {
    const browser = await (this.options.browserFactory
      ? this.options.browserFactory()
      : chromium.launch({ headless: this.options.headless ?? true }));
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({
        storageState: this.options.storageState,
      });
      const page = await context.newPage();
      await page.goto(this.options.feedUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      if (!isOfficialWyzantUrl(page.url())) {
        throw new Error(
          "Wyzant session navigated outside the official domain.",
        );
      }
      assertAuthenticatedWyzantFeedUrl(page.url());
      if ((await page.locator('input[type="password"]').count()) > 0) {
        throw new WyzantAuthenticationError(
          "Wyzant displayed a sign-in form instead of the tutor jobs feed.",
        );
      }
      const jobs = await extractJobs(page);
      return jobs.map((job) => ({
        id: stableLeadId(this.name, job.nativeId),
        channel: this.name,
        author: job.author,
        text: job.text,
        subject: job.subject,
        location: job.location,
        url: job.url,
        postedAt: job.postedAt,
        tutorId: this.options.tutorId,
        raw: { nativeId: job.nativeId },
      }));
    } finally {
      await context?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  async send(lead: Lead, approvedMessage: string) {
    void approvedMessage;
    if (!isOfficialWyzantUrl(lead.url)) {
      throw new Error("Refusing to prepare a reply outside wyzant.com.");
    }
    return { prefillUrl: lead.url };
  }
}

export interface WyzantJobSnapshot {
  nativeId: string;
  author: string;
  text: string;
  subject?: string;
  location?: string;
  url: string;
  postedAt: string;
}

export async function extractJobs(page: Page): Promise<WyzantJobSnapshot[]> {
  const raw = await page
    .locator("a[href*='/tutor/jobs/'], a[href*='/tutoring-job/']")
    .evaluateAll((links) =>
      links.flatMap((link) => {
        const anchor = link as HTMLAnchorElement;
        const card =
          anchor.closest(
            "article, li, [data-testid*='job'], [data-job-id], [class*='job'], [class*='card']",
          ) ?? anchor;
        const text = (card.textContent ?? "").replace(/\s+/g, " ").trim();
        const href = new URL(anchor.href, window.location.href).toString();
        const id =
          card.getAttribute("data-job-id") ||
          new URL(href).searchParams.get("jobId") ||
          new URL(href).searchParams.get("id") ||
          new URL(href).pathname.split("/").filter(Boolean).at(-1) ||
          href;
        const subject =
          card
            .querySelector(
              "[data-testid*='subject'], [class*='subject'], h2, h3, h4",
            )
            ?.textContent?.replace(/\s+/g, " ")
            .trim() ||
          anchor.textContent?.replace(/\s+/g, " ").trim() ||
          undefined;
        const location =
          card
            .querySelector("[data-testid*='location'], [class*='location']")
            ?.textContent?.replace(/\s+/g, " ")
            .trim() ||
          text.match(/(?:Online|Remote|[A-Za-z ]+,\s*[A-Z]{2})/)?.[0];
        const description =
          card
            .querySelector(
              "[data-testid*='description'], [class*='description'], p",
            )
            ?.textContent?.replace(/\s+/g, " ")
            .trim() || text;
        const author =
          card
            .querySelector("[data-testid*='author'], [class*='author']")
            ?.textContent?.replace(/\s+/g, " ")
            .trim() ||
          text
            .match(
              /posted\s+by\s+(.+?)(?:\s+\d+\s+(?:minute|hour|day|week)|$)/i,
            )?.[1]
            ?.trim() ||
          "Wyzant learner";
        const time = card.querySelector("time");
        const postedAt =
          time?.getAttribute("datetime") ||
          text.match(
            /(?:just now|yesterday|\d+\s+(?:minute|hour|day|week)s?\s+ago)/i,
          )?.[0] ||
          "";
        return text && subject
          ? [
              {
                nativeId: id,
                author,
                text: description,
                subject,
                location,
                url: href,
                postedAt,
              },
            ]
          : [];
      }),
    );

  return raw
    .filter((job) => isOfficialWyzantUrl(job.url) && job.text.length > 0)
    .map((job) => ({
      ...job,
      postedAt: parseWyzantPostedAt(job.postedAt),
    }));
}

export function parseWyzantPostedAt(
  value: string,
  now: number = Date.now(),
): string {
  const absolute = Date.parse(value);
  if (Number.isFinite(absolute)) return new Date(absolute).toISOString();
  const normalized = value.trim().toLowerCase();
  if (normalized === "just now") return new Date(now).toISOString();
  if (normalized.includes("yesterday"))
    return new Date(now - 86_400_000).toISOString();
  const relative = normalized.match(/(\d+)\s*(minute|hour|day|week)s?\s+ago/);
  if (!relative) {
    throw new Error("Wyzant job is missing a recognizable posted time.");
  }
  const minutes = { minute: 1, hour: 60, day: 1_440, week: 10_080 }[
    relative[2] as "minute" | "hour" | "day" | "week"
  ];
  return new Date(now - Number(relative[1]) * minutes * 60_000).toISOString();
}

export function isOfficialWyzantUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "wyzant.com" || url.hostname.endsWith(".wyzant.com"))
    );
  } catch {
    return false;
  }
}

export function officialWyzantUrl(value: string): URL {
  if (!isOfficialWyzantUrl(value)) {
    throw new Error("Wyzant URL must use an official HTTPS origin.");
  }
  return new URL(value);
}

export function assertAuthenticatedWyzantFeedUrl(value: string): void {
  const url = officialWyzantUrl(value);
  if (url.pathname.startsWith("/login")) {
    throw new WyzantAuthenticationError(
      "The operator-owned Wyzant session is expired.",
    );
  }
  if (!url.pathname.startsWith("/tutor/jobs")) {
    throw new WyzantAuthenticationError(
      "Wyzant did not remain on the authenticated tutor jobs feed.",
    );
  }
}

export function parseWyzantStorageState(
  rawState: string | undefined = process.env.WYZANT_STORAGE_STATE_JSON,
): NonNullable<BrowserContextOptions["storageState"]> {
  if (!rawState?.trim())
    throw new Error("WYZANT_STORAGE_STATE_JSON is required.");
  try {
    return JSON.parse(rawState) as NonNullable<
      BrowserContextOptions["storageState"]
    >;
  } catch {
    throw new Error("WYZANT_STORAGE_STATE_JSON must contain valid JSON.");
  }
}

export function createWyzantAdapterFromEnv(): WyzantAdapter {
  return new WyzantAdapter({
    storageState: parseWyzantStorageState(),
    feedUrl:
      process.env.WYZANT_FEED_URL?.trim() ||
      "https://www.wyzant.com/tutor/jobs",
    targetSubjects: split(
      process.env.WYZANT_TARGET_SUBJECTS,
      "College Counseling|English|Essay Writing|SAT Reading",
    ),
    targetLocations: split(
      process.env.WYZANT_TARGET_LOCATIONS,
      "Manhattan|New York, NY",
    ),
    includeOnlineJobs: process.env.WYZANT_INCLUDE_ONLINE_JOBS !== "false",
    tutorId: process.env.WYZANT_TUTOR_ID?.trim() || undefined,
    headless: process.env.WYZANT_HEADLESS !== "false",
  });
}

function split(value: string | undefined, fallback: string): string[] {
  return (value || fallback)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}
