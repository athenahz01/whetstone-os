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

Last updated 2026-08-27 by the auditor. Keep this current; a stale section here
is read as instruction by the next executor.

Phases 0 through 7 are complete and audited, and **all of 7.5 is built and
audited**. HEAD is `1831727` plus an uncommitted auditor pass. The test baseline
is **46 files / 680 tests / 0 skipped**; report the exact counts in every handoff
and say if they moved.

This section was three commits and 257 tests out of date until 2026-08-27, and
an executor read it while working. Update it in the same pass that moves HEAD.

All six migrations are deployed to production. **U6 and U7 both closed on
2026-08-27**, so the live Wyzant poll is no longer gated. See
`.audit/u6-u7-verdict.md` for the evidence, including the sequence defect the
restore drill caught.

Open items, none of them blocking Phase 5:

1. The S2 minor-identifying signal set covers numerals only. It must cover
   spelled-out numerals **before any live `ResearchSourceProvider` ships**. See
   the usability criteria below.
2. `.audit/dump.mjs` and `.audit/restore.mjs` are auditor tooling and belong in
   `ops/` as shipped code, with `pg` added as a dependency and a test that the
   dump emits one `setval` per serial column. Phase 11.
3. The live probe list in `docs/DEPLOYMENT.md` names only the seven Phase 1
   tables. It must enumerate every table the migration set secures plus every
   name in `TABLES_CREATED_OUTSIDE_MIGRATIONS`. A stale list there is how
   `_prisma_migrations` shipped world-readable.
4. A backup taken once is not a backup. Before real inquiries flow, the dump
   needs a schedule and the restore needs re-verifying whenever the schema
   changes.

**Phases 5, 6 and 7 are closed.** The live pipeline has run end to end: the
Wyzant poll ingests, qualification runs, and `/today` renders real leads.

**The exception channel across the runner boundary is closed as of 2026-08-27.**
Codex built it at `6e38c32`; the audit returned PASS WITH FINDINGS and **the
auditor applied all three fixes directly** - they are in the working tree,
uncommitted, and already verified at 442/442 with typecheck, lint, format,
`docs:lint` and `next build` all clean. `lib/core/engine.ts` is unchanged at
`9f95451a2e60cd143afa1d46618b34e0`. **Do not redo this work.** The full record,
findings and fixes, is `.audit/exception-channel-verdict.md`.

The one finding worth carrying forward: the malformed-job reason was free text,
and a one-line edit interpolating `job.author` put a learner's name on the wire
with all 419 tests passing. It is now a closed vocabulary in
`lib/adapters/wyzant-reasons.ts`, enforced at the adapter and again at the wire
validator. **Any new string that crosses the runner boundary needs the same
treatment**: a registered vocabulary, not a shape that admits prose.

**All four parts of 7.5 are closed.** Every audit returned PASS WITH FINDINGS and
**the auditor applied the fixes directly**, uncommitted in the tree. Full records
in `.audit/phase-7-5a-verdict.md` through `-7-5d-`. **Do not redo any of them.**

**Both handed-back tasks are done** (`fe9a7a5`), audited in
`.audit/fix-pass-verdict.md`. The Action Sheet cadence is live - Negotiate 2,
Active 3, Engage 3, Prospect 7, Cold 15 - and the twelve re-derived fixtures were
mutation-tested and bite harder than the ones they replaced, including two
tie-breaks that had no coverage before.

**The 7.5a retarget is unblocked.** `docs/REBUILT-DASHBOARD-SCHEMA.md` carries
the rebuilt sheet's header rows for all three tabs, read off the live sheet,
with the renames and the fill counts. Three traps in there: six columns are
**formulas, not data** (`Last Touch`, `Days Quiet`, `Chase After`, `Chase Flag`,
`Contactable`, `Data Flags`) and must not be imported as typed values;
`Overview` and `Action Queue` are derived tabs over `UG Sales` and importing
them would duplicate every lead; `Affiliate` has no `ID` column and is keyed on
`Full name`. The academic columns are on the canonical sheet now, so the merge
stops being a reconciliation and becomes an import.

**The flake: my diagnosis was wrong, and an executor spent a pass on it.**

I wrote here that `tests/wyzant-operational-hardening.test.ts` fails because of
"four real `setTimeout` delays, no fake timers", and told an executor to fix it
with fake timers. **That is impossible.** All four `setTimeout` calls are inside
`<script>` bodies served to the page through `route.fulfill`, so they run in the
Chromium renderer. `vi.useFakeTimers()` patches this process and cannot reach
them. The executor found this, tried two other approaches, regressed the file
twice, backed both out, and reported rather than shipping an unverifiable
rewrite. That was the right call and the wasted pass is on me.

**The real cause** is seven `chromium.launch()` calls. Isolated the file takes
about 9.8 seconds; under contention the launches dominate and a test exhausts
its budget. Below roughly 1 GB free it fails 6 or 7 of 16, and
`wyzant-extraction-fixture.test.ts` fails its teardown hook at the same time.

