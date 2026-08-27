import type { Locator, Page } from "playwright";

/**
 * The only controls a production adapter may interact with, and the only place
 * an interaction may happen.
 *
 * Pagination needed a click, and the no-automatic-submission lock grepped
 * adapter sources for `.click(`, so the click was written as
 * `dispatchEvent("click")` and the lock went blind. It still reported green
 * while an `autoSubmitProbe` calling
 * `page.locator("button[type='submit']").dispatchEvent("click")` sat in the
 * production adapter. G1 was not violated, but the guard against violating it
 * was gone, and it went quietly.
 *
 * Widening the regex to `dispatchEvent` would have bought one round. The next
 * helper reaches for `page.mouse.click` or `evaluate(el => el.click())`. So the
 * two things the lock was conflating are separated here: what is forbidden is
 * not a verb, it is touching anything that could submit.
 *
 * Every entry below advances a listing. None of them sends, applies, messages
 * or contacts anyone, and `tests/human-send-regression.test.ts` asserts that
 * about this constant rather than about a spelling.
 */
export const PAGINATION_CONTROL_SELECTORS = [
  "a[rel='next']",
  ".pagination li.next:not(.disabled) a",
  ".pagination li.active + li a",
  "[class*='pagination'] a[aria-label*='next' i]",
  "[class*='pagination'] button[aria-label*='next' i]",
  "a:has-text('Load more')",
  "button:has-text('Load more')",
  "a:has-text('Show more')",
  "button:has-text('Show more')",
  "a:has-text('Next')",
  "button:has-text('Next')",
] as const;

export type PaginationControlSelector =
  (typeof PAGINATION_CONTROL_SELECTORS)[number];

export class ForbiddenAdapterInteractionError extends Error {
  constructor(selector: string) {
    super(
      `Refusing to interact with "${selector}". A production adapter may only activate a pagination control from PAGINATION_CONTROL_SELECTORS.`,
    );
    this.name = "ForbiddenAdapterInteractionError";
  }
}

export function isAllowedControlSelector(
  selector: string,
): selector is PaginationControlSelector {
  return (PAGINATION_CONTROL_SELECTORS as readonly string[]).includes(selector);
}

/** A control found on the page, named by the allow-list entry that found it. */
export interface AllowedControl {
  selector: PaginationControlSelector;
  index: number;
}

/**
 * Finds a visible, enabled pagination control, or nothing.
 *
 * It returns the allow-list entry and an index rather than a locator, so the
 * caller cannot hand the activator a locator that points somewhere else.
 */
export async function findAllowedControl(
  page: Page,
): Promise<AllowedControl | undefined> {
  for (const selector of PAGINATION_CONTROL_SELECTORS) {
    const candidates = page.locator(selector);
    const total = await candidates.count();
    for (let index = 0; index < total; index += 1) {
      const candidate = candidates.nth(index);
      if ((await candidate.isVisible()) && (await candidate.isEnabled())) {
        return { selector, index };
      }
    }
  }
  return undefined;
}

/**
 * The single interaction in the whole adapter layer.
 *
 * It resolves the locator itself from an allow-listed selector, so there is no
 * argument a caller can pass that reaches a submit control. Anything else that
 * wants to interact has to write its own primitive into an adapter file, which
 * is exactly what the lock greps for.
 */
export async function activateAllowedControl(
  page: Page,
  control: AllowedControl,
): Promise<void> {
  if (!isAllowedControlSelector(control.selector)) {
    throw new ForbiddenAdapterInteractionError(control.selector);
  }
  const target: Locator = page.locator(control.selector).nth(control.index);
  await target.dispatchEvent("click");
}
