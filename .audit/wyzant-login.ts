/**
 * Local-only helper: produce the WYZANT_STORAGE_STATE_JSON secret safely.
 *
 * Opens a visible browser, waits for you to sign in by hand, then saves the
 * session - filtered to wyzant.com only. The raw Playwright export carries
 * Facebook, LinkedIn and DoubleClick cookies; those must never reach a GitHub
 * secret, so they are stripped here rather than by hand afterwards.
 *
 * Run from the repository root:
 *   pnpm exec playwright install chromium
 *   pnpm exec tsx .audit/wyzant-login.ts
 *
 * Prints no cookie values and no session token. Never calls production ingest.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const LOGIN_URL = "https://www.wyzant.com/login";
// The real tutor board lives on a subdomain (highered.wyzant.com), not www.
// Accept any wyzant.com host so this does not break when they move it again.
const FEED_URL = "https://highered.wyzant.com/tutor/jobs";
const OUTPUT = "playwright/.auth/wyzant-state.json";
const WAIT_MINUTES = 10;

function isWyzantDomain(domain: string): boolean {
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
    const url = page.url();
    if (
      isTutorJobsFeed(url) &&
      (await page.locator('input[type="password"]').count()) === 0
    ) {
      console.info(`Detected the jobs feed at ${new URL(url).origin}`);
      signedIn = true;
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (!signedIn) {
    // Give a signed-in-but-elsewhere session one chance to prove itself.
    await page.goto(FEED_URL, { waitUntil: "domcontentloaded" });
    if (
      !isTutorJobsFeed(page.url()) ||
      (await page.locator('input[type="password"]').count()) > 0
    ) {
      throw new Error(
        "Did not reach the authenticated tutor jobs feed. Nothing was saved.",
      );
    }
  }

  const raw = await context.storageState();
  const cookies = raw.cookies.filter((cookie) => isWyzantDomain(cookie.domain));
  const origins = raw.origins.filter((entry) => isWyzantOrigin(entry.origin));
  const dropped = raw.cookies.length - cookies.length;

  if (cookies.length === 0) {
    throw new Error("No wyzant.com cookies were captured. Nothing was saved.");
  }

  await mkdir("playwright/.auth", { recursive: true });
  await writeFile(OUTPUT, JSON.stringify({ cookies, origins }), "utf8");

  // Report the LONGEST-lived persistent cookie, not the shortest. The shortest
  // is always some CSRF or page token that Wyzant reissues on every request,
  // and reporting it says nothing about how long this session is good for.
  const nowSeconds = Date.now() / 1000;
  const persistent = cookies
    .map((cookie) => cookie.expires)
    .filter(
      (value): value is number =>
        typeof value === "number" && value > nowSeconds,
    );
  const longest = persistent.length ? Math.max(...persistent) : null;
  const sessionOnly = cookies.length - persistent.length;

  console.info("\n[wyzant-login:saved]", {
    path: OUTPUT,
    wyzantCookies: cookies.length,
    thirdPartyCookiesDropped: dropped,
    origins: origins.length,
    feedOrigin: new URL(page.url()).origin,
    longestLivedCookieExpiry: longest
      ? new Date(longest * 1000).toISOString()
      : "session cookies only",
    sessionOrAlreadyExpiredCookies: sessionOnly,
    valuesPrinted: false,
  });
  console.info(
    `\nCopy it to the clipboard, then paste into the GitHub secret:\n` +
      `  Get-Content ${OUTPUT} -Raw | Set-Clipboard\n`,
  );

  await context.close();
} finally {
  await browser.close();
}
