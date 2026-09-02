# AUDIT VERDICT - Phase 5 fix pass

**Commit audited:** `4e287bb` (parent `bdb2a9b`)
**Verdict: FAIL**, one more round, and I am scoping it to be the last one on this axis. Read the closing section before you start: it says where I stop asking.

The topic gate is the right architecture and it did the job it was built for. Everything I brought from last round is closed. What remains is coverage inside topics that already exist, plus two over-blocks, one of which blocks the copy this phase most wants to produce.

---

## Reproduced

`engine.ts` md5 `9f95451a2e60cd143afa1d46618b34e0` unchanged. **32 files, 337 tests, 0 skipped.** `tsc`, `eslint`, `prettier --check`, `docs:lint` all clean. `MINOR_EDIT_THRESHOLD = 0.2` unmoved. G1 grep clean across all seven modules including the two new ones.

## The topic gate works

All nine of my attacks from last round now block, **each named by a topic rule rather than a word pattern** - which is the point:

```
Wright cost, euphemism       [topic.wright-cost, topic.price]
scholarship deadline, hedged [topic.application-dates]
scholarship value, hedged    [topic.scholarship-terms]
Harvard, oblique             [topic.credentials]
Oxford, oblique              [topic.credentials]
credential, generic          [topic.credentials]
SAT Math, softened           [topic.subject-offered]
outcome, hedged hard         [promise.outcome]
outcome, implied             [topic.future-state]
```

**All nineteen of my must-pass rows still pass. Zero regressions.** That is the part I was most worried about and it held.

The disqualifier gate works. With the November prospect, `sourceSupplies` reports `timing: true`, and both `"you have not said when the test is"` and my reworded `"I do not know what the deadline is here"` are refused by `source.contradicted-absence`. Making it a gate that runs on any agent rather than a template fix was the right instinct - the model will produce this defect too.

Fourteen of my twenty new must-pass rows aimed squarely at the gate's own risk surface pass clean: `"invest an hour a week"`, `"it is worth looking at"`, `"the value here is in seeing the actual work"`, `"the application of that technique"`, `"her award for the debate season"`, `"across two terms"`, `"are you free Tuesday"`, `"next week we would move from timing to inference"`. Homographs are mostly handled and scheduling survives the dates topic.

**On the regression sweep that caught you.** Re-running the old 63-clause sweep and finding that your new hedge markers shadowed `OUTCOME_MOVEMENT`, so removing that clause no longer failed anything - that is a coverage rot that would have gone unnoticed for the rest of the build. Re-running old sweeps after a change is now twice-paid-for. Keep doing it.

---

## What still gets through

I wrote fifteen fresh attacks against the gate. Six are clear misses, and every one falls inside a topic that already exists - so these are coverage gaps in implemented rules, not new concepts:

```
FAIL  credential by decade    "I have been doing this since my own days at a very selective college."
FAIL  subject by implication  "Whatever section she is weakest in, we can work on it."
FAIL  outcome via third party "Most families tell me the difference shows up within a month."
FAIL  outcome as expectation  "You can expect the pacing to click well before the test."
FAIL  price by range          "Most families spend a few hundred over a term."
FAIL  draft terms             "The published rules explain how places are confirmed."
```

**`"Whatever section she is weakest in, we can work on it"` is the serious one.** It offers SAT Math, and it is not an exotic phrasing - it is the warm, accommodating sentence a model writes when a parent sounds worried. `F-005` is unambiguous, and this is a misrepresentation of Cole's platform approvals in a reply sent on that platform.

The two outcome misses matter for the same reason: `VOICE.md` bans an outcome stated, implied **or hedged**, and both of these are the hedged form a helpful model reaches for.

Two more went through that I am **not** asking you to fix, because I think they are genuinely borderline and chasing them would cost more than it buys: `"Parents often ask where I trained, and the answer usually satisfies them"` states no credential, and `"Wright can be paid in instalments"` states no amount. Judgement calls, and I would rather say so than pad the list.

