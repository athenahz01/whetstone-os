# Phase 1 handoff: Codex to Claude Code

Written by the auditor on 2026-08-26 after Codex exhausted its usage partway
through the Phase 1 FIX items.

## What state the repository is in

- HEAD is `a1754e3` "Build Phase 1 hosted runtime".
- **21 files are modified or new and uncommitted.** That is Codex's Phase 1 fix
  work. It is not junk. Finish it, do not restart it.
- The auditor extracted the working tree and ran it in a clean environment. Real
  results, not claims:

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm test` | **PASS, 15 files, 33 tests** (up from 11 and 19) |
| `pnpm docs:lint` | PASS, 5/5 documents |
| `pnpm typecheck` | **FAIL, 4 errors** |
| `pnpm lint` | 1 warning |
| `pnpm format:check` | **FAIL, 5 files** |
| `pnpm build` | **FAIL, 6 type errors** |

So: the logic is right and tested, and the tree does not compile for production.
`pnpm verify` never completed because `format:check` fails before `typecheck`
runs, which is why Codex did not catch these before it stopped.

## The punch-list, in order

### 1. Regenerate the Prisma client

`lib/core/heartbeat.ts` calls `prisma.pollHeartbeat`, which does not exist on the
generated client. This is not a design problem: the `PollHeartbeat` model is
already in `prisma/schema.prisma` at line 137 with `orgId`, a unique on
`[orgId, source]`, and it is in the migration SQL. Codex just never regenerated.

```powershell
pnpm prisma:generate
```

That clears four of the six build errors.

### 2. Fix the two real type errors in `lib/core/alerts.ts`

Lines 67 and 68: `Object is possibly 'undefined'` and `string | undefined` not
assignable to `string`.

Cause: `ready()` is a boolean method, and TypeScript does not narrow
`this.client`, `this.chatId` or `this.reviewBaseUrl` through a method call. Codex
worked around it for `reviewBaseUrl` with a non-null assertion on line 65 and
missed the other two.

Do not add two more `!`. Destructure and check locals, which narrows properly and
removes the existing assertion too:

```ts
async notify(lead: Lead, score: number): Promise<void> {
  const { client, chatId, reviewBaseUrl } = this;
  if (!client || !chatId || !reviewBaseUrl) return;
  const reviewUrl = new URL(reviewBaseUrl);
  ...
}
```

Keep `ready()` if anything else calls it. A `this is` type predicate is the other
clean option.

### 3. Remove the unused stub

`tests/wyzant-messages-adapter.test.ts` declares `StubAlertService` and never
uses it. One eslint warning.

### 4. Format

```powershell
pnpm format
```

Five files. Then `pnpm verify` and `pnpm build` should both be green.

### 5. Commit and re-print the Phase 1 AUDIT HANDOFF

Include, per the audit's notes 3, 5 and 6:

- **Itemize the dropped v1 tests** file by file with a reason each, rather than
  summarizing as "superseded". Summarizing is what hid the missing Wyzant
  Messages adapter in the first place.
- **Say referrals is deferred to Phase 3, not superseded.** It was the one lane
  verified live end-to-end in v1, which makes it the cheapest smoke test of the
  new runtime once a database exists.
- **Do not describe `/today` as a mobile surface.** It is a 53-line placeholder
  and Phase 7 owns it. Calling it mobile reads as U3 and U4 progress that does
  not exist.
- Leave **U1, U2a, U6 and phone auth unchecked.** They need a deployment.

## What Codex already finished, verified by the auditor

Do not redo these.

- **FIX 1, Wyzant Messages ported.** `lib/adapters/wyzant-messages.ts` exists,
  is inbound-only, and is correctly wired into `ops/wyzant-poll.ts` rather than
  `createScheduledAdapters()`. That separation is right: browser adapters run in
  GitHub Actions, non-browser adapters run on Vercel cron. Its test passes.
- **FIX 2, poll durability.** Cadence moved from 5 minutes to 15. `actions/cache`
  now caches both the pnpm store and `~/.cache/ms-playwright`, so the Chromium
  download stops happening on every run. Jitter retained. A `PollHeartbeat`
  table plus `lib/core/heartbeat.ts` records each run, and the Vercel cron route
  checks staleness and alerts, so a poll that silently stops is now a detectable
  state instead of a quiet-looking board.
- **Note 4.** The proxy matcher now excludes `api`, so ingest and cron calls no
  longer make a pointless Supabase `auth.getUser()` round trip.
- **DEPLOYMENT.md** gained the deterministic acceptance path: with the laptop
  off, POST a synthetic lead to `/api/ingest` from another device rather than
  waiting for a real qualifying lead to arrive.

## After the punch-list

Stop. Do not start Phase 2.

Phase 1's four real gates need a live deployment, and provisioning is Athena's
step. Phase 2 also needs a live Postgres to run its migration against, so
provisioning is on the critical path either way.

## One thing worth raising if the quota still bites

FIX 2 keeps the Playwright poll on GitHub Actions with caching and a 4x lower
run count, which should fit. If Actions minutes still run short on a private
repository, the escalation is a small always-on worker for the browser poll only.
Athena already uses Railway for long jobs, so that is the natural home. It does
not reintroduce the v1 problem: the objection was never to a process existing
somewhere, it was to that process living on her laptop.
