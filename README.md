# Whetstone OS

Whetstone OS is the hosted, human-controlled replacement for Growth Engine v1.

Phase 0 contains ground-truth documentation only. It intentionally contains no
application, agent, adapter, database, scheduler, or deployment code. No later
phase may start until Phase 0 is audited and the executor receives the literal
word `continue`.

## Build documents - read these first

Both live in this repository so no agent ever has to search for them:

- `whetstone-agentic-ops-build-plan.md` - the full phased plan, 13 phases with
  goal, build, acceptance, tests and audit focus for each. This is the
  authority on what a phase contains.
- `codex-master-prompt.md` - the executor contract: stack, repo layout, the
  seven guardrails, the five regression locks, the KPI honesty rules, the
  usability criteria and the AUDIT HANDOFF template.

The prompt is the contract. The plan carries the specifics. An executor working
from the prompt alone will miss detail that only exists in the plan, which is
exactly what happened on the first pass at Phase 0. If either file is missing
from a working copy, stop and ask for it rather than inferring the phase.

Neither of these is agent-readable context in the prompt-loading sense. They are
build instructions, not facts about Whetstone. Do not load them through the
context loader alongside `docs/ICP.md` and friends.

## Phase 0 record

- Growth Engine v1 archive: `C:\AA_Whetstone\whetstone-growth-engine`
- Archive commit: `89bcb58` (`Archive Growth Engine v1 before hosted rebuild`)
- Archive safety order: ignore rules first, secret scan second, commit third
- Secret scan: 80 non-ignored candidate files, 0 credential-pattern findings
- v1 baseline suite: 13 files and 53 tests passed on 2026-08-26
- Ground-truth capture date: 2026-08-26
- Archive tag: `v1-local-archive` at `89bcb58`
- Audit verdict: FIX on first pass, items applied by the auditor in `43ddceb`
- Phase 0 validation is repeatable: `pnpm docs:lint` (or `node scripts/docs-lint.mjs`)
- Run `docs:lint` in every later phase. These documents are load-bearing inputs
  to every agent, so a silent edit changes system behavior without touching code.

### Still open, and it needs a human

Neither this repository nor the v1 archive has a git remote, and neither has
been pushed. Until the archive is pushed, the Sonnet 5 `temperature` fix and the
widened `*.wyzant.com` host check exist on this laptop and nowhere else. See
`C:\AA_Whetstone\PUSH-THE-ARCHIVE.md`.

## Agent-readable context

Only these four files may be loaded into model prompts:

- `docs/ICP.md`
- `docs/VOICE.md`
- `docs/FACTS.md`
- `docs/BASELINES.md`

`docs/AUTOMATION-MAP.md` and `docs/PHASE-0-DIAGNOSIS.md` are human-facing.
They describe intentions and evidence, not facts an agent may use to make a
decision.

## Hard gate

`docs/FACTS.md` currently contains explicit `BLOCKED` conflicts. No workflow may
produce Wright, scholarship, applicant, or parent-facing copy that touches a
blocked fact. Wyzant tutoring responses remain eligible in later phases because
they do not use those disputed applicant-program facts.
