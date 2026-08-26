# Whetstone OS

Whetstone OS is the hosted, human-controlled replacement for Growth Engine v1.

Phase 0 contains ground-truth documentation only. It intentionally contains no
application, agent, adapter, database, scheduler, or deployment code. No later
phase may start until Phase 0 is audited and the executor receives the literal
word `continue`.

## Phase 0 record

- Growth Engine v1 archive: `C:\AA_Whetstone\whetstone-growth-engine`
- Archive commit: `89bcb58` (`Archive Growth Engine v1 before hosted rebuild`)
- Archive safety order: ignore rules first, secret scan second, commit third
- Secret scan: 80 non-ignored candidate files, 0 credential-pattern findings
- v1 baseline suite: 13 files and 53 tests passed on 2026-08-26
- Ground-truth capture date: 2026-08-26

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
