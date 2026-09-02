# HANDOFF TO EXECUTOR - Phase 5: S3 Outreach preparation (YELLOW, human-send)

Read `CLAUDE.md` at the repo root first. It is the binding contract, and its
"Where things stand" section is current as of 2026-08-27. Then read
`whetstone-agentic-ops-build-plan.md`, section **Phase 5**, and `docs/VOICE.md`,
`docs/FACTS.md` and `docs/BASELINES.md` in full. Those three documents are the
specification for this phase, not background.

Phases 0 through 4 are audited and closed. U6 and U7 closed 2026-08-27. HEAD is
`682bbb4`. Baseline: 29 files / 185 tests / 0 skipped.

Build Phase 5. Stop and print the AUDIT HANDOFF block. **Do not start Phase 6.**

---

## Read this before you write any code: the FACTS.md gate is partly BLOCKED

`docs/FACTS.md` opens with "applicant-facing facts gate is BLOCKED" and the plan
marks Phase 5 blocked on it. That is not a stop order for this phase. It is a
scope boundary, and getting it wrong is the worst thing that can happen in Phase
5, because the output goes to families under Cole's name.

Every blocked row is about **Wright or the scholarship**:

| Row | Blocked subject |
|---|---|
| C-001 | Wright tuition, and the entire award ladder denominated on it |
| C-002 | Scholarship award value |
| C-003 | Scholarship dates |
| C-004 | Scholarship award structure |
| C-005 | Anything depending on the draft scholarship terms |
| C-006 | Wright application dates |
| (unnumbered) | **Cole's Harvard and Oxford credentials. BLOCKED.** |

The Wyzant pilot is tutoring inquiries from parents about tutoring. `F-001`
covers the service list and `F-005` covers Cole's four approved subjects. None
of the blocked rows touch that scope, so **S3 may proceed for Wyzant tutoring
replies and must avoid every blocked subject entirely** - which is exactly what
`FACTS.md` says: avoid it, do not paraphrase around it, do not omit a qualifier
and ship the rest.

So `voiceLint()` must hard-block, each with its own test:

1. Any Wright tuition figure, award-ladder rung, or application date.
2. Any scholarship value, deadline, decision date, or award-structure claim.
3. Any claim that leans on the scholarship terms.
4. **Any Harvard or Oxford credential claim about Cole.** Call this one out
   specifically. Legacy Whetstone material is full of it, a drafting model will
   reach for it as the strongest credential available, and the register says
   omit it until Cole verifies the wording. A draft that says "Cole, a Harvard
   graduate" must fail with that ban named.
5. Any subject outside Cole's four approved ones stated as something he teaches
   (`F-005`: College Counseling, English, Essay Writing, SAT Reading - not SAT
   Math, not any ACT section).

---

## Build

- **Draft agent v2**, loaded with `VOICE.md` and `FACTS.md`. Keep v1's variant
  names: `specific-first`, `question-led`, `plan-first`. The scoreboard already
  supports them.
- **`voiceLint()` runs first and is deterministic.** The model QA runs second and
  is never asked to judge something a regex settles. Cover at minimum:
  - every banned word and phrase in `VOICE.md` (there are 22 in the list plus
    the generic categories)
  - the six positioning bans, case-insensitive, whole-phrase, including variants
    such as "free consultation"
  - promised outcomes: an admission, score, scholarship, result or probability
    stated, implied **or hedged**
  - reservation language: seat held, reserved, guaranteed, secured, first come
    first served
  - em dash and en dash
  - link count greater than 1
  - missing disqualifier
  - the ask not phrased as a question
  - length outside the channel bound
  - repeated credential language
  - any fact not present in `FACTS.md`, plus the five hard blocks above
- **LLM QA second**, scoring against the eleven compressed playbook rules.
- **G1 preserved exactly.** Prefill only. The engine stops before Send.
  `sent_by` is always human. Provable by grep and by test.
- **Minor edit is already frozen. Do not touch it.** `docs/BASELINES.md` fixes
  the definition and the value, recorded 2026-08-26 before any approval existed:
  `minor_edit = normalized_distance < 0.20 AND required_new_research = false`,
  with exactly 0.20 not counting. `MINOR_EDIT_THRESHOLD` in `lib/core/kpi.ts` is
  already `0.2` with a strict `<`. If your results look bad against it, that is
  information, not a reason to move it. Any change requires a new versioned KPI
  definition, not an edit.

