import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { EmailAdapter } from "../lib/adapters/email";
import { WyzantAdapter } from "../lib/adapters/wyzant";
import { CounselorsAdapter } from "../lib/adapters/counselors";
import { ReengagementAdapter } from "../lib/adapters/reengagement";
import { ReferralsAdapter } from "../lib/adapters/referrals";
import {
  activateAllowedControl,
  ForbiddenAdapterInteractionError,
  isAllowedControlSelector,
  PAGINATION_CONTROL_SELECTORS,
} from "../lib/adapters/interaction";
import { lead } from "./helpers";

const ADAPTERS = new URL("../lib/adapters/", import.meta.url);
const INTERACTION_HELPER = "interaction.ts";

/**
 * Interaction primitives. Any of these in an adapter is a second route to a
 * control, around the one helper that checks what it is touching.
 *
 * `evaluate` is not forbidden outright, because the adapter legitimately
 * scrolls with it. An `evaluate` body containing a click is a different thing
 * and is caught separately below.
 */
const INTERACTION_PRIMITIVES: [string, RegExp][] = [
  ["click", /\.click\s*\(/],
  ["dispatchEvent", /\bdispatchEvent\s*\(/],
  ["mouse", /\.mouse\s*\./],
  ["keyboard", /\.keyboard\s*\./],
  ["press", /\.press\s*\(/],
  ["tap", /\.tap\s*\(/],
  ["fill", /\.fill\s*\(/],
  ["type", /\.type\s*\(/],
  ["selectOption", /\.selectOption\s*\(/],
  ["check", /\.(?:check|uncheck)\s*\(/],
  ["submit", /\.submit\s*\(/],
  ["requestSubmit", /\brequestSubmit\s*\(/],
];

/** A click smuggled inside an evaluated page function. */
const EVALUATED_CLICK = /evaluate[\s\S]{0,400}?\.click\s*\(/;

async function adapterSources(): Promise<[string, string][]> {
  const entries = await readdir(ADAPTERS, { withFileTypes: true });
  return Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".ts") &&
          entry.name !== INTERACTION_HELPER,
      )
      .map(
        async (entry) =>
          [
            entry.name,
            await readFile(new URL(entry.name, ADAPTERS), "utf8"),
          ] as [string, string],
      ),
  );
}

describe("regression lock: no automatic submission", () => {
  it("returns prefills from every production adapter and records no send", async () => {
    const item = lead({ url: "https://www.wyzant.com/tutoring-job/42" });
    const wyzant = new WyzantAdapter({
      storageState: { cookies: [], origins: [] },
      feedUrl: "https://www.wyzant.com/tutor/jobs",
      targetSubjects: ["College Counseling"],
      targetLocations: ["Manhattan"],
      includeOnlineJobs: true,
    });
    expect(await wyzant.send(item, "Approved by a person")).toEqual({
      prefillUrl: item.url,
    });

    const email = new EmailAdapter({
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "operator@example.test",
      password: "test",
      mailbox: "INBOX",
      lookbackHours: 48,
      maxMessages: 10,
      maxBytes: 10_000,
      ownAddress: "operator@example.test",
      keywords: ["tutor"],
    });
    expect((await email.send(item, "Approved by a person")).prefillUrl).toMatch(
      /^mailto:/,
    );

    const consent = {
      recordedAt: "2026-01-10T12:00:00.000Z",
      source: "Signup checkbox",
      scope: "Email follow-up",
    };
    const adapters = [
      new ReengagementAdapter([
        { name: "Sample", email: "sample@example.test", consent },
      ]),
      new ReferralsAdapter([
        {
          name: "Sample partner",
          email: "partner@example.test",
          contactType: "professional_partner" as const,
          publicSourceUrl: "https://school.example.test/team",
        },
      ]),
      new CounselorsAdapter([
        {
          name: "Sample counselor",
          email: "counselor@example.test",
          role: "Counselor",
          organization: "Sample School",
          publicSourceUrl: "https://school.example.test/team",
        },
      ]),
    ];
    for (const adapter of adapters) {
      const [contact] = await adapter.poll();
      expect(
        (await adapter.send(contact, "Approved by a person")).prefillUrl,
      ).toMatch(/^mailto:/);
    }
  });

  /**
   * The real guard. It fails on what the interaction touches, not on how the
   * touch is spelled, because a spelling check is one rename from blind.
   */
  it("lets an adapter touch pagination controls and nothing else", () => {
    // Naming the shapes, not just counting them. An allow-list gutted to
    // nothing would make every check below vacuous and the lock would go quiet
    // rather than fail, which is how the last one went blind.
    expect(PAGINATION_CONTROL_SELECTORS.length).toBeGreaterThan(0);
    expect(PAGINATION_CONTROL_SELECTORS).toContain("a[rel='next']");
    expect(
      PAGINATION_CONTROL_SELECTORS.some((selector) =>
        /load more|show more/i.test(selector),
      ),
    ).toBe(true);
    for (const selector of PAGINATION_CONTROL_SELECTORS) {
      // Every entry advances a listing.
      expect(selector, selector).toMatch(/next|more|pagination/i);
      // None of them could send, apply, message or contact anyone.
      expect(selector, selector).not.toMatch(
        /submit|\bsend\b|apply|message|contact|email|reply|post\b|confirm|checkout|pay\b/i,
      );
    }
  });

  it("refuses a selector that is not on the allow-list", async () => {
    expect(isAllowedControlSelector("button[type='submit']")).toBe(false);
    const page = {
      locator: () => {
        throw new Error("the helper resolved a locator before checking");
      },
    };
    await expect(
      activateAllowedControl(page as never, {
        selector: "button[type='submit']" as never,
        index: 0,
      }),
    ).rejects.toBeInstanceOf(ForbiddenAdapterInteractionError);
  });

  it("keeps every interaction primitive out of every adapter", async () => {
    for (const [file, source] of await adapterSources()) {
      for (const [name, pattern] of INTERACTION_PRIMITIVES) {
        expect(
          pattern.test(source),
          `${file} interacts with the page directly via ${name}. Route it through activateAllowedControl in ${INTERACTION_HELPER}, which checks what it is touching.`,
        ).toBe(false);
      }
      expect(
        EVALUATED_CLICK.test(source),
        `${file} smuggles a click inside an evaluated page function`,
      ).toBe(false);
    }
  });

  it("keeps the helper itself down to one interaction", async () => {
    const helper = await readFile(
      new URL(INTERACTION_HELPER, ADAPTERS),
      "utf8",
    );
    const code = helper.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(code.match(/\bdispatchEvent\s*\(/g) ?? []).toHaveLength(1);
    for (const [name, pattern] of INTERACTION_PRIMITIVES) {
      if (name === "dispatchEvent") continue;
      expect(
        pattern.test(code),
        `${INTERACTION_HELPER} also uses ${name}`,
      ).toBe(false);
    }
    // The check has to happen before a locator is resolved, or a caller could
    // hand it one pointing anywhere.
    expect(code.indexOf("ForbiddenAdapterInteractionError")).toBeLessThan(
      code.indexOf("page.locator"),
    );
  });

  it("still forbids the network and mail primitives it always did", async () => {
    // A bare fetch is an outbound HTTP call. `client.fetch(...)` in email.ts is
    // ImapFlow reading a mailbox opened read-only, so the pattern excludes a
    // method call rather than excluding the file from the scan.
    const outboundFetch = /(?<![.\w])fetch\s*\(/;
    for (const [file, source] of await adapterSources()) {
      expect(outboundFetch.test(source), file).toBe(false);
      expect(/\.(sendMail|post)\s*\(/.test(source), file).toBe(false);
    }
    const email = await readFile(new URL("email.ts", ADAPTERS), "utf8");
    expect(email).toMatch(/client\.fetch\s*\(/);
    expect(email).toMatch(/readOnly:\s*true/);
  });
});
