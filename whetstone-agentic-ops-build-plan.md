# Whetstone Agentic Operations - Build Plan

**Auditor:** Claude (Cowork) · **Executor:** ChatGPT Codex · **Owner:** Athena
**Source inputs:** Cole's *AI Agent Squad - Week One Brief*, *Week 1 KPI Scorecard*, and the 49 docs in the Whetstone project.
**Structure:** phases and gates. No dates, no day-numbers. A phase is done when its acceptance boxes are all checkable and the audit returns PASS.

---

## 0. What this plan actually is

Cole asked for an AI-native operating system with sales as the first proof point, and set the rule: **no more than 20% of effort on architecture, at least 80% on getting workflows running.** He also set the anti-KPI: *the number of agents created is not a success metric.*

So this plan builds **three workflows and one surface**, not an agent org chart.

| | |
|---|---|
| **S - Sales pipeline** | Prospect → qualify → research → prepare outreach → follow up → daily human action queue |
| **M - Marketing production line** | Idea ledger → issue draft → fact-check → QA → approve → fan out to four channels |
| **B - Weekly intelligence brief** | Pipeline deltas, stalls, content state, KPI snapshot, five recommended actions |
| **The surface** | `/today` - five decisions, on a phone, in under five minutes |

Everything else in Cole's brief (org chart, automation map, agent specs, dashboard, economics scorecard, 30-day roadmap) is a **document generated from the running system**, not a separate build. Phase 11 emits them from live data.

---

## 1. The honest diagnosis: why v1 didn't get used

Whetstone already has a Growth Engine. Its own build ran in phases too, and all of *its* phases 0-8 logged PASS - a separate numbering from the 0-12 in §6 below, which describes this build. It read Cole's Wyzant board, drafted with Sonnet, alerted over Telegram, gated human sends, and rendered a scoreboard. On paper it worked.

**It went unused. That is the single most important fact in this document.** Athena's words: *"never actually able to use that engine, felt so so hard to use, and I didn't like that it needs my laptop open 24/7."*

An agent system nobody opens saves zero hours. KPI #2 is structurally zero. So v1's non-adoption is not a footnote - it is the primary defect this build has to fix, and it converts into hard acceptance criteria rather than good intentions.

| v1 failure mode | Why it killed adoption | The acceptance test it becomes |
|---|---|---|
| Ran on `zheng`, a Windows laptop that "must never sleep" | The system is off whenever the laptop is. Leads arrive and nothing happens. Speed-to-lead - the entire competitive thesis - is unenforceable. | **U1.** Laptop closed and powered down, a lead is ingested and a Telegram alert arrives on the phone. |
| PM2 + Task Scheduler + `pnpm` commands | Operating the system required a terminal. Every restart was a debugging session. | **U2.** No terminal command is required for any normal daily action. Restart, retry, and pause are buttons. |
| Two panels (`/review`, `/scoreboard`) and no answer to "what do I do now" | The tool showed state, not decisions. The human still had to work out the next action. | **U3.** `/today` opens on a list of at most five decisions, each with the artifact inline and an approve / edit / skip control. |
| Desktop-only layout | The work happens between sessions, on a phone. | **U4.** Full daily loop completes on a 390px viewport. |
| "Approve & prefill" → paste into Wyzant → come back → "Mark sent" | Four context switches per message. Friction taxed exactly the action the system existed to produce. | **U5.** Approve → send → logged is at most two taps plus the paste that the human-send guardrail deliberately requires. |
| Repo never committed; DB was a local SQLite file | No backup, no history, no second machine. One disk failure is total loss. | **U6.** State lives in a hosted Postgres with backups. Repo is committed and pushed. |

**Design principle carried through every phase below:** *if Athena would not do it from her phone while walking, it is not shipped.*

### What gets salvaged, and what gets replaced

The engine's **logic is good and stays**. Its **runtime and its UI are the problem and go**. This is what keeps the build inside Cole's 20% architecture rule - the thinking is already done and paid for.

**Salvage (port as-is, with tests):**
- `lib/core/types.ts` - the `Lead` / `Draft` / `ChannelAdapter` contracts. These are sound. Keep them.
- `lib/core/scoring.ts` - `scoreLead()`.
- `lib/core/drafting.ts` - the three-variant A/B drafter. **Keep the `temperature` removal** (Sonnet 5 returns `400 deprecated`).
- `lib/core/alerts.ts` - Telegram.
- `lib/core/engine.ts` - the `tick()` poll→score→alert→draft→save loop, and its rule that it contains no channel-specific branch.
- `lib/adapters/wyzant.ts` - **keep the widened host check** (`hostname !== "wyzant.com" && !hostname.endsWith(".wyzant.com")`); Wyzant redirects `www.wyzant.com/tutor/jobs` → `highered.wyzant.com`.
- The five inherited guardrails. Non-negotiable, restated in §3 alongside the two this build adds.
- The existing Vitest suite.

**Replace:**
- SQLite → **Supabase Postgres** (Whetstone already runs Supabase).
- PM2 + Windows Task Scheduler → **Vercel Cron** for scheduled work, **GitHub Actions** for the Playwright Wyzant poll.
- `zheng` → **Vercel** (already the Whetstone/Wright host).
- `/review` + `/scoreboard` as the primary UI → **`/today`**, mobile-first. The old panels survive as secondary views.
- No auth → **Supabase magic link**.

**Before anything else: commit the existing repo and tag it `v1-local-archive`.** It is currently uncommitted and contains two live production fixes that exist nowhere else.

---

## 2. What changed since the brief was written

Three facts move the plan, and the plan is wrong without them.

**Cole's Wyzant approvals landed.** He is now approved and carrying personalized text for **College Counseling, English, Essay Writing, SAT Reading**. The Phase-5 blocker in the old build log - "returns 0 jobs because Cole is only approved for niche subjects" - is resolved. Wyzant is a live, inbound-intent channel and becomes the sales pilot's primary lane.

Two consequences the build must encode:
- **Scope filter.** He is *not* approved for SAT Math, ACT Math/English/Science. The qualifier must mark those out of scope rather than drafting for work he cannot legally take. `docs/ICP.md` carries the approved-subject list as data, not as a comment.
- **The extraction selectors have never been verified against a populated board.** This was a standing caveat. It is now testable and becomes a Phase 3 gate, not an assumption.

**There is still no system of record.** No CRM anywhere: no HubSpot, Pipedrive, Airtable, Notion, Calendly, Zapier, Stripe. Lead state currently lives across Nick's phone calls, a Tally form, a Google Doc, an unprovisioned ESP, the Wyzant inbox, and a local SQLite file. The new Postgres **becomes** the system of record. That is a deliberate decision, not a side effect.

**Applicant-facing numbers are in live public conflict.** Wright tuition reads $5,500 on the site and $4,500 on the form. The demo-day prize is "$5,000 to one team" on one surface and "$1,000 each to 10 winners plus full tuition" on the other. The scholarship award renders $26,000 in one place and $35,000 in another; deadlines disagree across a nine-day span of docs.

> **Hard gate.** An agent that generates external copy will propagate whichever version it reads first, at volume, in Whetstone's name. **No workflow may produce applicant- or parent-facing copy until `docs/FACTS.md` exists and every conflict in it is either resolved or marked `BLOCKED`.** This is Phase 0.4, and it blocks Phases 8 and 12.

**"The Chapter" is not in the project.** Four search passes found nothing - no brand, program, or entity by that name. Every "chapter" hit is a book chapter in a reading list. Cole's message names it as a later target, so the architecture below is built to take a second tenant (§12), but nothing is designed against it until someone hands over a source. Likely candidates: `CLAUDE.md`, `GTM.md`, or something newer than the project docs.

---

## 3. The seven guardrails

Carried forward verbatim from the v1 build prompt. Every phase's audit re-checks all seven, individually. If a task appears to require breaking one, **Codex stops and flags it in the handoff** rather than proceeding.