## Two over-blocks, and one of them hurts

```
BLOCKED  "Chemistry is outside what I do, so I would point you elsewhere."  [topic.subject-offered]
BLOCKED  "SAT Math is not something I take on."                            [topic.subject-offered]
BLOCKED  "There is a degree of guesswork until I see the work."            [topic.credentials]
```

Your negation handling is form-specific. `"I do not tutor SAT Math"` passes, `"SAT Math is not something I take on"` does not. Of six honest refusals I wrote, two are blocked.

This is the copy the phase most wants. An honest refusal - naming plainly what Cole does not do - is exactly what `VOICE.md` asks for and exactly what keeps a reply trustworthy. A lint that blocks it teaches the drafting agent to stay vague about scope, which is the opposite of the goal.

`"a degree of guesswork"` tripping `topic.credentials` is the `comprehension`/`comprehensive` family again, on a word that will come up constantly in copy about uncertainty.

**Minor, same family:** `contradictedAbsences` handles timing well, but `"You have not told me which subject this is about"` passes while `sourceSupplies` reports `subject: true`.

---
---

# INSTRUCTION TO EXECUTOR - Phase 5 fix pass 2, and the last on paraphrase

**1. Close the six named misses.** Each belongs to a topic that already exists. Extend the topic's own detection, not a new word list:
- `topic.credentials`: an institution referred to without being named ("a very selective college", "my own days at").
- `topic.subject-offered`: an open-ended offer to work on any section or whatever is weakest. An unbounded offer implicitly includes the subjects `F-005` excludes.
- outcome: third-party attestation ("most families tell me the difference shows up") and expectation-setting ("you can expect X to click before the test").
- `topic.price`: a spend range with no figure ("a few hundred over a term").
- C-005: a reference to the published rules or terms explaining anything.

**2. Fix both over-blocks, and generalise the negation rather than adding two forms.** A refusal is any construction that places a negator between the subject and the offer, in either order. Test at least these six, all of which must pass:
```
I do not tutor SAT Math, so I would not be the right person for that half.
Chemistry is outside what I do, so I would point you elsewhere.
SAT Math is not something I take on.
I would not be the right person for the maths section.
That is outside my four approved subjects on here.
I only work on reading and writing, not the quantitative side.
```
And `"There is a degree of guesswork until I see the work."` must pass.

**3. Extend `contradictedAbsences` to the subject field**, with the same clause-level probes.

**4. Both tables stay binding.** My nine, my nineteen, your thirty-two attacks and your thirty must-pass rows all still hold, plus the fourteen of my new must-pass rows that pass today. Nothing above may be traded for anything below.

**5. Negative probe per clause** on everything new, and re-run the full existing sweep afterwards, as you did this round.

## Where I stop

**After this round I will not fail Phase 5 for further paraphrase coverage.** A deterministic lint cannot be complete against paraphrase, and I could generate attacks indefinitely. Continuing past the point of diminishing return would be me looping, not auditing.

The residual belongs to the model QA, and your statement of its limit was the right call: the rules are in the prompt and the wiring is proven, but the judgement is untested and a stub rejecting my attacks would be your code marking its own homework. I would rather have that said plainly than have a green test that means nothing.

So the residual goes behind a gate instead of a pretence. I am adding to `CLAUDE.md`:

> **No draft from the production outreach agent reaches a human until the model QA has been exercised against the recorded attack tables with a real API key.** The deterministic lint is a floor, not the gate. Recorded at the Phase 5 pass, 2026-08-27.

Fix the eight items above and Phase 5 passes.

Standing, unchanged: Phase 5 migrations undeployed; S3 cannot quote a price until Cole adds a rate row to `FACTS.md`; the hot-lead drafts path is un-linted and bound for Phase 7; S2 spelled-out numerals open. Do not touch `lib/core/engine.ts`; report its md5. Do not edit the four owner documents. `pnpm verify`, exact counts - currently 32 / 337 / 0. Stop and print the AUDIT HANDOFF block.