**Partly fixed 2026-09-02 by the auditor. Launches are down from seven to four.**
Four tests launched a browser, opened a page and closed both; they now share one
browser through `beforeAll`/`afterAll`, the pattern
`wyzant-extraction-fixture.test.ts` already used.

**The other three cannot share, and the reason is not the one first given.** They
are not tests about session replacement - the test that does that uses pure fakes
and no real browser. They expose `close: async () => actualBrowser.close()` as
the adapter's own close method, and the production code calls it, so a shared
browser would be closed mid-file by the code under test. Changing that changes
what those tests exercise. Leave them.

**Not verified against the condition that triggers it.** Eight consecutive green
full runs after the change, plus four isolated, and three more under induced
pressure - but the lowest free memory reached was 4.4 GB, and the failure appears
below 1 GB. The mechanism is addressed; the proof is a run on a loaded machine.
**Re-measure there before trusting the suite as a gate.**

**Binding, added 2026-08-27: no draft from the production outreach agent reaches
a human until the model QA has been exercised against the recorded attack tables
with a real API key.** A deterministic lint cannot be complete against
paraphrase; `voiceLint` is a floor, not the gate. The QA rules are in the prompt
and the wiring is tested, but the reviewer's judgement is untested and a stub
that rejects our own attacks would be the code marking its own homework.

**Binding, added 2026-08-27: no surface may render a `drafts` row until it has
passed `voiceLint`.** `ClaudeDraftService` runs on every ingest scoring 70 or
above and writes to `drafts` with no voice gate. Nothing reads that table today,
so it is stored and inert, but Phase 7's decision surface is where it goes live.
Converge the two draft paths or gate the surface; do not ship the surface first.

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
- **U6** hosted Postgres with a backup verified by an actual restore. **Closed
  2026-08-27.** Supabase Free has no automatic backups, so the backup is a
  data-only logical dump; the schema half is reproducible from
  `prisma/migrations`. Verified by restoring 226 seeded rows across all fourteen
  tables into a scratch project and comparing every table byte for byte. The
  drill found a real defect: the first dump omitted sequence positions, so a
  restore into a fresh database left every serial at 1 and the first write after
  recovery died on a primary key collision. Fixed with `setval` per serial and
  re-verified. **This unblocked the live Wyzant poll.** A backup taken once is
  not a backup: `ops/backup.mjs` and a schedule belong to Phase 11
- **U7** no table in `public` is readable, writable or deletable by the `anon`
  key, verified against the live deployment rather than a config screen.
  **Closed 2026-08-27.** Read side: all fifteen tables return `[]` over
  PostgREST while `leads` and `poll_heartbeats` hold rows. Write side: as the
  `anon` role against 226 rows, `UPDATE` and `DELETE` touch nothing and `INSERT`
  is refused with `42501`. The probe list in `docs/DEPLOYMENT.md` went stale
  phase by phase and that is how `_prisma_migrations` shipped world-readable;
  it must enumerate every table the migration set secures plus every name in
  `TABLES_CREATED_OUTSIDE_MIGRATIONS`
- **S2 source filter** the minor-identifying signal set covers numerals only.
  **Before any live `ResearchSourceProvider` ships, it must also cover
  spelled-out numerals** - written ages (`sixteen years old`), written grades
  (`eleventh grade`, `tenth grader`, `eighth grade`) and `Year N` - with both
  the must-exclude and must-pass tables extended and each new clause probed on
  its own. Recorded at the Phase 4 pass on 2026-08-27. Safe until then only
  because the provider is an interface with no implementation

Design test for any UI decision: would Athena do this from her phone while
walking? If no, it is not shipped.

## Anti-scope - do not build these, do not offer to

A large agent org chart. Any auto-send capability. Cold outbound to parents of
minors. Student leaderboards. An ESP migration. **A third-party CRM product
integration** - HubSpot, Pipedrive, Attio, Airtable, Notion. Reddit, Facebook or
Nextdoor adapters. The Wright student console. Anything designed against The
Chapter beyond the existing `org_id` column. Market intelligence or channel
analytics. Content strategy as an agent decision. Wyzant fee or tracking
workarounds.

**Disambiguated 27 Aug 2026.** This entry used to read "a CRM integration", and
an executor correctly stopped on it when handed the Phase 7.5 brief. It forbids
adopting a CRM _product_, for the reason the build plan gives: the new Postgres
is the system of record, and adding a product now is a migration on the critical
path. **Ingesting Whetstone's own lead records into that Postgres is not the
forbidden thing; it is what this entry protects.** That work is Phase 7.5,
`docs/PHASE-7.5-CRM.md`, and it is in scope. Section 4 of that document rejects
every CRM product for exactly the reason above.

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
