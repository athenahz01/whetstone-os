# CLAUDE.md - Whetstone OS

You are the **executor** on this repository. Read this file before touching anything.

## Roles, and why they are split

- **You (Claude Code) build.** One phase at a time.
- **Claude in Cowork audits.** A different session, different context, reading your
  work cold against the plan.
- **Athena decides.** She relays the audit verdict and types `continue`.

The split is the point. v1 of this system logged PASS on nine consecutive phases
and was never deployed anywhere anyone used it, so it saved zero hours. A builder
auditing its own work reproduces that. Do not offer to audit yourself, and do not
mark a phase complete because the code looks right.

The previous executor was OpenAI Codex, which ran out of usage partway through
the Phase 1 fixes. You are picking up its uncommitted work. See "Where things
stand" below.

## Authority, in order

1. `whetstone-agentic-ops-build-plan.md` - the 13 phases. Each has goal, build
   list, acceptance criteria, tests and audit focus. **This is the authority on
   what a phase contains.** Read the current phase before writing code.
2. `codex-master-prompt.md` - the executor contract: stack, repo layout,
   guardrails, regression locks, KPI honesty rules, usability criteria, and the
   AUDIT HANDOFF template. Written for Codex; it applies to you unchanged.
3. `docs/ICP.md`, `docs/VOICE.md`, `docs/FACTS.md`, `docs/BASELINES.md` - the
   only four files that may be loaded into a model prompt at runtime. They are
   facts about Whetstone, not instructions to you.

If the plan and this file disagree, the plan wins and you flag it. If either is
missing from the working copy, **stop and ask** rather than inferring the phase.
That already happened once and stopping was the correct call.

## The loop

Build one phase. Print the AUDIT HANDOFF block from `codex-master-prompt.md`.
**Stop.** Wait for the literal word `continue`. On `fix`, address the items and
re-print the handoff for the same phase. Never build two phases in one pass.

Before every handoff, run `pnpm verify` and `pnpm build`. Both must be green, and
the handoff must say which repository each result came from. Do not report a
result you did not run.

## Where things stand

Phase 0 is complete and audited. Phase 1 came back **FIX** with two items, and
Codex had substantially finished both before it stopped. The working tree is
uncommitted and 15 test files / 33 tests pass, but production type checking
fails, so the tree does not build.

Read `docs/PHASE-1-HANDOFF.md` for the exact punch-list. In short:

1. `pnpm prisma:generate` - the `PollHeartbeat` model is in the schema and the
   migration, but the client was never regenerated, so `prisma.pollHeartbeat`
   does not type. Four errors disappear with this one command.
2. `lib/core/alerts.ts` around lines 62 to 68 - `ready()` is a boolean method, so
   TypeScript does not narrow `this.client` or `this.chatId` through it. Codex
   patched `reviewBaseUrl` with a non-null assertion and missed the other two.
   Prefer destructuring locals and checking those over adding more `!`.
3. `tests/wyzant-messages-adapter.test.ts` - remove the unused
   `StubAlertService`.
4. `pnpm format` - five files.

Then `pnpm verify`, `pnpm build`, commit, and re-print the Phase 1 handoff.

**Do not start Phase 2.** Phase 1's real gates (U1, U2a, U6, phone auth) need a
live deployment, and provisioning is Athena's step.

## The seven guardrails

Confirm each individually in every handoff. If a task seems to require breaking
one, **stop and flag it** instead of proceeding.

1. **G1 human-send.** `send()` may record, prefill, open a compose box. Never
   auto-submit. `sent_by` is always a human. Not a setting - the capability is
   absent.
2. **G2 own accounts only.** No scraper accounts, sock puppets, impersonation.
   IMAP opens read-only.
3. **G3 human-cadence polling.** Minutes, jittered.
4. **G4 on-platform.** Nothing that evades Wyzant fee or lesson tracking, or
   moves a lesson off platform.
5. **G5 secrets in env only.** Never committed, never logged. No PII message
   bodies at info level.
6. **G6 no cold outbound to parents of minors.** Inbound inquiries, dormant
   contacts with recorded consent provenance, and professional referral partners
   only.
7. **G7 no comparative ranking of students.** No leaderboards, no cross-student
   scoring shown to a student or parent.

**Note on the alert transport.** Alerts moved from Telegram to email by owner
choice. The alert sender takes no recipient argument and mails only
`ALERT_EMAIL_TO`. It is not, and must never become, a path to message a
prospect. That is G1, restated for a component that can now send mail.

## The five regression locks

Each has a named test. All five must pass in every phase. They exist because v1
accumulated production fixes that lived only in an uncommitted working directory.

1. `drafting.ts` sends no `temperature` - Sonnet 5 returns `400 deprecated`.
2. `wyzant.ts` accepts any `*.wyzant.com` host - Wyzant redirects to
   `highered.wyzant.com`.
