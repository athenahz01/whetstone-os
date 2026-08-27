import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  authenticate,
  readSignInNotice,
  SIGN_IN_ERROR_MESSAGE,
  SIGN_IN_FAILURE_PATH,
  SIGN_IN_SUCCESS_PATH,
  SIGN_OUT_PATH,
  signInNoticeMessage,
} from "../lib/auth/sign-in";

const PASSWORD = "correct-horse-battery-staple-9471";
const APP = new URL("../app/", import.meta.url);

function renderedMessageFor(redirectTo: string): string | null {
  const query = Object.fromEntries(
    new URL(redirectTo, "https://whetstone.test").searchParams,
  );
  // The same two functions the login page calls, in the same order.
  return signInNoticeMessage(readSignInNotice(query));
}

describe("password sign-in", () => {
  it("reaches /today when the credentials are accepted", async () => {
    const signIn = vi.fn(async () => ({ ok: true }));
    const outcome = await authenticate({
      email: "athena@example.test",
      password: PASSWORD,
      signIn,
    });
    expect(outcome.redirectTo).toBe(SIGN_IN_SUCCESS_PATH);
    expect(signIn).toHaveBeenCalledWith({
      email: "athena@example.test",
      password: PASSWORD,
    });
  });

  /**
   * The assertion this pass exists for. Two messages would make the form an
   * oracle for which addresses have accounts.
   */
  it("renders a byte-identical message for a wrong password and an unknown email", async () => {
    const wrongPassword = await authenticate({
      email: "athena@example.test",
      password: "not-the-password",
      signIn: async () => ({ ok: false }),
    });
    const unknownEmail = await authenticate({
      email: "nobody@example.test",
      password: PASSWORD,
      signIn: async () => ({ ok: false }),
    });

    expect(wrongPassword.redirectTo).toBe(unknownEmail.redirectTo);

    const first = renderedMessageFor(wrongPassword.redirectTo);
    const second = renderedMessageFor(unknownEmail.redirectTo);
    expect(first).toBe(second);
    expect(first).toBe(SIGN_IN_ERROR_MESSAGE);
    expect(Buffer.from(String(first))).toEqual(Buffer.from(String(second)));
  });

  it("has exactly one failure message, whatever error code the URL carries", () => {
    // A future change could route a second failure to its own code. There must
    // still be one string on the other side of it, or the form becomes an
    // oracle for which addresses have accounts.
    const codes = [
      "credentials",
      "password",
      "email",
      "unknown-email",
      "send",
      "link",
      "1",
    ];
    const messages = new Set(
      codes.map((error) => signInNoticeMessage(readSignInNotice({ error }))),
    );
    expect([...messages]).toEqual([SIGN_IN_ERROR_MESSAGE]);
  });

  it("gives a missing field and a rejected credential the same message too", async () => {
    const missingPassword = await authenticate({
      email: "athena@example.test",
      password: "",
      signIn: async () => {
        throw new Error("the credential call must not run without a password");
      },
    });
    const missingEmail = await authenticate({
      email: "   ",
      password: PASSWORD,
      signIn: async () => {
        throw new Error("the credential call must not run without an email");
      },
    });
    expect(missingPassword.redirectTo).toBe(SIGN_IN_FAILURE_PATH);
    expect(missingEmail.redirectTo).toBe(SIGN_IN_FAILURE_PATH);
    expect(renderedMessageFor(missingPassword.redirectTo)).toBe(
      SIGN_IN_ERROR_MESSAGE,
    );
  });

  it("treats a thrown transport error as a failed sign-in, not a crash", async () => {
    const outcome = await authenticate({
      email: "athena@example.test",
      password: PASSWORD,
      signIn: async () => {
        throw new Error(`upstream rejected body password=${PASSWORD}`);
      },
    });
    expect(outcome.redirectTo).toBe(SIGN_IN_FAILURE_PATH);
    // The thrown message carried the password. None of it reaches the URL.
    expect(outcome.redirectTo).not.toContain(PASSWORD);
    expect(outcome.redirectTo).not.toContain("upstream");
  });

  it("never puts the password in a redirect, a log line, or an error", async () => {
    const written: string[] = [];
    const sinks = (["log", "warn", "error", "info", "debug"] as const).map(
      (level) =>
        vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
          written.push(args.map((value) => String(value)).join(" "));
        }),
    );
    try {
      for (const ok of [true, false]) {
        const outcome = await authenticate({
          email: "athena@example.test",
          password: PASSWORD,
          signIn: async () => ({ ok }),
        });
        expect(outcome.redirectTo).not.toContain(PASSWORD);
        expect(JSON.stringify(outcome)).not.toContain(PASSWORD);
      }
      await authenticate({
        email: "athena@example.test",
        password: PASSWORD,
        signIn: async () => {
          throw new Error(PASSWORD);
        },
      });
    } finally {
      sinks.forEach((sink) => sink.mockRestore());
    }
    expect(written.join("\n")).not.toContain(PASSWORD);
  });

  it("passes the password to the credential call and to nothing else", async () => {
    const seen: unknown[] = [];
    await authenticate({
      email: "athena@example.test",
      password: PASSWORD,
      signIn: async (credentials) => {
        seen.push(credentials);
        return { ok: true };
      },
    });
    expect(seen).toHaveLength(1);
    const source = await readFile(
      new URL("../lib/auth/sign-in.ts", import.meta.url),
      "utf8",
    );
    // One read of the password, and it is the argument to signIn.
    expect(source.match(/\bpassword\b/g) ?? []).not.toHaveLength(0);
    expect(source).not.toMatch(/redirect[^\n]*password/i);
    expect(source).not.toMatch(/console\./);
  });
});

