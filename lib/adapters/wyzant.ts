import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright";
import { activateAllowedControl, findAllowedControl } from "./interaction";
import { stableLeadId } from "../core/stable-id";
import type { AdapterException, ChannelAdapter, Lead } from "../core/types";

export const DEFAULT_WYZANT_FEED_URL = "https://highered.wyzant.com/tutor/jobs";
export type WyzantLessonType = "online" | "in_person";

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
  private extractionExceptions: AdapterException[] = [];

  constructor(private readonly options: WyzantAdapterOptions) {
    if (!isOfficialWyzantUrl(options.feedUrl)) {
      throw new Error("Wyzant feed URL must use HTTPS on wyzant.com.");
    }
  }

  async poll(): Promise<Lead[]> {
    this.extractionExceptions = [];
    const jobs = await withWyzantBrowserRetry(
      () =>
        this.options.browserFactory
          ? this.options.browserFactory()
          : chromium.launch({ headless: this.options.headless ?? true }),
      async (browser) => {
        const context = await browser.newContext({
          storageState: this.options.storageState,
        });
        try {
          return await collectConfiguredWyzantJobs(
            this.options,
            async (url, lessonType) =>
              readWyzantRoute(
                context,
                url,
                {
                  assertUrl: assertAuthenticatedWyzantFeedUrl,
                  readySelector: "body",
                },
                async (page) => {
                  await assertAuthenticatedWyzantPage(page);
                  const board = await extractCompleteWyzantBoard(page, {
                    lessonType,
                    onMalformedJob: ({ nativeId, reason }) => {
                      this.recordExtractionException({
                        kind: "WyzantJobMalformed",
                        severity: "warning",
                        message: `${nativeId}: ${reason}`,
                      });
                    },
                  });
                  if (!board.complete) {
                    this.recordExtractionException({
                      kind: "WyzantBoardInventoryMismatch",
                      severity: "critical",
                      message:
                        board.expectedCount === undefined
                          ? `${lessonType} view: Wyzant board count was unavailable; ${board.extractedCount} distinct cards were extracted.`
                          : `${lessonType} view: Wyzant board reported ${board.expectedCount} jobs but ${board.extractedCount} distinct cards were extracted.`,
                    });
                  }
                  return board.jobs;
                },
              ),
            {
              onRejectedSubjects: (subjects) => {
                this.recordExtractionException({
                  kind: "WyzantSubjectsRejected",
                  severity: "warning",
                  message: `Rejected Wyzant subject labels: ${subjects.join(" | ")}`,
                });
              },
            },
          );
        } finally {
          await context.close().catch(() => undefined);
        }
      },
    );
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
      raw: { nativeId: job.nativeId, lessonType: job.lessonType },
    }));
  }

  async send(lead: Lead, approvedMessage: string) {
    void approvedMessage;
    if (!isOfficialWyzantUrl(lead.url)) {
      throw new Error("Refusing to prepare a reply outside wyzant.com.");
    }
    return { prefillUrl: lead.url };
  }

  drainExceptions(): AdapterException[] {
    const exceptions = this.extractionExceptions;
    this.extractionExceptions = [];
    return exceptions;
  }

  private recordExtractionException(exception: AdapterException): void {
    if (
      !this.extractionExceptions.some(
        (existing) =>
          existing.kind === exception.kind &&
          existing.message === exception.message,
      )
    ) {
      this.extractionExceptions.push(exception);
    }
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
  lessonType?: WyzantLessonType;
}

export interface WyzantExtractionFailure {
  nativeId: string;
  reason: string;
}

export interface ExtractJobsOptions {
  now?: number;
  lessonType?: WyzantLessonType;
  onMalformedJob?: (failure: WyzantExtractionFailure) => void;
}

export interface WyzantBoardReadResult {
  jobs: WyzantJobSnapshot[];
  expectedCount?: number;
  extractedCount: number;
  complete: boolean;
}