| | Guardrail | Why |
|---|---|---|
| **G1** | **Human-send gate.** `adapter.send()` may record, prefill, and open a compose box. It may never auto-submit. `sent_by` is always a human. | This is the line between "a tutor using AI to work faster" (fine) and "a bot mass-replying to posts" (banned on sight). |
| **G2** | **Own accounts only.** No scraper accounts, no sock puppets, no impersonation. | Permanent-ban risk, and it is dishonest. |
| **G3** | **Human-cadence polling.** Minutes, jittered. | Looks like a person because it is acting for a person. |
| **G4** | **On-platform.** Nothing that evades Wyzant's fee or lesson tracking, or moves sessions off-platform. | Permanent ban. Permanently out of scope. |
| **G5** | **Secrets in env only**, never committed. Never log message bodies or PII at info level. | Client data. Families of minors. |

Two additions this build introduces:

| | Guardrail | Why |
|---|---|---|
| **G6** | **No cold outbound to parents of minors.** Outbound targets are Wyzant inbound inquiries (they contacted us), dormant contacts who previously opted in, and professional referral partners (counselors). | Contradicts "application, not a reservation," and it is the wrong risk to take on a pilot. |
| **G7** | **No comparative ranking of students, ever.** No leaderboards, no cohort rankings, no cross-student scoring surfaced to a student or parent. | The Wright curriculum explicitly bans comparing fellows to each other. Bake it in now; it is expensive to retrofit. |

---

## 4. The shared operating system

Cole's spine, implemented as one code contract rather than a diagram:

```
Goal → Agent/Automation → Task → Output → QA → Handoff → Action → Measurement
```

```ts
type ApprovalLevel = 'GREEN' | 'YELLOW' | 'RED'

interface Workflow {
  id: string                    // 'S1.qualify' - the registry key; KPI #1 counts these
  goal: string                  // one sentence, human-readable
  approvalLevel: ApprovalLevel
  owner: string                 // a person's name. never 'the system'
  inputs: ContextRef[]          // which docs/tables it may read
  tools: ToolGrant[]            // every API, adapter and table it may touch. Cole's
                                // deliverable #5 requires tools/data access per agent,
                                // so this is a field, not a comment.
  steps: Step[]
  outputs: OutputSpec[]         // shape + destination of what it produces
  qaGates: QaGate[]             // must all pass before handoff
  handoff: Handoff              // who or what receives the output, and in what state.
                                // This is Cole's Handoff stage. Without it the spine is
                                // a diagram, not a contract.
  escalation: EscalationRule[]  // condition → who → how
  measures: MeasureRef[]        // which KPIs this run feeds
}
```

**Approval levels are enforced in code, not by convention.**

| Level | Rule | In this build | Enforcement |
|---|---|---|---|
| **GREEN** | Autonomous | Monitoring, enrichment, scoring, stall detection, reporting, the weekly brief | Runs unattended. Every run still writes a `run` row. |
| **YELLOW** | Human review before external action | Outreach drafts, research briefs, content, follow-up touches | Cannot reach an external surface without an `approvals` row carrying a human `approved_by`. |
| **RED** | Human-owned | Money, contracts, pricing, commitments, sensitive relationships, anything to a current client family | **No code path exists.** Not a flag that could be flipped - the capability is absent. The audit checks this by grep, not by trust. |

*Autonomy is earned - but only autonomy over external action.* A workflow's entry level is set by what it can touch, not by seniority:

- **A workflow that takes no external action is GREEN at birth.** Ingesting, deduping, scoring, linting, stall detection, reporting. There is nothing to review, because nothing leaves the building. `S1.ingest`, `S1.qualify`, `S3.voicelint`, `S4.stalls` and `B1.brief` ship GREEN for this reason.
- **Every workflow that produces something external enters at YELLOW**, without exception. Promotion of one of these to GREEN requires a documented window at ≥90% workflow success and ≥80% output acceptance, recorded in `docs/AUTONOMY-LOG.md` with the date and the numbers.
- **No workflow is ever promoted into RED.** RED is not a higher autonomy tier; it is the set of things the system does not do.

Nothing is promoted on a hunch, and `AUTONOMY-LOG.md` is created in Phase 2 alongside the approval machinery so the mechanism exists before there is anything to promote.

### Shared context, one source

Agents do not carry their own opinions about Whetstone. They read the Phase-0 docs through one loader:

```
docs/ICP.md      → who qualifies, and Cole's approved subjects (machine-checkable criteria)
docs/VOICE.md    → every voice rule, ban, length, and structural law, compiled from the project docs
docs/FACTS.md    → prices, dates, awards, credentials - each line with a "verified on" date
docs/BASELINES.md→ human minutes per recurring task, with the method used to measure
```

These four are the *agent-readable* set. `docs/AUTOMATION-MAP.md` and `docs/AUTONOMY-LOG.md` are human-facing records - they are not loaded into any prompt, deliberately, because a map of intentions is not an input to a decision.

`lib/core/context.ts` loads and **content-hashes** each of the four. A prompt cache keyed on that hash means editing `VOICE.md` invalidates every downstream prompt automatically. Change the doc, change the behavior - no code edit, no redeploy.

---

## 5. Target architecture

```
                    ┌─────────────────────────────┐
  GitHub Actions    │   Vercel  (Next.js App)     │   Vercel Cron
  ─ Wyzant poll ───▶│                             │◀── tick, digests,
    (Playwright,    │   /today      the surface   │    weekly brief
     cron, storage  │   /pipeline   sales state   │
     state secret)  │   /content    marketing     │
                    │   /economics  KPI scorecard │
  IMAP ────────────▶│   /dashboard  4 panels      │
  (reply ingest)    │   /api/ingest               │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐        ┌──────────────┐
                    │  Supabase Postgres          │        │  Telegram    │
                    │  system of record + auth    │───────▶│  1 digest +  │
                    │  (magic link, backups)      │        │  exceptions  │
                    └─────────────────────────────┘        └──────────────┘
                                   │
                          Anthropic API (claude-sonnet-5)
                          cost caps · rate limits · kill switch
```

**Why each choice:** Vercel and Supabase are already in Whetstone's stack, so this adds no new vendor to learn. GitHub Actions runs the one job that genuinely needs a real browser (Playwright against Cole's own Wyzant session) on a schedule, for free, with no always-on machine - which is the entire point. Telegram is the notification channel because it reaches a phone; the fix for v1's noise is that it sends **one digest plus exceptions**, never a stream.

**One orchestration layer, not two.** v1's `engine.ts` `tick()` loop is salvaged, but it does not run beside the new `runWorkflow()` - it becomes a workflow executed *by* it (`S1.ingest`). This matters directly for KPI #4: if adapter polls happened inside `tick()` without writing `run` rows, the "attempted runs" denominator would silently exclude the most failure-prone step in the system, and the success rate would look excellent because the failures were never counted.

**The known operational wrinkle:** Wyzant's saved storage state expires. When it does, the poll silently returns nothing - which looks exactly like a quiet day. Phase 11 requires a **staleness detector**: if the poll returns zero for N consecutive runs *or* hits a login redirect, it raises a distinct `SESSION_STALE` exception with a link to the documented re-capture ritual. Silent failure is the failure mode that kills trust in an ops system.

---

## 6. The phases

Every phase is written as **Goal → Build → Acceptance → Tests → Audit focus**. Codex builds one phase, prints the AUDIT HANDOFF block (§8), and **stops**. Claude audits. On PASS, Athena types `continue`. On FIX, Codex addresses the items and re-prints the handoff **for the same phase**. Never skip ahead.

Phases 0-7 are the sales proof point. Phase 8 is the marketing proof point. Phases 9-11 are the measurement and reporting layer Cole asked for. Phase 12 is gated on evidence and is not part of the pilot.

---

### Phase 0 - Ground truth

*No agent code. Nothing downstream is trustworthy without this, and three of the five KPIs are literally unmeasurable without it.*

**Goal.** Establish the five documents (four agent-readable, one human-facing) that everything downstream depends on, capture the human baselines the economics case depends on, and get the existing work into version control.