describe("the sign-in surface", () => {
  it("asks for a password with the attributes a phone keychain needs", async () => {
    const page = await readFile(new URL("login/page.tsx", APP), "utf8");
    expect(page).toMatch(/name="password"/);
    expect(page).toMatch(/type="password"/);
    expect(page).toMatch(/autoComplete="current-password"/);
    expect(page).toMatch(/autoComplete="email"/);
    // Both fields required, and the button says what it does.
    expect(page.match(/required/g) ?? []).toHaveLength(2);
    expect(page).toMatch(/<button type="submit">Sign in<\/button>/);
  });

  it("carries no error text of its own, so the messages cannot drift apart", async () => {
    const page = await readFile(new URL("login/page.tsx", APP), "utf8");
    expect(page).toMatch(/signInNoticeMessage/);
    expect(page).not.toMatch(/could not/i);
    expect(page).not.toMatch(/password is|email is|no account|not found/i);
  });

  it("stays usable one-handed at 390px", async () => {
    const css = await readFile(new URL("globals.css", APP), "utf8");
    // A single-column form, and tap targets at the 44px minimum.
    expect(css).toMatch(/form\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/input,\s*\n?button\s*\{[^}]*min-height:\s*44px/);
    const page = await readFile(new URL("login/page.tsx", APP), "utf8");
    // Nothing laid out side by side on the sign-in form.
    expect(page).not.toMatch(/className="row"/);
  });

  it("sends the magic link path away entirely", async () => {
    const actions = await readFile(new URL("login/actions.ts", APP), "utf8");
    expect(actions).not.toMatch(
      /signInWithOtp|requestMagicLink|emailRedirectTo/,
    );
    expect(actions).toMatch(/signInWithPassword/);
  });

  it("offers a sign-out control on /today", async () => {
    const today = await readFile(new URL("today/page.tsx", APP), "utf8");
    expect(today).toMatch(/action=\{signOut\}/);
    expect(today).toMatch(/Sign out/);
  });

  /**
   * Clearing the cookie is not signing out. Global scope revokes the refresh
   * token at Supabase, so a token a client kept cannot be put back.
   */
  it("revokes the session rather than only clearing a cookie", async () => {
    const actions = await readFile(new URL("login/actions.ts", APP), "utf8");
    expect(actions).toMatch(/signOut\(\{\s*scope:\s*"global"\s*\}\)/);
    expect(actions).toMatch(new RegExp(`redirect\\(SIGN_OUT_PATH\\)`));
    expect(SIGN_OUT_PATH).toBe("/login?signedOut=1");
    expect(signInNoticeMessage(readSignInNotice({ signedOut: "1" }))).toBe(
      "You are signed out.",
    );
  });

  it("keeps /today behind a session check", async () => {
    const today = await readFile(new URL("today/page.tsx", APP), "utf8");
    expect(today).toMatch(/getUser\(\)/);
    expect(today).toMatch(/if \(!data\.user\) redirect\("\/login"\)/);
  });

  it("reads and writes no credential to any file", async () => {
    for (const file of ["login/actions.ts", "login/page.tsx"]) {
      const source = await readFile(new URL(file, APP), "utf8");
      expect(source, file).not.toMatch(/readFile|writeFile|fs\/promises|\.env/);
    }
    const core = await readFile(
      new URL("../lib/auth/sign-in.ts", import.meta.url),
      "utf8",
    );
    expect(core).not.toMatch(/readFile|writeFile|fs\/promises|process\.env/);
  });
});
