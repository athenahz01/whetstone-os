# HANDOFF TO EXECUTOR - Password sign-in, and a lock for the build

Read `CLAUDE.md` first. HEAD is the commit after `9aa780b` that added `prisma generate` to the build script. Baseline before this pass: **34 files / 384 tests / 0 skipped**.

Two items. Neither is a numbered phase. **Do not start Phase 6.**

---

## 1. Replace the magic link with email and password

The owner is signing in from a phone. A magic link means leaving the app, opening a mail client, tapping a link, and coming back, and it puts email deliverability between her and her own dashboard. Today it failed and the sign-in never happened at all.

The app side is not the problem, and I checked before asking for this. `/login` returns 200, `/today` correctly 307s to `/login` when unauthenticated, and `/auth/confirm` with no parameters correctly 307s to `/login?error=link`. The redirect never reached the app. That is a Supabase URL-configuration or deliverability question, and it is not worth solving for a flow we are removing.

**Build.**

- `app/login/actions.ts`: replace `requestMagicLink` with `signInWithPassword`, taking email and password. On error, redirect to `/login?error=credentials`. On success, redirect to `/today`.
- `app/login/page.tsx`: add a password field with `autoComplete="current-password"` and `type="password"`. Keep `autoComplete="email"` on the email field. Both `required`. The submit button says **Sign in**. Both fields must be usable one-handed on a 390px viewport, because U4 is about exactly that.
- **The error message must not say which half was wrong.** One message for a bad email and a bad password, so the form cannot be used to discover which addresses have accounts.
- Add a sign-out action and put a control for it on `/today`. There is currently no way to sign out, which matters more once a password is stored in a phone's password manager.
- `proxy.ts` and `lib/supabase/server.ts` need no changes. Session cookies work the same way.

**Do not build a self-service password reset.** Two named users; a reset is Cole or Athena in the Supabase dashboard. A reset flow is a whole second email path and it is the thing we are removing.

**Acceptance.**
- [ ] A correct email and password reaches `/today` with a session cookie set.
- [ ] A wrong password and an unknown email produce the **same** message. Test both and assert the strings are equal.
- [ ] `/today` still 307s to `/login` with no session.
- [ ] Sign-out clears the session and `/today` 307s again afterwards.
- [ ] The password never appears in a redirect URL, a log line, or an error message. Assert it.
- [ ] No credential is read from or written to any file. Supabase holds the hash.

**Tests.** One per acceptance box. The equal-error-strings test is the one that matters; write it as an assertion over the two rendered messages, not as a comment claiming they match.

---

## 2. Lock the build script

Vercel restored a cached `node_modules`, so `pnpm install` was a 1.1-second no-op, so Prisma's postinstall never re-ran, so the generated client was frozen before Phase 2's models existed. Twenty type errors, every deployment failing for fourteen hours, and every local `pnpm build` passing the whole time. Production served 20-hour-old code while the workflow engine, the research brief and the drafting were all in the repository and none of them were running.

The one-line fix is in. It needs a lock, because the failure was invisible from every angle we were looking at.

- A test asserting `package.json`'s `build` script contains `prisma generate` before `next build`.
- Name the reason in the test's own words, not just in a commit message. The next person to "simplify" that script needs to read why it is not simple.

**Acceptance.**
- [ ] Removing `prisma generate` from the build script fails a test by name.
- [ ] Reordering it after `next build` also fails.

---

## Rules

- Do not touch `lib/core/engine.ts`. Report its md5 (`9f95451a2e60cd143afa1d46618b34e0`).
- Do not edit `ICP.md`, `VOICE.md`, `FACTS.md` or `BASELINES.md`.
- Negative probe per clause. Re-run the existing sweeps afterwards.
- If a sentence in your handoff claims a behaviour, an assertion must already prove it. Both executors have overstated a claim in the last two days and both were caught in under a minute.
- `pnpm verify` and `pnpm build`. Report file, test and skipped counts exactly.
- House rules in `CLAUDE.md`: PowerShell, no em dashes, never push.
- Stop and print the AUDIT HANDOFF block.

## What I will check

That the two error messages are byte-identical, by rendering both. That the password cannot be recovered from any redirect, log, or thrown error. That sign-out actually invalidates rather than just clearing a cookie the client can restore. And I will break the build script both ways.
