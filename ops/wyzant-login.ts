/**
 * Local-only helper that produces the WYZANT_STORAGE_STATE_JSON secret.
 * It opens a headed browser, waits for an operator login, and writes only
 * wyzant.com cookies and origins. It never calls production ingest.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type BrowserContext } from "playwright";
import { DEFAULT_WYZANT_FEED_URL } from "../lib/adapters/wyzant";

const LOGIN_URL = "https://www.wyzant.com/login";
const OUTPUT = "playwright/.auth/wyzant-state.json";
const WAIT_MINUTES = 10;

export type WyzantStorageState = Awaited<
  ReturnType<BrowserContext["storageState"]>
>;

export interface WyzantLoginReport {
  path: string;
  wyzantCookies: number;
  thirdPartyCookiesDropped: number;
  thirdPartyOriginsDropped: number;
  origins: number;
  feedOrigin: string;
  longestLivedCookieExpiry: string;
  sessionOrAlreadyExpiredCookies: number;
  valuesPrinted: false;
}

export function isWyzantDomain(domain: string): boolean {
  const host = domain.replace(/^\./, "").toLowerCase();
  return host === "wyzant.com" || host.endsWith(".wyzant.com");
}

function isTutorJobsFeed(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      isWyzantDomain(url.hostname) &&
      url.pathname.startsWith("/tutor/jobs")
    );
  } catch {
    return false;
  }
}

function isWyzantOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && isWyzantDomain(url.hostname);
  } catch {
    return false;
  }
}

export function sanitizeWyzantStorageState(raw: WyzantStorageState): {
  state: WyzantStorageState;
  thirdPartyCookiesDropped: number;
  thirdPartyOriginsDropped: number;
} {
  const cookies = raw.cookies.filter((cookie) => isWyzantDomain(cookie.domain));
  const origins = raw.origins.filter((entry) => isWyzantOrigin(entry.origin));
  return {
    state: { cookies, origins },
    thirdPartyCookiesDropped: raw.cookies.length - cookies.length,
    thirdPartyOriginsDropped: raw.origins.length - origins.length,
  };
}

export async function persistWyzantStorageState(input: {
  raw: WyzantStorageState;
  output: string;
  feedUrl: string;
  now?: number;
  makeDirectory?: (path: string) => Promise<unknown>;
  write?: (path: string, value: string) => Promise<unknown>;
  log?: (message: string, detail: WyzantLoginReport) => void;
}): Promise<WyzantLoginReport> {
  const filtered = sanitizeWyzantStorageState(input.raw);
  if (filtered.state.cookies.length === 0) {
    throw new Error("No wyzant.com cookies were captured. Nothing was saved.");
  }

  await (
    input.makeDirectory ?? (async (path) => mkdir(path, { recursive: true }))
  )(dirname(input.output));
  await (
    input.write ?? (async (path, value) => writeFile(path, value, "utf8"))
  )(input.output, JSON.stringify(filtered.state));

  const nowSeconds = (input.now ?? Date.now()) / 1000;
  const persistent = filtered.state.cookies
    .map((cookie) => cookie.expires)
    .filter(
      (value): value is number =>
        typeof value === "number" && value > nowSeconds,
    );
  const longest = persistent.length ? Math.max(...persistent) : null;
  const report: WyzantLoginReport = {
    path: input.output,
    wyzantCookies: filtered.state.cookies.length,
    thirdPartyCookiesDropped: filtered.thirdPartyCookiesDropped,
    thirdPartyOriginsDropped: filtered.thirdPartyOriginsDropped,
    origins: filtered.state.origins.length,
    feedOrigin: new URL(input.feedUrl).origin,
    longestLivedCookieExpiry: longest
      ? new Date(longest * 1000).toISOString()
      : "session cookies only",
    sessionOrAlreadyExpiredCookies:
      filtered.state.cookies.length - persistent.length,
    valuesPrinted: false,
  };
  (input.log ?? console.info)("[wyzant-login:saved]", report);
  return report;
}

export async function runWyzantLogin(): Promise<void> {
  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

    console.info(
      `\nSign in as Whetstone's own Wyzant account in the window that opened.\n` +
        `Waiting up to ${WAIT_MINUTES} minutes for the tutor jobs feed.\n`,
    );

    const deadline = Date.now() + WAIT_MINUTES * 60_000;
    let signedIn = false;
    while (Date.now() < deadline) {
      if (
        isTutorJobsFeed(page.url()) &&
        (await page.locator('input[type="password"]').count()) === 0
      ) {
        console.info(`Detected the jobs feed at ${new URL(page.url()).origin}`);
        signedIn = true;
        break;
      }
      await page.waitForTimeout(2_000);
    }

    if (!signedIn) {
      await page.goto(DEFAULT_WYZANT_FEED_URL, {
        waitUntil: "domcontentloaded",
      });
      if (
        !isTutorJobsFeed(page.url()) ||
        (await page.locator('input[type="password"]').count()) > 0
      ) {
        throw new Error(
          "Did not reach the authenticated tutor jobs feed. Nothing was saved.",
        );
      }
    }

    await persistWyzantStorageState({
      raw: await context.storageState(),
      output: OUTPUT,
      feedUrl: page.url(),
    });
    console.info(
      `\nCopy it to the clipboard, then paste into the GitHub secret:\n` +
        `  Get-Content ${OUTPUT} -Raw | Set-Clipboard\n`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  await runWyzantLogin();
}