**Build.**
- **0.1 Archive v1 - safely.** The working directory holds a local SQLite database with real lead and family data, a Wyzant storage state, and API keys on disk. So the order is: write `.gitignore` (`.env*`, `*.sqlite`, `*.db`, `playwright/.auth/`) → run a secret scan → **then** commit, push, and tag `v1-local-archive`. Committing first and scanning later manufactures exactly the condition Phase 11 has to prove absent. Two production fixes in that directory exist nowhere else, so the archive itself is not optional.
- **0.2 `docs/ICP.md`.** Written ideal-customer-profile criteria, expressed so a program can evaluate them - not prose. Includes: Cole's approved Wyzant subjects (`College Counseling`, `English`, `Essay Writing`, `SAT Reading`) as the in-scope list; the out-of-scope list (SAT Math, ACT sections) with the reason; grade range; geography rules (routes the room, never disqualifies); the Lane C rule (5th-7th grade → nurture, never a flat no); and the disqualifiers, including "senior with three weeks to a deadline."
- **0.3 `docs/VOICE.md`.** Every rule compiled from the project docs into one enforceable file. Banned words and phrases: *consultation, ikigai, Common App, capstone, first come first served, you'll get a spot*, any promised outcome. No em dashes in sequence copy. One ask, phrased as a question. A disqualifier attached to every ask. One link per message, maximum. Lengths: Brief 400-500 words, Office Hours 250-350, Teardown 1,200-1,800, subject lines 2-6 words, PS under 25 words, sign-off 2-5 words. Structural laws: one sentence per paragraph, numbers not adjectives, three implementation steps or it didn't happen, one admitted failure of our own per issue. Sign-off is ` -  Cole`, never a brand signature.
- **0.4 `docs/FACTS.md`.** One line per externally-stated fact - prices, deadlines, award amounts, seat counts, credentials - each with a source URL and a `verified` date. Every conflict from §2 listed and either resolved or marked `BLOCKED: <who decides>`.
- **0.5 `docs/BASELINES.md`.** Current human minutes for each recurring task, with the measurement method stated per line (timed / recalled / estimated-from-artifact). At minimum: minutes to research one prospect, minutes to write one outbound message, minutes to write one newsletter issue, minutes to repurpose one asset into one channel, minutes to assemble a weekly status picture, minutes of prep per Harvard Club event. Known starting figures to fold in: ~1 hour of named-item prep per 10-seat event; 9 content pieces per month; Nick calls every lead.
- **0.6 `docs/AUTOMATION-MAP.md`.** Every recurring Whetstone function classified `Human-owned` / `Agent-assisted` / `Approval-required` / `Autonomous`, each row carrying Cole's four questions: what human work it replaces, how often that work occurs, the economic value of improving it, and how we will know the new system is better.

**Acceptance.**
- [ ] `.gitignore` written and a secret scan run **before** the archive commit. No `.env`, no `*.sqlite`, no storage state in the commit.
- [ ] v1 repo committed, pushed, tagged. `git log` shows the two live fixes preserved.
- [ ] All five docs exist and are non-empty.
- [ ] Every `ICP.md` criterion is machine-checkable - a human reading it can say exactly what field or evidence decides it.
- [ ] Every ban in the project docs appears in `VOICE.md`. None invented, none dropped.
- [ ] Every conflict named in §2 appears in `FACTS.md` as resolved or `BLOCKED`.
- [ ] `BASELINES.md` states a measurement method per line. No unexplained numbers.
- [ ] `AUTOMATION-MAP.md` answers all four of Cole's questions for every row.

**Tests.** A `docs:lint` script asserting all five files exist, are non-empty, and parse; `FACTS.md` contains no line missing a `verified` date; `ICP.md` parses into a structured criteria object the qualifier can consume.

**Audit focus.** This is a reading audit, not a code audit. I check that `VOICE.md` is faithful to the source docs rather than a plausible-sounding paraphrase, that `ICP.md` is actually decidable, that no baseline is a number someone made up, and that `FACTS.md` does not quietly pick a side in a conflict Cole has to settle.

---

### Phase 1 - Off the laptop

*The phase that makes v2 different from v1.*

**Goal.** The system runs with Athena's laptop shut. Everything reachable from a phone.

**Build.**
- Port the Prisma schema SQLite → Supabase Postgres. Migrations committed. Existing tables preserved: `tutors`, `leads`, `drafts`, `outcomes`, `profiles`, `metrics_daily`.
- **`org_id` on every table, from the first migration.** Not because a second tenant exists - "The Chapter" has no source yet - but because retrofitting a tenant key across a live schema is the one migration that is genuinely painful later. Default it to the Whetstone org and never expose it in the UI.
- Port the **IMAP adapter** (`ImapFlow` + `MailParser`) with the rest of the salvage, so Phase 6's reply ingestion has a working transport to build on rather than a stack-table promise.
- Deploy the Next.js app to Vercel. Supabase magic-link auth in front of it.
- **Vercel Cron** replaces PM2 for the scheduled tick, digests, and the weekly brief.
- **GitHub Actions** scheduled workflow runs the Playwright Wyzant poll: headless Chromium, storage state from an encrypted repo secret, jittered start, POSTs results to `/api/ingest` with a shared secret.
- Telegram alerts send from the cloud.
- Port the salvage list from §1 with its Vitest suite intact.
- **Regression locks** - a test per item, each named for the bug it prevents:
 - `drafting.ts` sends no `temperature` parameter (Sonnet 5 returns `400 deprecated`).
 - `wyzant.ts` accepts any `*.wyzant.com` host (Wyzant redirects to `highered.wyzant.com`).
 - Dedupe: `lead.id` is a stable hash of channel + native id; re-ingesting the same lead creates no second row.
 - `send()` has no auto-submit path.
 - A failing adapter poll cannot kill the tick.

**Acceptance.**
- [ ] **U1** - laptop shut down. A lead is ingested by the scheduled poll and a Telegram alert lands on the phone.
- [ ] **U2a** - the runtime stays up with no terminal: no process to start, nothing to keep alive, no command to re-run after a crash. (**U2b** - restart, retry and pause as buttons - lands in Phase 7, where there is a surface to put them on.)
- [ ] **U6** - data in hosted Postgres; automated backup verified by a restore into a scratch database.
- [ ] Auth works from a phone browser.
- [ ] All five regression locks pass, each named for its bug.
- [ ] `org_id` present on every table, with a migration test asserting it.
- [ ] Missing `ANTHROPIC_API_KEY` degrades gracefully - warn, no crash loop.
- [ ] Missing Telegram token degrades gracefully - warn, keep running.
- [ ] Deployment is reproducible from a clean checkout plus documented env vars. Nothing depends on `zheng`.

**Tests.** The five regression locks. An adapter-contract test per adapter. A migration test asserting Postgres parity with the archived SQLite schema. A degradation test per missing-secret case.

**Audit focus.** I try to break the "off the laptop" claim: grep for anything that assumes a local path, a Windows path, PM2, or a long-lived process. I confirm the storage-state secret is not committed and not logged. I check backups by asking for evidence of a restore, not a settings screenshot.

---

### Phase 2 - The operating system in code

**Goal.** Cole's spine becomes a contract every workflow implements, and the KPI substrate exists before there is anything to measure.

**Build.**
- `lib/core/workflow.ts` - the `Workflow` interface from §4 plus `runWorkflow()`: writes one `run` row per execution, one `run_step` row per step, isolates per-step failure, enforces `approvalLevel` before any external action, and records measurements.
- New tables:
 - `runs` - workflow id, started, ended, status, trigger, human_minutes, cost_usd, **`human_rescue` (bool) + `rescue_note`**. Without the rescue field, a run someone quietly fixed by hand is indistinguishable from a clean one, and KPI #4 - which the KPI doc defines as reaching the final state *without unplanned human rescue* - becomes unmeasurable. This single column is the difference between a real success rate and a flattering one.
 - `run_steps` - run id, step, status, input hash, output ref, error, duration
 - `approvals` - run id, level, approved_by, `decision` (accept / accept-with-edits / reject), edit_distance, **`required_new_research` (bool)**, decided_at. **Every YELLOW output writes one of these** - outreach drafts, research briefs and content alike - which is what makes KPI #3 cover all three rather than drafts only.
 - `measurements` - run id, kpi, value, unit
 - `exceptions` - run id, kind, severity, message, resolved_at
- `lib/core/context.ts` - the content-hashing doc loader from §4.
- `docs/AUTONOMY-LOG.md` created here, empty, with its header - the promotion mechanism from §4 needs a file before it needs an entry.
- Approval enforcement: `GREEN` runs unattended; `YELLOW` requires an `approvals` row with a human `approved_by` before any external surface is touched; `RED` has **no implementation**.
- **Cost and rate caps.** A per-day token/dollar ceiling, a per-workflow rate limit, and a global kill switch exposed as an admin route and a DB flag the scheduler reads. (Phase 7 puts a button on it; Phase 2 must not depend on a surface that does not exist yet.) When the cap trips, the system stops and raises an exception - it does not silently degrade.
- KPI queries as single indexed reads, not N+1.

