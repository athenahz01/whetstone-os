# Phase 1 deployment runbook

The application runtime is Vercel, persistence and authentication are Supabase,
and the authenticated browser poll is GitHub Actions. None of those services
depends on a workstation remaining online.

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
five minutes with up to two minutes of jitter, reads the job feed, and never
clicks a submit control.

## Backup restore drill

Use a separate, disposable Supabase project for the drill. Download a production
backup through the Supabase dashboard or supported database tooling, restore it
to that disposable project, and set `RESTORE_DATABASE_URL` to the restored
database. Run `pnpm restore:verify`. A pass proves that all six operational
tables exist in the restored database and every one has `org_id`. Record the
backup timestamp, restore project, command output, and cleanup date in the audit
ticket. Never point the restore command at production.

## Phone acceptance

With all development machines shut down, wait for a real qualifying lead. Confirm
that Telegram receives the alert, open the hosted review URL on a phone, request
a magic link, authenticate, and reach the Today view without a terminal or SSH.
