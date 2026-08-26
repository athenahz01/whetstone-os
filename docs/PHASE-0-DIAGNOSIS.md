# Phase 0 Diagnosis: Why Growth Engine v1 Went Unused

- Audience: humans only
- Captured: 2026-08-26

The v1 code demonstrated useful pieces, but its operating model required a
person to become the infrastructure. That made non-adoption predictable.

## 1. Laptop dependency

Concrete evidence:

- `prisma/schema.prisma` uses SQLite.
- `.env.example` points `DATABASE_URL` to `file:./dev.db`.
- `worker/index.ts` is a long-lived local loop.
- the Wyzant adapter reads a local Playwright storage-state path.

Operational effect: polling, drafting, alerts, and state stopped when the
laptop or local session was unavailable.

Named acceptance test: `AT-U1-LAPTOP-OFF` in `BASELINES.md`.

## 2. PM2 was recovery infrastructure

Concrete evidence:

- `ecosystem.config.js` hardcodes Windows Node and pnpm paths.
- `ops/pm2-resurrect.cmd` hardcodes the workspace path and PM2 home.
- the web app and worker are defined as always-on personal-machine processes.

Operational effect: runtime health depended on one Windows profile and a local
process manager, which is not unattended hosted operations.

Named acceptance test: `AT-U2A-ZERO-TERMINAL`.

## 3. Terminal commands were part of normal operation

Concrete evidence:

- the README requires `pnpm dev`, Prisma migration/seed commands, environment
  overrides, and `pnpm tsx worker/index.ts`.
- recovery instructions depend on command-line state and manual restarts.

Operational effect: a non-developer could not treat the system as a durable
service, and a crash created a procedure instead of a button.

Named acceptance tests: `AT-U2A-ZERO-TERMINAL` and the Phase 7 button gate for
restart, retry, and pause.

## 4. There was no daily mobile decision surface

Concrete evidence:

- v1 exposes `/review` and `/scoreboard`, not `/today`.
- the review console renders a potentially unbounded list of two-pane folios.
- no committed test proves the full operating loop at 390px.

Operational effect: the system asked the operator to work at a desk and manage
a queue rather than make a few phone-sized decisions in context.

Named acceptance tests: `AT-U3-FIVE-DECISIONS` and `AT-U4-390PX-LOOP`.

## 5. The copy-paste loop was the product

Concrete evidence:

The v1 UI describes six steps: read lead, edit draft, approve and prefill, send
on Wyzant, mark sent, and log outcome. The human-send paste is required by G1,
but v1 also separated source review, operational status, and outcome updates
across a long console.

Operational effect: each lead created navigation and clerical work. The correct
human boundary became friction because the surrounding loop was not compressed.

Named acceptance tests: `AT-U5-TWO-TAP-SEND-LOG` and
`AT-U6-INLINE-ARTIFACT`.

## 6. Durable recovery was not proven

Concrete evidence:

- state is a local SQLite file containing real family data;
- no hosted backup-and-restore proof exists;
- before Phase 0, the repository had no commit, so production fixes and the
  recoverable codebase were the same uncommitted working directory.

Operational effect: the system could neither be trusted to survive hardware
loss nor safely evolved from a known revision.

Named acceptance test: `AT-U7-HOSTED-RESTORE`.

## Phase 0 corrective action completed

The v1 ignore rules were hardened before its first archive commit. A secret scan
then checked all 80 non-ignored candidate files and found zero matching secrets.
The archive commit `89bcb58` was created only after that scan. The real `.env`
and `prisma/dev.db` remained ignored, as did Playwright authentication state.