## Acceptance

- [ ] `voiceLint()` blocks every banned pattern. **One test per ban**, named for
      the ban.
- [ ] A draft citing a fact absent from `FACTS.md` fails, with the offending
      claim named.
- [ ] Each of the five hard blocks above fails with its own named test.
- [ ] No auto-submit path exists. Proven by grep and by test.
- [ ] Edit distance is stored on every approval.
- [ ] KPI #3 computes from real approvals using the frozen definition.
- [ ] Variants are recorded so reply-rate-by-variant works on the scoreboard.
- [ ] A draft reaching ready-for-human-approval marks its prospect as counting
      toward KPI #5. **KPI #5 completes in this phase.**

---

## What the last two phases cost us, and how it applies here

Phase 4 needed three rounds. Both failures will recur in `voiceLint()` in almost
the same shape if you build it the same way.

**1. The must-pass table is as binding as the must-block table.** Phase 4's
minor-data filter first missed nine of ten real phrasings, then over-corrected
until it ate any page containing an org contact email, a phone number, the word
"born" or the word "senior" - and the brief then *asserted* an absence of public
context that the filter had manufactured. A lint that blocks too much does the
same thing here: every draft bounces, S3 reports honest-looking failures, and
nothing ships.

So ship **two tables** for `voiceLint`, both required:

- Must BLOCK: one row per ban, with the phrasing a model would actually produce,
  not the phrasing that makes your regex look good.
- Must PASS: drafts that contain near-misses and are legitimate. At minimum -
  "comprehension" must not trip the "comprehensive" ban; "leverage" in a
  financial sense must pass while the buzzword sense fails; "the best" **with**
  a cited verified basis must pass while the bare superlative fails; a single
  link must pass while two fail; a hyphen must pass while an em dash and an en
  dash fail.

Write the must-pass table before the regexes, not after.

**2. Do not build a gate that cannot fail.** Phase 4 shipped
`renderTraceabilityIssues`, which was called with the output of the function it
re-implemented, so it compared a function's output to a copy of its own output
and returned clean for every possible input. If the LLM QA is handed something
derived from the draft agent's own reasoning, it will do the same thing. The QA
must see the rendered draft and the `FACTS.md` register, and nothing the drafting
step chose about itself.

**3. Negative probe per clause, not per guard.** Break each clause of each rule
on its own, everything else intact, and prove the lint names that clause. A rule
with three conditions needs three probes. Phase 4's second pass shipped 25 of
them and six only existed because the executor noticed its own first sweep had
been masking clauses behind each other.

**4. If a probe harness can lie, assume it did.** Claude Code caught its own
harness moving a migration to a sibling path still inside `prisma/migrations/`,
so `readdir` kept finding it and the probe reported NOT CAUGHT falsely. Report
that class of thing when you find it.

---

## Rules for this pass

- Do not touch `lib/core/engine.ts`. Report its md5 (`9f95451a2e60cd143afa1d46618b34e0`).
- Do not edit `ICP.md`, `VOICE.md`, `FACTS.md` or `BASELINES.md`. If you believe
  one is wrong, flag it in the handoff. They are owner-governed.
- Do not widen `ApprovalLevel`. It is a two-member type on purpose.
- Any new table gets RLS in the migration that creates it, and if it is not
  created by a migration it goes in `TABLES_CREATED_OUTSIDE_MIGRATIONS`.
- Confirm all seven guardrails individually. G1 is the one this phase can break.
- Run `pnpm verify` and `pnpm build`. Report file, test and skipped counts
  exactly. Say which repository each result came from.
- House rules in `CLAUDE.md`: PowerShell, no em dashes, never push.

## What I will attack in the audit

I will read a real sample of drafts against `VOICE.md` myself, because automated
voice checks pass copy that is technically compliant and tonally wrong, and this
goes to families paying for judgment.

I will try to get a Wright tuition figure, a scholarship deadline, and a Harvard
credential through the lint, using the phrasings a model actually reaches for -
hedged, partial, and paraphrased, not quoted.

I will check that the 0.20 threshold is untouched and that nothing in this phase
quietly recomputes acceptance a friendlier way.

And I will write my own must-pass table for `voiceLint` and run it. If your lint
blocks legitimate copy, that fails the phase the same as letting a ban through.
