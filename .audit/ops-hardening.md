# HANDOFF TO EXECUTOR - Operational hardening pass (not a numbered phase)

Read `CLAUDE.md` at the repo root first. It is the binding contract, and its "Where things stand" section is current. Then read `whetstone-agentic-ops-build-plan.md` for context. HEAD is `d2c1ba9`. Baseline: **32 files / 358 tests / 0 skipped**.

Phase 5 passed audit. **This is not Phase 6.** Phase 6 stays shut until the Wyzant poll has completed one real run, because follow-up logic designed against zero real pipeline state is guesswork.

Everything here came out of trying to switch the live poll on this morning. Seven items, roughly in order of how much they cost if left.

---

## 1. The feed URL host is wrong in the code, not just in config

The live tutor board is **`https://highered.wyzant.com/tutor/jobs`**. Confirmed from the operator's signed-in browser today. The code defaults to `www.wyzant.com`:

- `lib/adapters/wyzant.ts:359` - `process.env.WYZANT_FEED_URL?.trim() || "https://www.wyzant.com/tutor/jobs"`
- `lib/adapters/wyzant-messages.ts` - same pattern for the messaging URL
- `.env.example` and `docs/DEPLOYMENT.md` carry the same wrong host

`isOfficialWyzantUrl` accepts any `*.wyzant.com`, so the wrong host passes every guard and fails silently at runtime. Fix the defaults, the example and the doc. Add a test pinning the expected default host so this cannot drift back unnoticed.

## 2. Three configuration options are read from the environment and never used

`WyzantAdapterOptions` declares `targetSubjects`, `targetLocations` and `includeOnlineJobs`. `createWyzantAdapterFromEnv` populates all three. `poll()` reads `browserFactory`, `headless`, `storageState`, `feedUrl` and `tutorId` - and nothing else. **Those three options do nothing.**

That is not cosmetic. `FACTS.md` `D-001` is a recorded owner decision that both in-person Manhattan / New York, NY and online work are in scope, and `ICP.md` has a Geography section. Neither is applied. What actually gets ingested is whatever the board's own UI filter happened to be set to when the session was captured.

Implement the filtering against `ICP.md` and `D-001`, with a test per clause: a job outside the target subjects, a job outside the target locations, an online job with `includeOnlineJobs` true and the same job with it false. If you believe any of the three should be deleted rather than implemented, say so in the handoff with your reasoning and do not silently drop it.

## 3. The board splits its inventory across two tabs

The live board has a **Lesson Type** control with **Online** and **In person** as separate selections, and a **Subject** filter defaulting to "My subjects". The operator's board showed 17 online jobs with that toggle set to Online.

Establish whether one URL returns both lesson types or only the selected one. If only the selected one, the poll is currently seeing half the inventory at best, and `D-001` says both are in scope. Handle both, deduplicating by `nativeId` so a job appearing under both is one lead. Record what you found either way - this is a fact about the source we do not have written down anywhere.

## 4. The workflow costs about three times the account's whole budget

`.github/workflows/wyzant-poll.yml` runs `*/15`, which is 96 runs a day at roughly 1m11s each. GitHub bills whole minutes per job, so that is about **5,700 minutes a month against a 2,000 free budget shared across the owner's entire account**. It is why scheduled runs stopped firing.

- Run the job in the official Playwright container, image `mcr.microsoft.com/playwright:v1.62.1` to match the pinned `playwright ^1.62.0`, and drop the `playwright install --with-deps chromium` step. That step runs apt every time and is not cacheable; it is most of the runtime. Getting under 60 seconds halves the bill per run.
- Change the schedule to `0,30 0-3,11-23 * * *` - every 30 minutes, 07:00 to 23:00 Eastern while EDT is in effect. Keep the jitter and `workflow_dispatch`. Comment that it drifts an hour in winter, and that the board shows jobs sitting for 5 to 12 hours so 30 minutes is far faster than the source changes.

That is 32 runs a day, roughly 960 minutes a month.

## 5. Two carry-forwards from the Phase 5 verdict

Both were recorded in `.audit/phase-5-verdict.md` as binding, with a per-clause probe each.

- `topic.scholarship-terms` misses `"The Whetstone award goes to two students."` The Phase 5 handoff stated this case blocks. It does not. **Verify a stated behaviour with an assertion before writing it down.**
- `topics.ts:36` lists `investment` but not the verb `invest`, so `"Families invest around three hundred a session."` is an unregistered price claim that ships.

## 6. Promote the session-capture helper into the repository

`.audit/wyzant-login.ts` is auditor tooling written this morning to unblock the operator. It works and it is in use. Move it to `ops/wyzant-login.ts` as shipped code, keeping its two guarantees and testing both:

- **it strips every non-`wyzant.com` cookie and origin before writing.** The raw Playwright export carried 27 third-party cookies including Facebook, LinkedIn and DoubleClick, and this file is pasted into a GitHub secret. Test with a fixture containing third-party entries.
- **it prints no cookie values.** Counts, the feed origin, and the longest-lived persistent cookie expiry only.

Add `"wyzant:login": "tsx ops/wyzant-login.ts"` to `package.json` and document it in `docs/DEPLOYMENT.md` as the way to produce `WYZANT_STORAGE_STATE_JSON`. It is local-only and headed; it must never run in CI.

## 7. The live probe list in `docs/DEPLOYMENT.md` is stale

Claude Code flagged this itself and it is still open. The list names only the seven Phase 1 tables. It is missing the six Phase 2 tables, `research_briefs`, and `_prisma_migrations`. Make it enumerate every table the migration set secures plus every name in `TABLES_CREATED_OUTSIDE_MIGRATIONS`, so the live check and the CI lock cover the same set by construction rather than by someone remembering.

---

## Rules

- Do not touch `lib/core/engine.ts`. Report its md5 (`9f95451a2e60cd143afa1d46618b34e0`).
- Do not edit `ICP.md`, `VOICE.md`, `FACTS.md` or `BASELINES.md`. Read them; flag rather than change.
- Negative probe per clause, not per guard. Re-run the existing sweeps afterwards - twice in this build that has caught coverage rot a new test would not have.
- If a probe harness could be lying, assume it is and prove otherwise. Both prior executors caught their own harness reporting false passes.
- `pnpm verify` and `pnpm build`. Report file, test and skipped counts exactly, and say which repository each result came from.
- House rules in `CLAUDE.md`: PowerShell, no em dashes, never push.
- Stop and print the AUDIT HANDOFF block. Say plainly what you fixed and what you did not. **Do not start Phase 6.**

## What I will check

That the feed host is pinned by a test and not just changed. That the three dead options are either genuinely applied or genuinely gone, with no third state where they look configured and are not. That the workflow's own numbers support the cost claim. And I will re-run every attack and must-pass table from Phases 4 and 5 to confirm item 5 traded nothing.