export async function extractJobs(
  page: Page,
  options: ExtractJobsOptions = {},
): Promise<WyzantJobSnapshot[]> {
  const pageUrl = page.url();
  const baseUrl = isOfficialWyzantUrl(pageUrl)
    ? pageUrl
    : "https://highered.wyzant.com/tutor/jobs";
  const raw = await page
    .locator("a[href*='/tutor/jobs/'], a[href*='/tutoring-job/']")
    .evaluateAll(
      (links, resolvedBaseUrl) =>
        links.flatMap((link) => {
          const anchor = link as HTMLAnchorElement;
          const card =
            anchor.closest("div.academy-card") ??
            anchor.closest(
              "article, li, [data-testid*='job'], [data-job-id], [class*='job'], [class*='card']",
            ) ??
            anchor;
          const text = (card.textContent ?? "").replace(/\s+/g, " ").trim();
          const rawHref = anchor.getAttribute("href") ?? anchor.href;
          let href = rawHref;
          let resolvedUrl: URL | undefined;
          try {
            resolvedUrl = new URL(rawHref, resolvedBaseUrl);
            href = resolvedUrl.toString();
          } catch {
            // Preserve the malformed href so per-card normalization can name and
            // record this card without aborting extraction of its neighbors.
          }
          const id =
            card.getAttribute("data-job-id") ||
            resolvedUrl?.searchParams.get("jobId") ||
            resolvedUrl?.searchParams.get("id") ||
            resolvedUrl?.pathname.split("/").filter(Boolean).at(-1) ||
            rawHref ||
            "unknown-job";
          const subject =
            card
              .querySelector("a.job-details-link")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ||
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
            text.match(/(?:Online|Remote|[A-Za-z ]+,\s*[A-Z]{2})/i)?.[0];
          const description =
            card
              .querySelector("p.spc-zero-s.job-description")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ||
            card
              .querySelector(
                "[data-testid*='description'], [class*='description'], p",
              )
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ||
            text;
          const author =
            card
              .querySelector("p.text-semibold.spc-zero-n.spc-tiny-s")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ||
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
            card
              .querySelector(".pull-right .text-semibold.text-light")
              ?.textContent?.replace(/\s+/g, " ")
              .trim() ||
            text.match(
              /(?:just now|yesterday|\d+\s*(?:mo|m|h|d|w)\b|(?:\d+|a|an)\s+(?:minute|hour|day|week|month)s?\s+ago)/i,
            )?.[0] ||
            "";
          return [
            {
              nativeId: id,
              author,
              text: description,
              subject,
              location,
              url: href,
              postedAt,
            },
          ];
        }),
      baseUrl,
    );

  const jobs: WyzantJobSnapshot[] = [];
  for (const job of raw) {
    try {
      if (!isOfficialWyzantUrl(job.url)) throw new Error("job URL is invalid");
      if (!job.subject?.trim()) throw new Error("job subject is missing");
      if (!job.text.trim()) throw new Error("job description is missing");
      jobs.push({
        ...job,
        postedAt: parseWyzantPostedAt(job.postedAt, options.now),
        ...(options.lessonType ? { lessonType: options.lessonType } : {}),
      });
    } catch (error) {
      options.onMalformedJob?.({
        nativeId: job.nativeId,
        reason:
          error instanceof Error
            ? error.message
            : "job could not be normalized",
      });
    }
  }
  return jobs;
}

export async function extractCompleteWyzantBoard(
  page: Page,
  options: ExtractJobsOptions = {},
): Promise<WyzantBoardReadResult> {
  const expectedCount = await readWyzantBoardCount(page);
  const jobsById = new Map<string, WyzantJobSnapshot>();
  const maxTransitions = Math.min(50, (expectedCount ?? 1) + 1);

  for (let transition = 0; transition < maxTransitions; transition += 1) {
    for (const job of await extractJobs(page, options)) {
      jobsById.set(job.nativeId, job);
    }
    if (expectedCount !== undefined && jobsById.size === expectedCount) break;

    const advanced = await advanceWyzantBoard(page);
    if (!advanced) break;
    assertAuthenticatedWyzantFeedUrl(page.url());
  }

  const jobs = [...jobsById.values()];
  return {
    jobs,
    ...(expectedCount === undefined ? {} : { expectedCount }),
    extractedCount: jobs.length,
    complete: expectedCount !== undefined && jobs.length === expectedCount,
  };
}

export async function readWyzantBoardCount(
  page: Page,
): Promise<number | undefined> {
  const countLocator = page
    .locator(".jobs-tutor-header h2.light-header span.text-bold")
    .first();
  const text =
    (await countLocator.count()) > 0
      ? await countLocator.textContent().catch(() => null)
      : null;
  const match = text?.replace(/,/g, "").match(/\d+/);
  if (match) return Number(match[0]);

  const cards = await page.locator("div.academy-card").count();
  if (cards === 0 && (await page.locator("#jobs-list").count()) > 0) return 0;
  return undefined;
}

async function advanceWyzantBoard(page: Page): Promise<boolean> {
  const beforeUrl = page.url();
  const beforeSignature = await readWyzantJobSignature(page);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(750);
  if ((await readWyzantJobSignature(page)) !== beforeSignature) return true;

  // The only interaction this adapter performs, and it does not perform it
  // itself. See lib/adapters/interaction.ts for why that separation exists.
  const nextControl = await findAllowedControl(page);
  if (!nextControl) return false;
  await activateAllowedControl(page, nextControl);
  return page
    .waitForFunction(
      ({ previousUrl, previousSignature }) => {
        const signature = Array.from(
          document.querySelectorAll<HTMLAnchorElement>(
            "a[href*='/tutor/jobs/'], a[href*='/tutoring-job/']",
          ),
        )
          .map((link) => link.getAttribute("href") ?? link.href)
          .join("|");
        return location.href !== previousUrl || signature !== previousSignature;
      },
      { previousUrl: beforeUrl, previousSignature: beforeSignature },
      { timeout: 5_000 },
    )
    .then(() => true)
    .catch(() => false);
}

