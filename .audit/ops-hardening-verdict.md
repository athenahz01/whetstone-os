# AUDIT VERDICT - Operational hardening pass

**Commit audited:** `b9324d5` (parent `d2c1ba9`)

**All seven items are done, and done well.** The pass PASSES on what it was asked for.

**The objective it was asked for does not.** Your own live evidence shows the poll seeing 3 of the 17 jobs on Cole's board, and the two places the other 14 disappear were reported as measurements rather than flagged as losses. The poll must not be trusted until both are closed.

---

## Reproduced

`engine.ts` md5 `9f95451a2e60cd143afa1d46618b34e0` unchanged. **34 files, 370 tests, 0 skipped.** `tsc`, `eslint`, `prettier --check`, `docs:lint` all clean.

**Item 5 traded nothing.** I re-ran every attack and must-pass row accumulated across Phases 4 and 5, including both carry-forwards: **17/17 attacks block, 18/18 must-pass rows pass.** `"The Whetstone award goes to two students"` and `"Families invest around three hundred a session"` are both closed.

**The host is pinned, not just changed.** `DEFAULT_WYZANT_FEED_URL` and `DEFAULT_WYZANT_MESSAGES_URL` are asserted against the observed `highered` host by a test that fails if either drifts. The workflow's hardcoded messages URL is fixed too, ahead of the addendum.

**The scope filter honours `D-001` correctly.** I probed it directly rather than reading it:

```
KEPT     exact SAT Reading online
KEPT     'SAT reading' lowercase
KEPT     English online, no location      <- online bypasses location, as D-001 requires
KEPT     English in-person Manhattan
dropped  English in-person Brooklyn
dropped  SAT Math online                  <- F-005 honoured
```

Online jobs return before the location check ever runs, so distance never disqualifies a prospect. That is the clause `D-001` exists to protect and it is right.

**On the arithmetic: you are correct and I was wrong.** `0,30 0-3,11-23 * * *` is 17 hours, 34 runs a day, about 1,020 minutes a month - not 32 and 960. You kept the cron I specified, corrected the maths, and said so in the handoff rather than quietly adjusting one to match the other. That is the right handling of an auditor's error.

---

## Blocking 1 - the board has 17 jobs and the extractor sees 10

Your own evidence line: *"board count 17, 10 visible cards parsed."*

`extractJobs` runs `page.locator(...).evaluateAll(...)` immediately after `domcontentloaded`. There is no scroll, no pagination, no wait for lazy-loaded cards - I grepped for all three. It reads whatever anchors happen to be in the DOM at that instant.

**Seven jobs, 41% of the board, are never seen.** They are not filtered out; they never exist as far as the system is concerned. Nothing logs a discrepancy, so a run that misses half the board reports exactly like a run that saw all of it.

You measured this and reported it as a field-coverage success. The number that mattered was the one next to it. When a diagnostic prints two counts that should agree and do not, that is the finding.

**Fix.** Reconcile the board's own count against the cards extracted, and treat a mismatch as an exception with both numbers named, so this can never again be silent. Then handle whatever produces the gap - scrolling, a "load more" control, or a paged URL. If the count element is unreliable, say so and pick a different reconciliation, but do not ship a poll that cannot tell you it missed half its input.

## Blocking 2 - the subject filter drops 7 of the 10 it does see, and nobody knows what they were

Board filtered to "My subjects" returns 17. Ten parse. **Three survive scope.** So the subject match rejected seven jobs that Wyzant itself considers Cole's subjects.

`filterWyzantJobs` requires an exact, case-insensitive match against the four strings in `F-005`. My probe:

```
dropped  'Reading'
dropped  'Writing'
dropped  'College Essays'
dropped  'ACT English'
```

`ACT English` should drop - `F-005` is explicit. The others are the problem. If Wyzant labels a job `Reading` and the register says `SAT Reading`, a real lead in an approved subject is discarded, silently, and the run reports success.

I cannot tell you which of those seven it was, and neither can you, because nothing recorded the subject strings that were rejected. That is the actual defect: **a filter that discards most of its input without recording what it discarded.**

**Fix.** Record the distinct rejected subject strings for every poll - the label only, no PII - so the question becomes answerable from one run. Then take the answer to Cole: either those Wyzant subject labels map onto his four approved subjects and the filter needs a mapping, or they do not and the drop is correct. `F-005` is owner-governed, so the mapping is his call, not yours and not mine. Flag it, do not guess it.

## The shape of it

```
17 on the board
 → 10 parsed      (7 lost: no pagination handling)
 → 3 in scope     (7 lost: exact subject match, unverified)
```

**18% of available inventory reaches the system**, and both losses are invisible from the outside. That is worse than a poll that crashes, because a crash tells you.

---

## Smaller notes

- Runtime under 60 seconds is still unverified, as you said. It resolves on the first container run and nothing depends on it until then.
- You preserved `.audit/wyzant-login.ts` rather than deleting it when promoting the shipped copy to `ops/`. Correct - that directory is mine.
- *"The first full sweep caught the stale 15-minute reliability lock."* Third time in this build that re-running an old sweep after a change has caught something a new test would not have. Keep it.

## Next

Both blockers belong with the addendum work already in flight. Nothing here reopens Phase 5, and Phase 6 stays shut until one production poll ingests real leads - which is now a stronger gate than it was this morning, because we know the poll would have silently reported success while seeing a fifth of the board.

Standing: Phase 5 and the hardening migrations are undeployed; the hot-lead `drafts` path is un-linted and bound for Phase 7; S2 spelled-out numerals open; the model QA gate stands.
