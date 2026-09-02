# AUDIT VERDICT - Phase 5: S3 Outreach preparation

**Commit audited:** `d2c1ba9` (parent `4e287bb`)
**Verdict: PASS.** Phase 5 is closed. Phase 6 opens.

Two of my new attacks still get through and they are recorded as carry-forwards below, not as a third round. I said last round that I would not fail this phase for further paraphrase coverage, and moving that line after you did the work would make my gates elastic, which is worse than the two misses.

---

## Reproduced

`engine.ts` md5 `9f95451a2e60cd143afa1d46618b34e0` unchanged. **32 files, 358 tests, 0 skipped.** `tsc`, `eslint`, `prettier --check`, `docs:lint` all clean, register at 7 verified rows. `MINOR_EDIT_THRESHOLD = 0.2`, strict `<`, measurement and definition still in separate files.

## Everything I have ever thrown at this now blocks

All fifteen attacks accumulated across two rounds, each named by a topic rule rather than a word:

```
Wright euphemism        [topic.wright-cost, topic.price]
sch deadline hedged     [topic.application-dates]
sch value hedged        [topic.scholarship-terms]
Harvard oblique         [topic.credentials]
Oxford oblique          [topic.credentials]
credential generic      [topic.credentials]
SAT Math softened       [topic.subject-offered]
outcome hedged          [promise.outcome]
outcome implied         [topic.future-state]
credential by decade    [topic.credentials]
subject by implication  [topic.subject-offered]
outcome 3rd party       [topic.outcome-attestation]
outcome expectation     [topic.future-state]
price by range          [topic.price]
draft terms             [topic.draft-terms]
```

**All six honest refusals pass, and so does the degree of guesswork.** Generalising the negation into three clauses - a negator anywhere up to the later of subject and offer, a standalone declining word, and an adversative that turns the sentence back into an offer - is the right shape. `"Math is not my main area but I can take a look at it"` still blocks, which is the clause that had to survive.

I wrote eight new must-pass rows against the loosenings. **All eight pass**, including one you expected to fail: you disclosed that `"the award she won"` has no leading possessive and would still block. It passes. Your disclosure was pessimistic and the code is better than you claimed.

The `worth it` loosening is contained. `"worth it at four hundred an hour"` still blocks on the figure, `"worth well into five figures"` blocks on the scholarship topic, `"an hour spent on pacing is worth it"` passes.

## On committing `docs/FACTS.md`

Right call, and thank you for flagging it at the top rather than in a footnote. Your reasoning is sound: tests that assert the rate passes cannot travel without the register they read. I diffed it against what I wrote and it is **byte-identical** - you committed the owner's edit unaltered and did not touch it. That is exactly the line I wanted held. No need to split the commit.

That also closes the owner item from two verdicts ago. `"My rate is $400 per hour in person and $295 per hour online"` now passes; `"A single session is $120"` still blocks; `"I offer a free consultation"` still blocks on `positioning.consultation`, which is precisely what the `F-007` note asks for. S3 can answer the first question a parent asks, in the words `VOICE.md` allows.

---

## Carry-forwards, binding, into Phase 6's first commit

**1. A stated behaviour does not match the code, and this one bothers me more than the miss.**

Your handoff says the student's-award distinction "blocks again the moment the sentence also says scholarship, Whetstone or fellowship." It does not:

```
FAIL  award + Whetstone   "The Whetstone award goes to two students."
```

That is a `C-004` award-structure claim walking straight through. The gap is small; the problem is that the handoff asserted specific behaviour that is false. Everything in this build rests on your handoffs being checkable, and across six passes this is the first claim of yours I have found not to hold. Verify a stated behaviour with an assertion before you write it down, so a claim and a test are the same object.

**2. `invest` as a verb is missing from the price vocabulary.**

```
FAIL  price via invest   "Families invest around three hundred a session."
```

`investment` is in the noun list at `topics.ts:36`; the verb form is not. An unregistered price, through a one-word gap.

Both belong in Phase 6's first commit with a per-clause probe each. Neither is a reason to reopen Phase 5.

---

## Where the residual sits, and that is where it stays

A deterministic lint cannot be complete against paraphrase. The `CLAUDE.md` gate is the answer and it stands:

> No draft from the production outreach agent reaches a human until the model QA has been exercised against the recorded attack tables with a real API key.

Your refusal to write a stub that rejects our own attacks was correct and I want it on the record. A green test that means nothing is worse than an honest gap. Two of your six passes have caught your own probe harness lying - the sibling-path `readdir` and the multi-line positioning bans - and one caught coverage rot in an old sweep. That habit is why the numbers in these handoffs are worth reading.

## What Phase 5 completed

Four workflows are now registered: `S1.ingest`, `S1.qualify`, `S2.research`, `S3.draft`. **KPI #1's target of two working workflows is met with room to spare, and KPI #5 completes here** as the plan intended - a saved draft marks its prospect ready in the same transaction, so a saved draft and an uncounted prospect cannot come apart.

## Standing

- Phase 5 migrations undeployed. After `prisma migrate deploy`, re-run the anon probe over fifteen tables.
- The hot-lead `drafts` path is still un-linted, and bound in `CLAUDE.md` against Phase 7's surface.
- S2 spelled-out numerals open, gated on a live `ResearchSourceProvider`.
- The Wyzant poll has never completed a run. `WYZANT_STORAGE_STATE_JSON` is not reaching the runner, and `.github/workflows/wyzant-poll.yml` is still on `*/15`, which costs roughly 5,700 Actions minutes a month against a 2,000 account budget. See `.audit/wyzant-poll-fix.md`.

**Phase 6 - S4 follow-up and pipeline state (GREEN + YELLOW) - is open.**