async function readWyzantJobSignature(page: Page): Promise<string> {
  return page
    .locator("a[href*='/tutor/jobs/'], a[href*='/tutoring-job/']")
    .evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? "").join("|"),
    );
}

async function assertAuthenticatedWyzantPage(page: Page): Promise<void> {
  if (!isOfficialWyzantUrl(page.url())) {
    throw new Error("Wyzant session navigated outside the official domain.");
  }
  assertAuthenticatedWyzantFeedUrl(page.url());
  if ((await page.locator('input[type="password"]').count()) > 0) {
    throw new WyzantAuthenticationError(
      "Wyzant displayed a sign-in form instead of the tutor jobs feed.",
    );
  }
}

export interface SettledWyzantPageOptions {
  assertUrl: (value: string) => void;
  readySelector: string;
  timeoutMs?: number;
  stabilityMs?: number;
}

export async function readSettledWyzantPage<T>(
  page: Page,
  options: SettledWyzantPageOptions,
  read: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await waitForSettledWyzantPage(page, options);
    try {
      const result = await read();
      options.assertUrl(page.url());
      return result;
    } catch (error) {
      if (
        attempt === 0 &&
        !page.isClosed() &&
        isTransientWyzantNavigationError(error)
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Wyzant page could not be read after navigation settled.");
}

export async function readWyzantRoute<T>(
  context: BrowserContext,
  initialUrl: string,
  options: SettledWyzantPageOptions,
  read: (page: Page) => Promise<T>,
): Promise<T> {
  let targetUrl = initialUrl;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let page: Page | undefined;
    try {
      return await withWyzantRouteTimeout(
        (async () => {
          page = await context.newPage();
          await page.goto(targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          return readSettledWyzantPage(page, options, () => read(page!));
        })(),
        (options.timeoutMs ?? 20_000) + 5_000,
      );
    } catch (error) {
      if (attempt === 0 && isTransientWyzantNavigationError(error)) {
        const landedUrl = page?.url() ?? initialUrl;
        try {
          options.assertUrl(landedUrl);
          targetUrl = landedUrl;
        } catch {
          targetUrl = initialUrl;
        }
        continue;
      }
      throw error;
    } finally {
      void page?.close().catch(() => undefined);
    }
  }
  throw new Error("Wyzant route could not be read after replacing its page.");
}

export async function withWyzantBrowserRetry<T>(
  openBrowser: () => Promise<Browser>,
  read: (browser: Browser) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const browser = await openBrowser();
    try {
      return await read(browser);
    } catch (error) {
      if (attempt === 0 && isTransientWyzantNavigationError(error)) continue;
      throw error;
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
  throw new Error("Wyzant browser session could not be replaced.");
}

async function waitForSettledWyzantPage(
  page: Page,
  options: SettledWyzantPageOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const stabilityMs = options.stabilityMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let stableUrl = "";
  let stableSince = 0;

  while (Date.now() < deadline) {
    const currentUrl = page.url();
    options.assertUrl(currentUrl);
    let ready = false;
    try {
      ready = (await page.locator(options.readySelector).count()) > 0;
    } catch (error) {
      if (!isTransientWyzantNavigationError(error)) throw error;
    }

    if (ready) {
      if (currentUrl !== stableUrl) {
        stableUrl = currentUrl;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= stabilityMs) {
        options.assertUrl(page.url());
        return;
      }
    } else {
      stableUrl = "";
      stableSince = 0;
    }
    try {
      await page.waitForTimeout(100);
    } catch (error) {
      if (!isTransientWyzantNavigationError(error)) throw error;
      if (page.isClosed()) throw error;
    }
  }
  throw new Error(
    `Wyzant page did not settle on ${options.readySelector} within ${timeoutMs}ms.`,
  );
}

export function isTransientWyzantNavigationError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(?:execution context was destroyed|target page, context or browser has been closed|frame was detached|navigation|wyzant route read timed out)/i.test(
      error.message,
    )
  );
}

async function withWyzantRouteTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`Wyzant route read timed out after ${timeoutMs}ms.`),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function configuredWyzantLessonTypes(
  includeOnlineJobs: boolean,
): WyzantLessonType[] {
  return includeOnlineJobs ? ["online", "in_person"] : ["in_person"];
}