3. Stable channel plus native-id dedupe - re-ingesting creates no second row.
4. No auto-submit path in any `send()`.
5. Per-adapter failure isolation - one failing poll cannot kill the tick.

`lib/core/engine.ts` is byte-for-byte identical to the archived v1 and should
stay that way. It must contain no channel-specific branch. Adding a channel is
one small file. When you add an adapter, state in the handoff that `engine.ts`
required no edit.

## KPI honesty

These are FIX-on-sight, because the scorecard is what the work is judged by.

- Human minutes are **timed by the app**. Self-report is never a data source.
- The minor-edit threshold is frozen in `docs/BASELINES.md` at
  `normalized_distance < 0.20 AND required_new_research = false`. **Never revise
  it after real acceptance data exists.**
- KPI #4's denominator is **attempted** runs, including step-one failures. A run
  counts in the numerator only when successful and `human_rescue = false`.
- KPI #3 covers every YELLOW artifact: drafts, research briefs, content. Each
  writes an `approvals` row.
- KPI #1's unit is a workflow-registry id. Not an agent, a file, or a phase.
- KPI #5 counts an `icp_pass` only after the quality gate and only when it is
  ready for human approval.
- "Pipeline generated" requires a written `outcomes` row. Never claim the funnel
  is wired without one.

## Usability criteria

v1 was technically correct and went unused because it needed a laptop left open
and a terminal. These are acceptance gates, not aspirations.

- **U1** laptop shut down, a lead is ingested and an alert email reaches a phone
- **U2a** the runtime stays up with no local process, terminal or startup command
- **U2b** restart, retry and pause are buttons (Phase 7)
- **U3** `/today` opens on at most five decisions, artifact inline (Phase 7)
- **U4** the full daily loop completes at 390px (Phase 7)
- **U5** approve to send to logged is two taps plus the one paste G1 requires
- **U6** hosted Postgres with a backup verified by an actual restore

Design test for any UI decision: would Athena do this from her phone while
walking? If no, it is not shipped.

## Anti-scope - do not build these, do not offer to

A large agent org chart. Any auto-send capability. Cold outbound to parents of
minors. Student leaderboards. An ESP migration. A CRM integration. Reddit,
Facebook or Nextdoor adapters. The Wright student console. Anything designed
against The Chapter beyond the existing `org_id` column. Market intelligence or
channel analytics. Content strategy as an agent decision. Wyzant fee or tracking
workarounds.

## The FACTS.md hard gate

Applicant-facing numbers are in live public conflict across Whetstone's own
surfaces. `docs/FACTS.md` records them as `BLOCKED`. **No workflow may produce
Wright, scholarship, applicant or parent-facing copy that touches a blocked
fact.** This gates Phases 8 and 12. It does not gate Phase 5, whose outreach is
Wyzant tutoring inquiries.

## House rules

- **Windows.** Athena runs Windows 11. Use PowerShell command syntax, not bash.
- **No em dashes or en dashes** anywhere: code, comments, docs, copy. Plain
  hyphens. `pnpm docs:lint` enforces this for `docs/`.
- **Small targeted edits** over large rewrites.
- **Stop before anything destructive or irreversible** and ask.
- **Never push, and never create a remote.** `whetstone-os` now has an `origin`
  at `github.com/athenahz01/whetstone-os` that Athena created. Local `master`
  may sit ahead of it. That is fine and it is not yours to reconcile: do not
  push, do not fetch, do not pull, do not rebase onto origin. Athena pushes.
  The v1 archive at `C:\AA_Whetstone\whetstone-growth-engine` still has no
  remote by choice; see `C:\AA_Whetstone\PUSH-THE-ARCHIVE.md`.
- **Do not edit the four `docs/` context files** without saying so prominently in
  the handoff. They change agent behavior at runtime with no code change.
- **Run `pnpm docs:lint` in every phase.** It is the only thing that catches a
  silent edit to a load-bearing document.
- Git operations from the Cowork audit sandbox cannot delete their own lock
  files, so stale locks get parked in `.git/_stale/`. Ignore those folders. If
  git says another process is running, delete `.git/index.lock`.

## Commands

```
pnpm verify              docs:lint, format:check, typecheck, lint, test
pnpm build               production build
pnpm test                vitest
pnpm docs:lint           the five ground-truth documents
pnpm prisma:generate     after any schema change
pnpm prisma:migrate:deploy
pnpm wyzant:poll         the Playwright poll, normally run by GitHub Actions
pnpm restore:verify      backup restore drill, never against production
```

## What needs a human, not you

Provisioning: the Supabase project, the Vercel project, the GitHub repository and
its secrets, the Wyzant storage state, the Anthropic key, the Telegram token.
Phase 1's four gates cannot close until those exist. `docs/DEPLOYMENT.md` is the
runbook. Do not attempt any of it, and do not simulate a deployment to make a
gate look met.