**Acceptance.**
- [ ] A mock workflow runs end to end and produces a complete record: `run` + `run_steps` + a QA verdict + an approval gate + a `measurements` row.
- [ ] A `YELLOW` workflow cannot reach an external surface without an approval row. Proven by a test that tries and fails.
- [ ] No `RED` code path exists. Provable by grep.
- [ ] One failing step does not fail the other steps or the tick.
- [ ] The five KPI queries each return a real number from the mock data in a single indexed read, and KPI #4's denominator is **attempted** runs - including a seeded run that failed at step one.
- [ ] A run marked `human_rescue = true` is excluded from KPI #4's numerator. Proven by fixture.
- [ ] Kill switch stops all scheduled work, via the admin route and the DB flag. No dependency on `/today`.
- [ ] Cost cap trips into an exception, not a silent stop.

**Tests.** Workflow-contract test. An approval-bypass attempt that must fail. Per-step failure isolation. KPI aggregation against a known fixture with hand-computed expected values. Cost-cap trip test.

**Audit focus. This is the phase I audit hardest.** Everything after it inherits its assumptions. I specifically try to construct a path where a YELLOW workflow reaches outside without an approval row, and I verify the KPI queries against the fixture by hand rather than trusting the test's own expectations.

---

### Phase 3 - S1: Prospecting and qualification (GREEN)

**Goal.** A continuous supply of prospects, each with a written ICP verdict and its evidence. This is what KPI #5 counts.

**Build.**
- **`wyzant` adapter - now the primary lane.** Filter to Cole's approved subjects. **Verify the extraction selectors against a populated board** - this was never possible before and is the phase's real gate. Port `ops/wyzant-diagnose.ts` from the v1 archive (the new repo layout must keep an `ops/` directory) and re-run it; if the board shows a job and the adapter shows zero, tune the selectors before claiming the phase.
- **`reengagement` adapter.** Import dormant contacts who previously opted in: the Harvard Club signups (19 signed up, 4-5 showed), unconverted Wyzant threads, early-inquiry parents. The docs are blunt that today these are simply lost. Every record carries its consent provenance - where and when they opted in. No provenance, no outreach.
- **`referrals` adapter.** The existing CSV/JSON importer. This is the lane that was verified live end-to-end in v1, so it is the safest thing to smoke-test the new runtime with.
- **`counselors` adapter** *(secondary)*. Independent counselors and feeder-school counselors - the docs call them the highest-leverage contacts per head. Publicly listed professional contact information only. Never sell to them; be useful. G6 applies: this is the referral-partner lane, not a parent lane.
- **`qualify()`** - reads `docs/ICP.md`, emits `{ verdict: pass | fail | out_of_scope, rationale, evidence[], confidence }`. `out_of_scope` is a distinct verdict for work Cole is not approved to take, so it never becomes a draft.
- Dedupe across adapters, not just within one.

**Acceptance.**
- [ ] Each adapter implements the `ChannelAdapter` contract with no change to `engine.ts`. Codex states this explicitly in the handoff.
- [ ] The Wyzant adapter returns real jobs from a populated board, and the parsed fields are verified against what the page actually shows.
- [ ] SAT Math / ACT inquiries are marked `out_of_scope`, not drafted.
- [ ] Every prospect carries an ICP verdict, a rationale, and at least one evidence reference.
- [ ] Every `reengagement` record carries consent provenance. Records without it are rejected at import, not silently skipped.
- [ ] Cross-adapter dedupe holds - the same person from two channels is one row.
- [ ] Polling is jittered and human-cadence (G3).
- [ ] Qualified-prospect counts feed KPI #5's pipeline, counting only `pass` verdicts. (KPI #5 itself completes in Phase 5 - see §8: a prospect counts once it is *ready for human approval*, which requires a prepared draft.)

**Tests.** Adapter-contract test per adapter. A Wyzant extraction test against a saved real-page fixture. Cross-adapter dedupe test. A consent-provenance rejection test. An `out_of_scope` routing test.

**Audit focus.** I read the Wyzant fixture against the parsed output field by field - v1's selectors were never verified and that is exactly the kind of thing that passes a test written against its own assumptions. I check `qualify()` cites evidence rather than producing confident prose, and that consent provenance is enforced at the boundary rather than trusted.

---

### Phase 4 - S2: Prospect research (YELLOW)

**Goal.** For each qualified prospect, a short brief that makes the human's next five minutes obviously better than their unaided five minutes.

**Build.**
- The research agent emits: why this prospect is a fit (grounded in `ICP.md`), **three specific hooks** with sources, **one honest disqualifier**, declared unknowns, and a confidence score.
- **Citation-check QA gate.** Any claim without a source fails the brief. A failed brief does not ship - it goes to `exceptions` with the offending claim named.
- **Unknowns are a required field.** A brief that declares nothing unknown is treated as suspect: the docs are explicit that specificity is the whole product and a stale or invented number costs more here than anywhere else.
- Public sources only. No enrichment vendor, no purchased data, no personal data about minors.

**Acceptance.**
- [ ] Every shipped brief has ≥1 source per factual claim.
- [ ] A brief containing an uncited claim fails the gate. Proven with a deliberately-uncited fixture.
- [ ] Briefs declare unknowns rather than filling gaps.
- [ ] No brief contains information about a minor beyond what the prospect themself supplied. **Verified by a scoped-source test**: the agent may only cite sources it recorded in `evidence[]`, and a fixture containing a minor's personal detail in a fetched page must be excluded from the brief with the exclusion logged.
- [ ] Each brief writes an `approvals` row on review (accept / accept-with-edits / reject + edit distance), so briefs enter KPI #3 alongside drafts. (Read-time measurement arrives with Phase 7's timer; until then the acceptance decision is the recorded signal.)

**Tests.** Citation-gate test with an uncited fixture. A hallucination probe: a prospect with deliberately thin public information must produce a low-confidence brief with declared unknowns, not a confident one.

**Audit focus.** I spot-check briefs against their cited sources by opening them. The failure mode here is not a crash - it is a fluent, plausible, wrong brief that sails through every automated check.

---

### Phase 5 - S3: Outreach preparation (YELLOW, human-send)

*Blocked on Phase 0.4 `FACTS.md`.*

**Goal.** Draft outreach that Athena or Cole sends with a minor edit or none. This is KPI #3.

