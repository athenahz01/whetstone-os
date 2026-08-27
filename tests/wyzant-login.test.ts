import { describe, expect, it, vi } from "vitest";
import {
  persistWyzantStorageState,
  sanitizeWyzantStorageState,
  type WyzantStorageState,
} from "../ops/wyzant-login";

const raw: WyzantStorageState = {
  cookies: [
    {
      name: "session",
      value: "wyzant-secret-cookie",
      domain: ".highered.wyzant.com",
      path: "/",
      expires: 2_000_000_000,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "tracking",
      value: "third-party-secret-cookie",
      domain: ".doubleclick.net",
      path: "/",
      expires: 2_000_000_000,
      httpOnly: false,
      secure: true,
      sameSite: "None",
    },
  ],
  origins: [
    {
      origin: "https://highered.wyzant.com",
      localStorage: [{ name: "session", value: "wyzant-origin-secret" }],
    },
    {
      origin: "https://facebook.com",
      localStorage: [{ name: "tracking", value: "third-party-origin-secret" }],
    },
  ],
};

describe("local Wyzant session capture", () => {
  it("strips every non-wyzant.com cookie and origin before writing", async () => {
    const filtered = sanitizeWyzantStorageState(raw);
    expect(filtered.state.cookies.map((cookie) => cookie.domain)).toEqual([
      ".highered.wyzant.com",
    ]);
    expect(filtered.state.origins.map((entry) => entry.origin)).toEqual([
      "https://highered.wyzant.com",
    ]);
    expect(filtered.thirdPartyCookiesDropped).toBe(1);
    expect(filtered.thirdPartyOriginsDropped).toBe(1);

    let written = "";
    await persistWyzantStorageState({
      raw,
      output: "playwright/.auth/test-state.json",
      feedUrl: "https://highered.wyzant.com/tutor/jobs",
      makeDirectory: async () => undefined,
      write: async (_path, value) => {
        written = value;
      },
      log: () => undefined,
    });
    expect(written).toBe(JSON.stringify(filtered.state));
    expect(written).not.toContain("doubleclick");
    expect(written).not.toContain("facebook");
  });

  it("prints counts and expiry metadata but no cookie or origin values", async () => {
    const log = vi.fn();
    const report = await persistWyzantStorageState({
      raw,
      output: "playwright/.auth/test-state.json",
      feedUrl: "https://highered.wyzant.com/tutor/jobs",
      now: Date.parse("2026-08-27T12:00:00.000Z"),
      makeDirectory: async () => undefined,
      write: async () => undefined,
      log,
    });
    const printed = JSON.stringify(log.mock.calls);
    for (const secret of [
      "wyzant-secret-cookie",
      "third-party-secret-cookie",
      "wyzant-origin-secret",
      "third-party-origin-secret",
    ]) {
      expect(printed).not.toContain(secret);
    }
    expect(report).toMatchObject({
      wyzantCookies: 1,
      thirdPartyCookiesDropped: 1,
      thirdPartyOriginsDropped: 1,
      feedOrigin: "https://highered.wyzant.com",
      valuesPrinted: false,
    });
  });
});