export async function collectConfiguredWyzantJobs(
  options: Pick<
    WyzantAdapterOptions,
    "feedUrl" | "targetSubjects" | "targetLocations" | "includeOnlineJobs"
  >,
  readView: (
    url: string,
    lessonType: WyzantLessonType,
  ) => Promise<WyzantJobSnapshot[]>,
  diagnostics: {
    onRejectedSubjects?: (subjects: string[]) => void;
  } = {},
): Promise<WyzantJobSnapshot[]> {
  const jobs: WyzantJobSnapshot[] = [];
  for (const lessonType of configuredWyzantLessonTypes(
    options.includeOnlineJobs,
  )) {
    jobs.push(
      ...(await readView(
        wyzantFeedUrlForLessonType(options.feedUrl, lessonType),
        lessonType,
      )),
    );
  }
  const rejectedSubjects = new Set<string>();
  const filtered = filterWyzantJobs(jobs, options, (subject) =>
    rejectedSubjects.add(subject),
  );
  if (rejectedSubjects.size > 0) {
    diagnostics.onRejectedSubjects?.([...rejectedSubjects].sort());
  }
  return dedupeWyzantJobs(filtered);
}

export function wyzantFeedUrlForLessonType(
  feedUrl: string,
  lessonType: WyzantLessonType,
): string {
  const url = officialWyzantUrl(feedUrl);
  url.searchParams.set("subject_id", "-1");
  url.searchParams.set("lesson_type", lessonType);
  return url.toString();
}

export function dedupeWyzantJobs(
  jobs: readonly WyzantJobSnapshot[],
): WyzantJobSnapshot[] {
  return [...new Map(jobs.map((job) => [job.nativeId, job])).values()];
}

export function filterWyzantJobs(
  jobs: readonly WyzantJobSnapshot[],
  options: Pick<
    WyzantAdapterOptions,
    "targetSubjects" | "targetLocations" | "includeOnlineJobs"
  >,
  onRejectedSubject?: (subject: string) => void,
): WyzantJobSnapshot[] {
  const subjects = options.targetSubjects.map(normalizeScopeValue);
  const locations = options.targetLocations.map(normalizeScopeValue);
  return jobs.filter((job) => {
    if (!job.subject || !subjects.includes(normalizeScopeValue(job.subject))) {
      if (job.subject?.trim()) {
        onRejectedSubject?.(job.subject.trim().replace(/\s+/g, " "));
      }
      return false;
    }
    if (isOnlineWyzantJob(job)) return options.includeOnlineJobs;
    if (!job.location) return false;
    const actual = normalizeScopeValue(job.location);
    return locations.some(
      (target) => actual === target || actual.startsWith(`${target},`),
    );
  });
}

function isOnlineWyzantJob(job: WyzantJobSnapshot): boolean {
  return (
    job.lessonType === "online" ||
    /\b(?:online|remote)\b/i.test(job.location ?? "")
  );
}

function normalizeScopeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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
  const compact = normalized.match(/^(\d+)\s*(mo|m|h|d|w)$/);
  if (compact) {
    const minutes = { m: 1, h: 60, d: 1_440, w: 10_080, mo: 43_200 }[
      compact[2] as "m" | "h" | "d" | "w" | "mo"
    ];
    return new Date(now - Number(compact[1]) * minutes * 60_000).toISOString();
  }
  const relative = normalized.match(
    /^(?:(\d+)|a|an)\s*(minute|hour|day|week|month)s?\s+ago$/,
  );
  if (relative) {
    const minutes = {
      minute: 1,
      hour: 60,
      day: 1_440,
      week: 10_080,
      month: 43_200,
    }[relative[2] as "minute" | "hour" | "day" | "week" | "month"];
    return new Date(
      now - Number(relative[1] ?? 1) * minutes * 60_000,
    ).toISOString();
  }
  throw new Error("Wyzant job is missing a recognizable posted time.");
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

export function resolveWyzantStorageState(
  environment: Record<string, string | undefined> = process.env,
): NonNullable<BrowserContextOptions["storageState"]> {
  if (environment.WYZANT_STORAGE_STATE_JSON?.trim()) {
    return parseWyzantStorageState(environment.WYZANT_STORAGE_STATE_JSON);
  }
  const statePath = environment.WYZANT_STORAGE_STATE_PATH?.trim();
  if (statePath) return statePath;
  throw new Error(
    "WYZANT_STORAGE_STATE_JSON or WYZANT_STORAGE_STATE_PATH is required.",
  );
}

export function createWyzantAdapterFromEnv(): WyzantAdapter {
  return new WyzantAdapter({
    storageState: resolveWyzantStorageState(),
    feedUrl: process.env.WYZANT_FEED_URL?.trim() || DEFAULT_WYZANT_FEED_URL,
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
