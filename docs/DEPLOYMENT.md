# Phase 1 deployment runbook

The application runtime is Vercel, persistence and authentication are Supabase,
and the authenticated browser poll is GitHub Actions. None of those services
depends on a workstation remaining online.

## Plan prerequisites - read before provisioning

### Vercel Pro is required. This is a hard blocker, not a preference.

`vercel.json` schedules `/api/cron/tick` at `*/5 * * * *`. On the Hobby plan the
**deployment itself fails** with:

> Hobby accounts are limited to daily cron jobs. This cron expression would run
> more than once per day.

Hobby allows cron jobs once per day with per-hour precision. Pro allows once per
minute with per-minute precision. A daily tick would make IMAP ingestion useless
for speed to lead, which is the competitive claim the whole system rests on.

There is a second, independent reason: Hobby is for non-commercial use. This is a
revenue tool for Whetstone Advisory LLC. Verify the current terms against the
account, but plan on Pro.

Pro is roughly 20 dollars per month per member. If that is not wanted right now,
the technical workaround is to move the tick to the existing GitHub Actions
schedule by curling `/api/cron/tick` with `CRON_SECRET`. That avoids the cron
limit and does not address the commercial use question.

### Supabase Free is fine to start, with one caveat that touches U6

Free does not include automatic daily backups. Supabase recommends free projects
export regularly with the CLI `db dump` command and keep off-site copies. Daily
backups with seven day retention start on Pro.

U6 is still satisfiable on Free: take a manual `db dump`, restore it into a
separate disposable project, and run `pnpm restore:verify` against that. The
drill below is written for exactly that. Upgrade when losing the data would
actually hurt.

Free projects also pause after a period of inactivity. The five minute cron keeps
this project active, so it is not a practical risk here.

## Supabase

1. Create a production project and record its pooled and direct Postgres URLs.
2. Run `pnpm prisma:migrate:deploy` with `DATABASE_URL` and `DIRECT_URL` set.
3. Enable email OTP in Authentication. Add the production `/auth/confirm` URL to
   the redirect allowlist and restrict access to approved Whetstone operators.
   The callback accepts both the default PKCE `code` response and a custom email
   template using `token_hash` with `type=email`.
4. Set a backup schedule appropriate for the project plan.

## Vercel

Import the repository, select the Next.js framework, and set every applicable
variable documented in `.env.example`. `CRON_SECRET` and `INGEST_SECRET` must be
different high-entropy values. Deploy, then confirm `/api/health` reports the
required services configured. `vercel.json` invokes the read-only IMAP poll on
a five-minute schedule.

## GitHub Actions

Capture Playwright storage state only while signed in to Whetstone's own Wyzant
account. Store the entire JSON document as the encrypted
`WYZANT_STORAGE_STATE_JSON` repository secret. Add `INGEST_URL` and the same
`INGEST_SECRET` used by Vercel as encrypted secrets. The workflow runs every
15 minutes with up to two minutes of jitter, reads both the direct Messages
inbox and jobs feed, and never clicks a submit control. The pnpm store and
Playwright browser directory are cached between runs.

Every fully successful poll writes the `wyzant-github-actions` heartbeat through
the ingest request, even when it finds zero leads. Vercel checks that heartbeat
on its scheduled tick. After 45 minutes without a successful poll it sends one
Telegram exception identifying Actions billing, scheduling, and session state
as the first checks. A new successful heartbeat clears the alert latch.

## Backup restore drill

Use a separate, disposable Supabase project for the drill. Download a production
backup through the Supabase dashboard or supported database tooling, restore it
to that disposable project, and set `RESTORE_DATABASE_URL` to the restored
database. Run `pnpm restore:verify`. A pass proves that the six preserved v1
tables plus `poll_heartbeats` exist in the restored database and every one has
`org_id`. Record the
backup timestamp, restore project, command output, and cleanup date in the audit
ticket. Never point the restore command at production.

## Phone acceptance

Use this deterministic drill before waiting for live Wyzant traffic:

1. Create a fresh 64-character lowercase SHA-256 value for `id`, use the current
   ISO timestamp for `postedAt`, and set `url` to the hosted `/today` URL.
2. With every development machine powered down, use an HTTP client on another
   device to `POST` the following body to the hosted `/api/ingest` route. Send
   `Content-Type: application/json` and the production shared secret in the
   `x-ingest-secret` header.

```json
{
  "leads": [
    {
      "id": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "channel": "synthetic-acceptance",
      "author": "Phase 1 acceptance drill",
      "text": "Looking for a tutor and need help with an admissions application, SAT reading, and an essay.",
      "subject": "College Counseling",
      "location": "Online",
      "url": "https://YOUR_VERCEL_DOMAIN/today",
      "postedAt": "2026-08-26T18:00:00.000Z"
    }
  ]
}
```

3. Require HTTP 200, a Telegram hot-lead alert, and a new Postgres lead row.
4. Open the Telegram review link on a phone, request a magic link, authenticate,
   and confirm the synthetic record appears on the hosted Today view.
5. Separately confirm a scheduled GitHub run advances `poll_heartbeats` while
   every development machine remains off. A later real Wyzant lead confirms the
   source poll, but does not block this deterministic Phase 1 drill.

Use a new ID for every repetition so stable deduplication does not suppress the
alert. Acceptance and recovery drills may use an HTTP client; normal daily use
requires no terminal or SSH.

## v1 test disposition

The v1 suite had 13 files. Phase 1 does not describe dropped coverage as broadly
superseded; each file has an explicit disposition:

| v1 test file                      | Phase 1 disposition                                                            |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `alerts.test.ts`                  | Ported into `salvaged-core` and degradation coverage.                          |
| `drafting.test.ts`                | Ported, including prompt specificity and the temperature lock.                 |
| `email-adapter.test.ts`           | Ported into adapter-contract, degradation, and human-send coverage.            |
| `engine.test.ts`                  | Ported into dedupe, adapter isolation, and salvaged-core coverage.             |
| `metrics-rollup.test.ts`          | Ported with tenant-scoped upsert coverage.                                     |
| `wyzant-adapter.test.ts`          | Ported into host, dedupe, contract, and human-send coverage.                   |
| `wyzant-messages-adapter.test.ts` | Ported in Phase 1 with inbound-only and authenticated-route locks.             |
| `mock-adapter.test.ts`            | Replaced by the test-only memory adapter and production batch-ingest contract. |
| `referrals-adapter.test.ts`       | Deferred, not superseded; Phase 3 rebuilds the verified referral lane.         |
| `alert-retry.test.ts`             | Deferred with the operator retry controls owned by Phase 7.                    |
| `review-workflow.test.ts`         | Deferred with the Phase 7 review workflow.                                     |
| `scoreboard-operations.test.ts`   | Deferred with the Phase 10 management scorecard.                               |
| `metrics.test.ts`                 | Deferred with Phase 10 KPI queries; Phase 1 preserves its source tables.       |