**Build.**
- Draft agent v2, loaded with `VOICE.md` and `FACTS.md`. Two or three variants retained for A/B (v1's `specific-first`, `question-led`, `plan-first` naming is fine and already has scoreboard support).
- **`voiceLint()` - deterministic, runs before the LLM QA.** Cheap, reliable, and catches what a model reviewer forgives:
 - banned words: `consultation`, `ikigai`, `Common App`, `capstone`, `first come first served`, `you'll get a spot`
 - em dashes in sequence copy
 - link count > 1
 - outcome-promise patterns
 - missing disqualifier
 - ask not phrased as a question
 - length outside the type's bound
 - any fact not present in `FACTS.md`
- **LLM QA second**, scoring against the eleven compressed rules from the playbook. Deterministic lint first means the model is never asked to judge something a regex settles.
- **G1 preserved exactly.** Prefill only. The engine stops before Send. `sent_by` is always human.
- **"Minor edit" implemented in two parts, because the KPI doc's definition has two parts.** It defines a minor edit as one that "does not require rethinking, substantial rewriting, **or new research**." Edit distance alone misses the third clause - a one-sentence factual correction that sent the reviewer back to a source is a small diff and a big failure. So an approval counts as a minor edit only when **both** hold: edit distance under the threshold (starting at ~15% of characters changed) **and** the reviewer did not set `required_new_research`. One checkbox, and the metric stops lying. The threshold and its rationale live in `docs/BASELINES.md` so the number is auditable rather than convenient.

**Acceptance.**
- [ ] `voiceLint()` blocks every banned pattern. One test per ban.
- [ ] A draft citing a fact absent from `FACTS.md` fails.
- [ ] No auto-submit path exists (G1). Provable by grep and by test.
- [ ] Edit distance is stored on every approval.
- [ ] KPI #3 computes from real approvals, using the implemented definition.
- [ ] Variants are recorded so reply-rate-by-variant still works on the scoreboard.
- [ ] A draft that reaches ready-for-human-approval marks its prospect as counting toward KPI #5. This is where KPI #5 completes.

**Tests.** One `voiceLint` test per banned pattern. A fact-not-in-FACTS rejection test. A no-auto-submit test. An edit-distance calculation test with hand-computed fixtures.

**Audit focus.** I read a real sample of drafts against `VOICE.md` myself. Automated voice checks pass things that are technically compliant and tonally wrong, and this copy goes out under Cole's name to families who are paying for judgment. I also confirm the edit-distance threshold was set before seeing results, not tuned afterward to make KPI #3 look better.

---

### Phase 6 - S4: Follow-up and pipeline state (GREEN + YELLOW)

**Goal.** Nothing is dropped. Cole's daily question - *who needs follow-up, which opportunities are stuck* - is answered by the system rather than by memory.

**Build.**
- `sequences` and `touches` tables - a next-touch scheduler with per-sequence timing rules.
- **Reply ingestion** through the existing IMAP adapter. Classifies intent: `interested` / `not now` / `no` / `auto-reply` / `needs human`. Proposes the next action; never takes it.
- **Stall detection (GREEN).** No reply in N days at stage X → surfaced on `/today` with the proposed next touch attached.
- **Follow-up drafts (`S4.followup`, YELLOW).** Same `voiceLint` + QA path as Phase 5. This is a distinct workflow from `S4.stalls`, which only detects - detection and drafting have different approval levels and must not share an id.
- **Outcome logging.** `outcomes` is ported in Phase 1 and read in Phase 10, and until something writes it the pipeline half of Cole's Friday criterion is unevidenced. So logging replied / call booked / converted / revenue becomes a first-class action here, surfaced on `/today` in Phase 7. Response rate, qualified-conversation rate, meetings booked and pipeline value are all derived from this one table.
- **The Harvard Club sequence, encoded from the docs as written.** Five emails plus three SMS templates, with the documented branches:
 - long gap (8-14 days) → full sequence
 - short gap (2-4 days) → compress, drop Email 2
 - branch on file completion → materials-in families skip the nudge lines; still-missing families get **one soft chase per email, never more**
 - the named-item lever fires in the T-1 email and the morning-of SMS, *"which is exactly where no-shows happen"*
 - **Note the v1/v2 conflict:** two versions of this flow are live in the project (5-email and 6-email, different subject lines, different assets). `FACTS.md` must pick one. The build encodes v2 unless Cole says otherwise.
- **RED boundary.** Anything touching money, contracts, pricing, or a current client family has no code path.

**Acceptance.**
- [ ] Every prospect at every stage has a next action or an explicit reason it has none.
- [ ] Stall detection fires against a fixture with known-stalled records.
- [ ] Reply classification is measured on a labeled set, and the accuracy figure is reported rather than assumed.
- [ ] The one-soft-chase-per-email rule is enforced in code - a second chase is impossible, not discouraged.
- [ ] The compress branch drops Email 2 correctly on a 3-day gap fixture.
- [ ] `RED` actions have no implementation.
- [ ] Every scheduled touch is traceable to the sequence rule that produced it.
- [ ] `outcomes` is written by a real logged outcome, and the funnel figures derive from it. **Nothing may claim the funnel is "wired" without a row in this table.**

**Tests.** Stall-detection fixture. Reply-classification accuracy on a labeled set. Sequence-branch tests for both gap lengths and both file-completion states. A chase-limit test attempting a second chase.

**Audit focus.** I check the sequence against the source doc line by line - timings, branches, the exact placement of the named-item line. This sequence is the fix for a documented 25% show rate, so a subtly wrong branch is expensive. I also confirm "propose, never take" holds for reply handling.

---

### Phase 7 - The Sales Manager: `/today`

*The Friday deliverable's human-facing surface. Cole's stated ideal: "Here is what happened. Here is what matters. Here are the five decisions we need from you."*

**Goal.** One surface. Five decisions. Under five minutes. On a phone.

**Build.**
- `/today`: **at most five decision cards**, ranked by value at risk. Each card carries what it is, why now, the draft or brief inline, and approve / edit / skip. Nothing requires leaving the card to decide.
- Above the cards, three lines: what the system did since last visit, what changed in the pipeline, what needs a human.
- Below: a collapsed "everything else" - not a second queue, an archive.
- **Telegram becomes one daily digest plus hot-lead exceptions.** The v1 stream is the noise Cole's brief explicitly warns against: *"one management view rather than allowing every agent to generate its own stream of notifications."*
- Mobile-first at 390px, then desktop.
- Kill switch, pause, and per-workflow retry as buttons - **U2b**. Outcome logging (replied / call booked / converted / revenue) as a one-tap action on a card, so Phase 6's `outcomes` table actually gets written by the person who knows the answer.
- Every decision writes an `approvals` row and starts the human-minutes timer, so `/today` is also the primary KPI #2 instrument.

**Acceptance.**
- [ ] **U3** - opens on at most five decisions, each with its artifact inline.
- [ ] **U4** - full daily loop completes at 390px.
- [ ] **U2b** - restart, retry and pause are buttons.
- [ ] **U5** - approve → send → logged is at most two taps plus the deliberate paste G1 requires.
- [ ] **The five-minute gate.** Two numbers, and they are different kinds of number. The **app-timed** median minutes per decision is the KPI #2 input. The **stopwatch** figure - Athena walking the whole loop on her phone, once, end to end - is a usability observation reported in the handoff. It is not KPI data and never enters the scorecard, which is why it does not violate the no-self-reporting rule. If the stopwatch says fifteen minutes, the phase fails regardless of correctness.
- [ ] Telegram sends one digest per day plus exceptions. Proven by a fixture day with many events producing one digest.
- [ ] Human minutes per decision are recorded automatically, not self-reported.
- [ ] Ranking is explainable - each card can state why it is at its position.

**Tests.** A five-card cap test with twenty candidate decisions. A responsive test at 390px and 1440px. A digest-batching test. A timer test.

**Audit focus.** **This is the phase where I am most skeptical**, because v1 passed every technical check and still went unused. I audit it as a user, not a reviewer: I walk the loop, count the taps, and read the cards cold. If I cannot tell what a card wants without prior context, the card fails. And the sub-five-minute figure must be a real measurement from Athena on her phone, not an estimate.

---

### Phase 8 - M1: Marketing production line and fan-out (YELLOW)

*Blocked on Phase 0.4 `FACTS.md`. This is Cole's second proof point.*

**Goal.** Kill the documented failure mode - *"Cole is delivering sessions, and week six arrives with nothing written"* - while satisfying the brief's content-repurposing-and-distribution priority in the same workflow.

**Build.**
- **Idea ledger.** The docs say the raw material already exists and is thrown away: every parent question on a call, every thing a student got wrong twice, every deadline that surprised someone. Capture paths: a Telegram one-liner, a note field on `/today`, and mining the engine's own reply corpus. One line per idea, no ceremony.
- **Issue drafter**, following the documented seven-slot anatomy exactly: epigraph → named idea → wrong-belief opener → reframe → mechanism → *do this* (three numbered steps) → close (one ask as a question, one disqualifier, one button, sign-off imperative, ` -  Cole`, PS "the Latin").
- **Deterministic structural enforcement** before any model review: pillar assigned (an issue that can't be assigned to exactly one pillar isn't an issue), word count in band, exactly three implementation steps, one link maximum, PS under 25 words, sign-off 2-5 words, subject line 2-6 words, no emoji in the subject.
- **The ⓕ fact-check gate.** Every factual claim flagged and checked against `FACTS.md` plus a primary source. A claim that can't be sourced blocks the issue. The docs are explicit that specificity is the whole product, so a stale number costs more here than anywhere else.
- **The eleven-rule QA rubric**, scored. Including the overriding structural test: **delete the last four lines and the reader must still have received a named idea, a mechanism, an example with numbers, and three implementation steps.**
- **3:1 rotation enforced by the scheduler** - three teaching issues with a soft CTA, then one offer issue. Never two offer issues in a row. Enforced in code, so it cannot drift under deadline pressure.
- **The fan-out.** One approved issue → a LinkedIn post + a Wyzant reply closer + an Instagram caption + a profile "examples of expertise" entry. Each adapted, none a copy-paste. The Wyzant closer keeps the documented standing line about the Tuesday note for parents.
- **A publishing queue, not just a pile.** Brief §3 asks Distribution to *maintain the publishing queue*, so the four fan-out assets land in a dated queue with a per-channel slot and a state (`queued` / `approved` / `published` / `skipped`) - the same discipline the 3:1 rotation applies to issues, applied to channel assets.
- **No ESP dependency.** beehiiv is recommended but unprovisioned, so the workflow measures **approved assets**, exactly as the KPI doc's secondary measures specify. When an ESP lands, publishing becomes one adapter against this queue.

**Acceptance.**
- [ ] An idea captured by Telegram one-liner reaches the ledger.
- [ ] Every structural rule is enforced deterministically before the model reviews anything. One test per rule.
- [ ] An issue with an unsourceable factual claim is blocked, and the claim is named.
- [ ] The delete-the-CTA test is implemented as an actual check, not a guideline.
- [ ] The 3:1 rotation cannot be violated by the scheduler.
- [ ] One approved issue produces four channel-adapted assets.
- [ ] Approved assets and human minutes per approved asset are recorded - the KPI doc's stated marketing measure, not raw assets generated.
- [ ] Voice rules pass the same `voiceLint` used in Phase 5.
- [ ] Each approved or rejected asset writes an `approvals` row with its decision and edit distance, so content enters KPI #3 on the same basis as drafts and briefs.

**Tests.** One structural test per rule. A fact-gate test with an unsourceable claim. A rotation test attempting two consecutive offer issues. A fan-out test asserting four distinct, non-identical outputs.

**Audit focus.** I read whole drafts against the playbook's eleven rules and the anti-model the docs name - the racing-metaphor email whose reader finishes knowing nothing new. Structural compliance with an empty middle is the exact failure mode here, and it is not detectable by any test. I also verify the rotation is enforced by the scheduler rather than by a comment.

---

### Phase 9 - B1: Weekly intelligence brief (GREEN)

**Goal.** Brief item #6, and the two marketing functions that are reporting rather than production: **Analytics** (what is working and what should change) and **Marketing Lead** (a weekly plan based on results rather than content volume). Both belong in the brief rather than in a separate agent - they are readouts, and giving each its own agent would be the org-chart failure Cole's anti-KPI names.

**Build.** A scheduled workflow rendering:
- pipeline deltas since last brief, and stalled opportunities with age
- **funnel movement from `outcomes`** - replies, calls booked, conversions, revenue
- content queue state, approved assets, and **which assets moved anything** (the Analytics function: performance against the previous period, with the honest caveat where volume is too low to conclude)
- the five-KPI snapshot
- exceptions and failures
- **the recommended plan for the next cycle** (the Marketing Lead function): which pillar to write into next and why, based on what performed - never on what is easiest to produce
- **the five recommended actions with their reasoning**

Renders at `/brief`, pushes to Telegram and email. Fully GREEN - it reads, reports and recommends; it never acts.

**Acceptance.**
- [ ] Generates from live data with no human assembly.
- [ ] Every number is traceable to a query, and the brief can state which.
- [ ] Recommendations carry reasoning, not just rankings.
- [ ] The next-cycle content recommendation cites a result, and **says so plainly when the sample is too small to support one.** A confident recommendation off four data points is worse than an abstention.
- [ ] Failures and exceptions appear. **A brief that hides a bad week is worse than no brief** - the curriculum's own rule is numbers on the board every week including the bad ones.
- [ ] Human minutes to produce: zero. Compared against the `BASELINES.md` figure for assembling a weekly picture.

**Tests.** Fixture-week test with hand-computed expected values. A test asserting a seeded failure appears in the output.

**Audit focus.** I check the brief surfaces bad news as prominently as good. An ops report that quietly omits a 40% success rate is a liability, and it is the most tempting thing for a generated summary to smooth over.

---

### Phase 10 - Management dashboard and economics scorecard

**Goal.** Cole's deliverables #7 and #8, generated rather than written.

**Build.**
- **`/dashboard`** with the brief's four panels, each scoped to data this build actually produces - a panel with an invented source is worse than a panel that states its limit:
 - **Sales** - pipeline, prospects, follow-ups, next actions, funnel from `outcomes`. Complete.
 - **Marketing** - content pipeline, the publishing queue, approved assets, and per-asset performance where it exists. **Campaigns and experiments render as "no source yet"** rather than as empty charts: there is no ESP and no channel analytics ingestion in this build, and §10 descopes both on purpose.
 - **Operations** - for the pilot this is **system** operations: active runs, blockers, exceptions, overdue approvals. Project and commitment tracking is Phase 12, so the panel says so instead of showing an empty list that reads as "nothing is wrong."
 - **Agents** - completed work, recommendations, approvals required, failures and exceptions. Complete.
- **`/economics`** - baseline vs actual human minutes per workflow, output volume, the five KPIs, **cost per approved output in dollars**, and the pipeline/revenue column from `outcomes`.
- **The Thursday one-liner, auto-generated.** Cole's KPI doc asks Athena to report the project in one line. The system renders it from live data:
  > `N workflows live / N% successful runs / N% output acceptance / N human hours saved / N qualified prospects ready for approval`
  Hand-typing this line is the failure. It must be a query.

**Acceptance.**
- [ ] All four panels render from live data, and any sub-panel without a source in this build **labels itself** rather than rendering empty.
- [ ] The five KPIs compute from real runs using the implemented definitions.
- [ ] Cost per approved output includes API spend.
- [ ] The Thursday one-liner renders from a query. Hand-typing it fails the phase.
- [ ] Every number is drillable to the rows that produced it.
- [ ] Baseline comparisons cite `BASELINES.md` and state the measurement method.

**Tests.** KPI computation against a fixture with hand-computed values. A one-liner rendering test. A drill-through test from each headline number to its rows.

**Audit focus.** I recompute all five KPIs by hand from the raw tables and compare. This is the number Cole judges the week by; a definitional slip here - counting attempted runs as successful, counting rewritten drafts as accepted - quietly inflates everything. I check each definition against the KPI doc's exact wording.

---

### Phase 11 - Reliability and the deliverable pack

**Goal.** The system survives a bad day, and Cole's nine deliverables exist.

**Build.**
- **Session-staleness detection** for the Wyzant storage state: N consecutive empty polls or a login redirect raises `SESSION_STALE` with a link to the documented re-capture ritual. Silent failure looks identical to a quiet day and is the thing that destroys trust in an ops system.
- Backup verification by restore. Secrets audit. Cost caps live. Kill switch tested. An incident runbook covering: API down, Telegram down, Wyzant session expired, cost cap tripped, bad drafts shipping.
- **Generate the nine deliverables**, each from the running system rather than written by hand:
  1. Working sales pilot → Phases 3-7
  2. Working marketing pilot → Phase 8
  3. **Agent org chart** → humans, squads, agents, automations, generated from the workflow registry
  4. **Automation map** → `docs/AUTOMATION-MAP.md`, updated with what actually got built
  5. **Agent specifications** → generated from each `Workflow` object: job, inputs, outputs, tools, metrics, permissions, escalation, owner
  6. **Shared operating system** → §4 of this document plus the live context/handoff/QA implementation
  7. **Management dashboard** → Phase 10
  8. **Economics scorecard** → `/economics`
  9. **30-day roadmap** → generated from the evidence: which workflows earned promotion, which failed, what the next-highest-value automation is by measured baseline

**Acceptance.**
- [ ] A stale Wyzant session raises a distinct exception, not silence. Proven by expiring a session deliberately.
- [ ] A restore from backup into a scratch database succeeds.
- [ ] No secret in git history. Verified by scanning history, not the working tree.
- [ ] Kill switch stops all scheduled work.
- [ ] The incident runbook covers all five named scenarios.
- [ ] All nine deliverables exist, and 3/4/5/8/9 are generated from live data.
- [ ] The 30-day roadmap cites measured evidence per recommendation.

**Tests.** Deliberate session expiry. Restore test. Git-history secret scan. Kill-switch test.

**Audit focus.** I try to make the system fail silently, because silent failure is what makes an ops system untrustworthy. I check the 30-day roadmap recommends things the *data* supports rather than things that sound like a good next quarter.

---

### Phase 12 - Operations squad (evidence-gated, post-pilot)

**Entry gate - all three, documented in `docs/AUTONOMY-LOG.md`:** the sales workflow holds ≥90% success and ≥80% acceptance across a documented window; the marketing workflow has produced approved assets at a positive time saving; `docs/FACTS.md` has no unresolved `BLOCKED` line touching applicant-facing copy.

Ranked by measured pain in the existing docs, not by novelty:

1. **Cross-surface consistency auditor.** The single most-repeated failure in the project: site vs form vs `CLAUDE.md` disagreeing on tuition, prizes, deadlines, seat counts. A GREEN agent that diffs every public surface against `FACTS.md` on a schedule and raises exceptions. **This one has the clearest economic case in the entire document** - the current state has two different programs live to applicants simultaneously.
2. **Application-cycle operator.** Tally form maintenance (deadline copy, theme drift, publish-before-navigating), the launch-day ritual (`noindex` removal, sitemap, og:image, placement links), intake acknowledgment, and the reviewer queue.
3. **Market intelligence.** Brief §3's first marketing function: tracking customers, competitors, trends and opportunities. Deferred here rather than into the pilot for one honest reason - it needs external sources this build does not touch, and there is no measured baseline for it, so it would fail Cole's own four-question test at proposal time. When it lands it is a GREEN reader feeding the Phase 9 brief, not a new surface.
4. **Dropped-commitment detector.** Reads the engine's own corpus for promises made and not kept.
5. **Wright cohort gate-checker.** The gates are already mechanically checkable: repo exists → deploy exists → domain resolves → HTTP 200 from outside → analytics beacon received → non-zero traffic → N distinct non-friend users. **G7 applies: progress and unlocks, never rankings.**
6. **Meeting prep and documentation.** Lowest priority - real, but no measured baseline yet.

**"The Chapter" as a second tenant.** Nothing is designed against it until someone supplies a source. What the architecture does now is stay tenant-neutral: an `org_id` on every table from Phase 1, and context docs loaded per tenant rather than imported globally. That way adding a second business is configuration, not a rewrite - the same discipline that made adding a channel one small file.
---

## 7. Agent roster and specifications

Cole's deliverable #5 asks for job, inputs, outputs, tools, metrics, permissions, escalation, owner. Phase 11 generates these from the code. This is the pilot's intended roster - **six agents and four deterministic automations**, deliberately small, because the anti-KPI is explicit: *two agents and three deterministic automations that remove ten hours of recurring work are more valuable than a twenty-agent org chart requiring constant supervision.*

| ID | Job | Kind | Level | Owner | Feeds |
|---|---|---|---|---|---|
| `S1.qualify` | Judge a prospect against written ICP criteria, with evidence | Agent | GREEN | Athena | KPI 4, 5 |
| `S1.ingest` | Poll channels, dedupe, normalize | Automation | GREEN | Athena | KPI 4 |
| `S2.research` | Produce a sourced fit brief with hooks, a disqualifier, and declared unknowns | Agent | YELLOW | Athena | KPI 2, 3, 4 |
| `S3.draft` | Prepare outreach variants in Whetstone's voice | Agent | YELLOW | Cole | KPI 2, 3 |
| `S3.voicelint` | Enforce every voice rule deterministically | Automation | GREEN | Athena | KPI 3 |
| `S4.stalls` | Detect stalled opportunities and flag them | Automation | GREEN | Athena | KPI 4 |
| `S4.replies` | Classify reply intent, propose next action | Agent | YELLOW | Cole | KPI 4 |
| `S4.followup` | Draft the next touch in sequence | Agent | YELLOW | Cole | KPI 2, 3 |
| `M1.compose` | Draft an issue to the seven-slot anatomy, then fan out to four channels | Agent | YELLOW | Cole | KPI 2, 3 |
| `B1.brief` | Assemble the weekly intelligence brief | Automation | GREEN | Athena | KPI 1-5 |

**Escalation rules, applied uniformly:** any RED-adjacent request escalates to Cole and halts. Confidence below threshold escalates to the human queue rather than shipping. Three consecutive failures pause the workflow and raise an exception. A cost-cap trip pauses everything and notifies. `SESSION_STALE` notifies immediately.

---

## 8. The KPI instrumentation map

Cole's five KPIs, each mapped to the table, the query, the phase that makes it real, and - critically - **the definition as implemented in code.** Definitions are where a scorecard quietly becomes fiction, so each one is pinned to the KPI doc's own wording.

| KPI | Standard | Implemented definition | Source | Made real in |
|---|---|---|---|---|
| **1. Working workflows** | ≥2 live | **One entry in the workflow registry** - `S1.ingest`, `S1.qualify`, `S2.research`, `S3.draft`, `S4.*`, `M1.compose`, `B1.brief` - with a passing documented end-to-end test on real or production-representative work, and which can be rerun. Counted from `runs`, not from intent. The unit is a registry id, so the number is unambiguous. | registry + `runs` | Phase 3 + 8 |
| **2. Human time saved** | Positive, documented | `BASELINES.md` minutes for equivalent output, minus recorded `runs.human_minutes`. Human minutes are **timed by the app, never self-reported.** | `runs.human_minutes`, `docs/BASELINES.md` | Phase 0.5 + 7 |
| **3. Output acceptance rate** | ≥80% | Approvals where edit distance is under the threshold **and** `required_new_research` is false, over total outputs reviewed. Both clauses, because the KPI doc's definition has both. Covers drafts, research briefs and content - every YELLOW output writes an `approvals` row. Threshold set **before** results are seen and recorded in `BASELINES.md`. | `approvals` | Phase 5 (drafts), 4 (briefs), 8 (content) |
| **4. Workflow success rate** | ≥90% | Runs reaching the intended final state **and** with `human_rescue = false`, over total **attempted** runs. Attempted, not started-and-abandoned. Both fields are needed: status alone cannot tell a clean run from a rescued one. | `runs.status` + `runs.human_rescue` | Phase 2 |
| **5. Qualified sales output** | Target after baseline; report actual | **One definition, not two:** prospects with `qualify.verdict = pass` against written ICP criteria **that have passed the quality gate and reached ready-for-human-approval** - which means a prepared draft exists. A qualified prospect with nothing prepared is a leading indicator, reported separately, never folded into this number. `out_of_scope` never counts. | `leads` + verdicts + `drafts` | Qualification Phase 3, **KPI completes Phase 5** |

**Three ways this scorecard could lie, and the countermeasure for each:**

| Failure | Countermeasure |
|---|---|
| Human minutes are self-reported and optimistic | `/today` times every decision automatically. Self-reported minutes are not accepted as a source. |
| The "minor edit" threshold is tuned after seeing results | Threshold and rationale are committed to `BASELINES.md` in Phase 5, before any real approvals exist. The audit checks the commit order. |
| Success rate counts only runs that started cleanly | Denominator is **attempted** runs, including ones that failed at step one. Enforced by a fixture test. |
| A run someone quietly fixed by hand counts as a success | `runs.human_rescue` excludes it from the numerator. The field is the whole reason the rate means anything. |
| "Pipeline generated" is asserted without evidence | Cole's Friday criterion names it explicitly, so it must come from rows: Phase 6 writes `outcomes`, Phase 9 reports the movement. No `outcomes` row, no pipeline claim. |

**Secondary measures**, per the KPI doc: marketing tracks *approved or published* assets and human minutes per approved asset - never raw assets generated. Sales funnel measures (response rate, qualified-conversation rate, meetings booked, pipeline value, revenue) are wired but explicitly **not** treated as pilot-window targets, because the KPI doc names them downstream business outcomes rather than fair implementation targets.

---

## 9. The auditor / executor protocol

**Codex builds. Claude audits. Athena decides.** This is the loop that already worked for the v1 engine, tightened with the two things v1's audits missed: KPI honesty and usability.

### The loop

```
Codex builds one phase
   → prints AUDIT HANDOFF, stops, waits
      → Claude audits against acceptance criteria + guardrails + this document
         → PASS               → Athena types `continue`
         → PASS WITH NOTES    → Athena types `continue`; notes become Phase N+1 items
         → FIX                → Codex addresses items, re-prints handoff for the SAME phase
```

Codex never skips ahead. If usage runs low mid-phase, it prints exactly what is done and what remains so another agent can resume.

### The AUDIT HANDOFF block

Extended from the v1 template with two new required rows - the things that let v1 pass every audit and still go unused.

```
### AUDIT HANDOFF - Phase <n>: <name>

- What I built: <files + what each does>
- Acceptance criteria: <each box, checked or not, one-line proof each>
- Tests: <command + pass/fail + counts>
- Guardrails respected: <G1 human-send · G2 own-accounts · G3 cadence ·
  G4 on-platform · G5 secrets · G6 no-cold-parents · G7 no-rankings - 
  each confirmed individually, or flagged>
- KPI impact: <which KPIs this phase makes measurable, and the query that reads them>   ← NEW
- Usability: <which U-criteria this phase satisfies, and the measured number>            ← NEW
- Regression locks: <all five still passing? named individually>
- engine.ts unchanged: <yes/no - required whenever an adapter is added>
- Deviations / risks / TODOs: <changes from spec + why>
- Remaining if interrupted: <what's left, so another agent can resume>
```

### What I audit, in order

1. **Guardrails first.** All seven, individually. A guardrail breach is an automatic FIX regardless of everything else working.
2. **Regression locks.** All five. v1 accumulated live fixes that existed nowhere but a working directory; a regenerated file silently reintroducing the `temperature` parameter or the narrow Wyzant host check would break production without failing a test that doesn't exist.
3. **Acceptance criteria, individually.** Not the summary claim - each box, against the proof offered.
4. **KPI definitions against the KPI doc's exact wording.** Recomputed by hand from raw tables at Phase 10.
5. **The usability criteria, as a user.** I walk the loop and count the taps. Phase 7's five-minute figure must be a real measurement from Athena's phone.
6. **Output quality, by reading real samples.** Drafts against `VOICE.md`. Briefs against their cited sources. Issues against the eleven rules. **This is the part no test covers, and it is where the real risk lives** - a fluent, structurally-perfect, substantively-empty output passes every automated check.
7. **Silent-failure paths.** What breaks without telling anyone.

### What earns an automatic FIX

- Any guardrail breach.
- A regression lock missing or failing.
- A KPI computed from a definition that differs from the KPI doc.
- Human minutes sourced from self-reporting.
- A threshold tuned after seeing results.
- A YELLOW workflow with any path to an external surface without an approval row.
- Silent failure where an exception belongs.
- A secret in git history.
- Applicant-facing copy generated while a `FACTS.md` conflict is still `BLOCKED`.

---

## 10. Explicitly not in scope

Naming these prevents the most likely form of drift, which is scope arriving disguised as thoroughness.

| Not building | Why |
|---|---|
| A large agent org chart | The anti-KPI. Nine specs, five of them agents, is the whole roster. |
| Any auto-send capability | G1. Not a setting, not a future flag - the capability is absent. |
| Cold outbound to parents of minors | G6, and it contradicts "application, not a reservation." |
| Student leaderboards or cross-student ranking | G7. The curriculum bans comparing fellows to each other. |
| An ESP migration | beehiiv is recommended but unprovisioned. Marketing measures approved assets, per the KPI doc. Publishing becomes one adapter later. |
| A CRM product integration | There is no CRM. The new Postgres is the system of record. Adding one now is a migration on the critical path. |
| Reddit / Facebook / Nextdoor adapters | Removed from the engine in v1 on purpose; they run through the operator's separate Chrome extension. |
| The Wright student console | Its own project with its own design work. Wright gate-checking appears in Phase 12 only. |
| Anything designed against "The Chapter" | Not in the project. Architecture stays tenant-neutral (`org_id` from Phase 1); nothing is built until there is a source. |
| **Market intelligence** (competitors, trends, opportunities) | Brief §3 asks for it; it needs external sources this build does not touch and has no measured baseline, so it would fail Cole's own four-question test. Deferred to Phase 12 as a GREEN reader feeding the weekly brief. |
| **Content strategy as an agent decision** | The idea ledger, pillar assignment and 3:1 rotation are built. *What Whetstone should publish and why* stays with Cole - it is the judgment the brand is sold on, which is precisely what the decision rule says to keep human. |
| **Campaign and channel analytics** | No ESP, no channel ingestion. The Marketing panel labels these as having no source rather than rendering an empty chart. |
| Wyzant fee/tracking workarounds | G4. Permanently out of scope. |

---

## 11. Blockers and decisions needed

Split by who can actually clear them. Nothing here is a reason to stop building - the phases are ordered so work proceeds while these resolve - but each blocks something specific.

### Cole decides

| # | Decision | Blocks |
|---|---|---|
| 1 | **Reconcile the live numbers.** Wright tuition $4,500 vs $5,500. Demo prize "$5,000 to one team" vs "$1,000 × 10 + full tuition." Scholarship award $26,000 vs $35,000. Scholarship deadlines (Sept 30 vs Aug 31 / Sept 15 / Sept 30). Award-carrying seats: "nine of fifteen" vs thirteen. | **Phases 8 and 12** - the surfaces that produce applicant-facing copy. Notably **not Phase 5**: the sales pilot's outreach is Wyzant tutoring inquiries and dormant tutoring contacts, which touch none of these facts, so the Friday-critical path is not gated on this decision. It still needs settling - two different programs are live to applicants right now. |
| 2 | **Confirm the canonical Harvard Club sequence** - the 5-email v2 or the 6-email v1. Different subject lines, different assets. Not a hard blocker: Phase 6 encodes v2 by default and the branch config makes a switch cheap. But sending the wrong one is not cheap. | Phase 6 (soft) |
| 3 | **What is "The Chapter."** Not in the project under any name. Likely in `CLAUDE.md`, `GTM.md`, or newer than the docs. | Phase 12 tenant work |
| 4 | **Baselines.** The economics case is only as good as these numbers, and they need his and Athena's real recollection of current time spent. | Phase 0.5, and therefore **KPI #2** |
| 5 | **The Wyzant rate.** Docs recommend $49 → $125-150 now, $185-250 past ~15-20 reviews. Every qualified lead arriving at $49 is measurable revenue left on the table, and it is a one-field change. | Nothing technical. Directly changes KPI #5's economic value. |

### Athena's setup, in order

1. Commit and tag the v1 repo. **Do this first.** Two production fixes currently exist only in an uncommitted working directory on one laptop.
2. Provision the Supabase project and record the connection string.
3. Provision the Vercel project and env vars.
4. Re-capture the Wyzant storage state and store it as an encrypted GitHub Actions secret.
5. Confirm Cole's Wyzant board actually shows jobs now under the approved subjects, and grab a saved page as the Phase 3 extraction fixture.
6. Assemble the re-engagement import: Harvard Club signups, unconverted Wyzant threads, early-inquiry parents - **each row with its consent provenance.** No provenance, no import.

### Standing risks

| Risk | Mitigation |
|---|---|
| Wyzant storage state expires and the poll silently returns nothing | `SESSION_STALE` detection, Phase 11. Silent failure is the trust-killer. |
| Adoption fails again for reasons the audits don't catch | The U-criteria are acceptance gates, and Phase 7's five-minute figure must be a real measurement, not an estimate. |
| Output quality drifts while every test still passes | Deterministic lint first, model QA second, and my reading of real samples every phase. |
| The scorecard flatters the project | Definitions pinned to the KPI doc's wording; thresholds committed before results; KPIs recomputed by hand at Phase 10. |
| Everything lives on one Anthropic key with no ceiling | Cost caps, rate limits, and a kill switch in Phase 2, before any workflow runs unattended. |

---

## 12. The one-line answer

When Cole asks for the status, this is the shape of the answer, and Phase 10 renders it from a query rather than from memory:

> **N workflows live / N% successful runs / N% output acceptance / N human hours saved / N qualified prospects ready for approval.**

And the test the whole build is judged against, in his words:

> *Did recurring work disappear from the human workload without sacrificing quality, and did Whetstone gain measurable operating or revenue-generating capacity?*

The honest answer for v1 was no - not because the code failed, but because nobody could use it. Phase 1 and Phase 7 exist to make the answer different this time.
