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
      const jobs = await extractJobs(page);
      return jobs
        .filter((job) => this.isTarget(job))
        .map((job) => ({
          id: stableLeadId(this.name, job.nativeId),
          channel: this.name,
          author: "Wyzant learner",
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

  private isTarget(job: ScrapedJob): boolean {
    const subject = `${job.subject ?? ""} ${job.text}`.toLowerCase();
    const subjectMatch = this.options.targetSubjects.some((target) =>
      subject.includes(target.toLowerCase()),
    );
    const location = (job.location ?? "").toLowerCase();
    const online = /\bonline\b|\bremote\b/.test(location);
    const locationMatch = this.options.targetLocations.some((target) =>
      location.includes(target.toLowerCase()),
    );
    return (
      subjectMatch &&
      (locationMatch || (online && this.options.includeOnlineJobs))
    );
  }
}

interface ScrapedJob {
  nativeId: string;
  text: string;
  subject?: string;
  location?: string;
  url: string;
  postedAt: string;
}

async function extractJobs(page: Page): Promise<ScrapedJob[]> {
  const raw = await page
    .locator("a[href*='/tutoring-job/']")
    .evaluateAll((links) =>
      links.map((link) => {
        const anchor = link as HTMLAnchorElement;
        const card =
          anchor.closest("article, li, [class*='job'], [class*='card']") ??
          anchor;
        const text = (card.textContent ?? "").replace(/\s+/g, " ").trim();
        const href = anchor.href;
        const id = href.match(/tutoring-job\/(\d+)/i)?.[1] ?? href;
        const subject =
          card
            .querySelector("[class*='subject'], h2, h3")
            ?.textContent?.trim() || undefined;
        const location =
          card.querySelector("[class*='location']")?.textContent?.trim() ||
          text.match(/(?:Online|Remote|[A-Za-z ]+,\s*[A-Z]{2})/)?.[0];
        return { nativeId: id, text, subject, location, url: href };
      }),
    );

  const now = new Date().toISOString();
  return raw
    .filter((job) => isOfficialWyzantUrl(job.url) && job.text.length > 0)
    .map((job) => ({ ...job, postedAt: now }));
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
