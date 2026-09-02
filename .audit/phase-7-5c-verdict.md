# Audit verdict - Phase 7.5c: the silence clock

**Commit audited:** `d75bfa1`
**Auditor:** Claude (Cowork), independent probes plus **the first run of the clock against the live export**
**Verdict: PASS WITH FINDINGS.** Two findings, both surfaced by running the real data through the real code. One of them would have hidden the most valuable lead in the pipeline. Fixed here, with assertions.

**After the fixes: 44 files / 619 tests / 0 skipped, all passing.** Typecheck, lint, `format:check`, `docs:lint` 6/6 and `next build` clean. `lib/core/engine.ts` unchanged at `9f95451a2e60cd143afa1d46618b34e0`.

---

## What held

**The cold-start question is answered properly, and it was the first thing I went looking for.** On day one there is no touch history at all, so a clock that computes from the last touch has nothing to compute from. This one falls back to the lead date and records `measuredFrom: "lead-date"`; where there is no lead date either it returns `unmeasurable` rather than fabricating a zero, with the comment "the silence is real but its length is not knowable". `describeStall` prints "no touch on record, measured from the lead date". That is the right answer to a question I expected to find unhandled.

**The order of the checks is itself an argument, and it is correct.** Is this lead the clock's business? Can it be matched on? Is a call already booked? Only then, how long has it been quiet. As the code says, reversing any two produces a confident number about a lead nobody could have heard from.

**The `no-threshold` defect the executor found in its own code is a good catch.** A live stage with no configured threshold was reported as `closed-stage`, which says the lead is finished when what actually happened is that somebody removed a setting. Its own reason now.

**The sweep was the weakest first pass of the three phases and the executor said so.** Two ranking rules were untestable by coincidence, because the fixture's lead references happened to sort the same way as stage urgency and insertion order. Four "not clocked" clauses were interchangeable because a second path caught each one downstream. The store and both QA gates had no assertions. One probe was a no-op because `undefined ?? X` is `X`. All reported plainly and all closed. Reporting a weak pass accurately is worth more than a strong one reported vaguely.

**The survivor is the same one, reported the same way, for the third time.** `balanced: true` is behaviourally identical because `entries.length === leads.length` holds by construction. No invented test; the workflow gate checks it independently and that gate is now tested with disagreeing counts.

---

## Finding 1 - the ranking buries the urgent stages, and the live data proves it

**Severity: high. It is wrong in steady state and catastrophic on the first run.**

`rankStalls` sorted by absolute `overdueDays`, with stage urgency only as a tie-break - and exact ties in overdue days essentially never occur, so stage urgency never applied.

Per-stage thresholds exist precisely because different stages tolerate different silences: Negotiate 3 days, Cold 30. Ranking on absolute days undoes that. The threshold decides *whether* something is a stall but has no say in *how urgent*, so the slow stages dominate the list permanently - they accumulate more absolute overdue days against a bigger threshold.

**I ran the clock against the live export.** 19 live leads, no touch history, thresholds as configured:

```
stalls 15   needsAttention 4
1. U033 Engage      514 days quiet / 7  threshold
2. U002 Active      453 / 7
3. U001 Cold        453 / 30
4. U003 Cold        453 / 30
5. U004 Active      423 / 7
held back: 10
```

**U036 - the only Negotiate lead in the entire pipeline, the closest thing Whetstone has to a deal about to close - ranked twelfth of fifteen.** The five-item cap meant it would never have been shown. It lost to Cold leads from mid-2025 that nobody is working, because a Cold lead untouched for 453 days is 423 days overdue while a Negotiate lead untouched for 207 days is only 204.

### The fix

Rank by **how far past due in the stage's own terms** - `daysQuiet / thresholdDays`. Ten days against a three day threshold is 3.3 times past due; forty against thirty is 1.3. Stage urgency stays as the tie-break, absolute overdue days below it, lead reference last for determinism.

Same data, after:

```
1. U033 Engage      514 / 7
2. U036 Negotiate   207 / 3     <- was 12th, would not have been shown
3. U002 Active      453 / 7
4. U004 Active      423 / 7
5. U011 Active      423 / 7
held back: 9
```

The Cold leads correctly drop out of the top five. Cold is the stage that is *expected* to be quiet; that is what a 30 day threshold means.

**This changed an existing test**, which encoded the old rule, and I want to be explicit that I overrode an executor decision rather than fixing an oversight. The test asserted that a Cold lead 100 days quiet outranks an Active lead 60 days quiet. Under thresholds of 30 and 7 those are 3.3x and 8.6x past due, and the Active lead is the one in trouble. The test now encodes the ratio rule with the arithmetic written out, plus a second test built from the live export's shape. Reverting the rule fails both.

---

## Finding 2 - the evidence line claimed a search that may not have happened

**Severity: medium. Same defect class as `exceptionsRecorded`.**

`evidenceBasis` returned the constant `searched: ["calendar", "email"]` regardless of what the run read.

`S4.touch-scan` isolates provider failures deliberately, so a calendar outage does not cost a day of email evidence. That is right, and it means **a scan can succeed having read only half of what it names**. Every stall line still claimed both mailboxes. A person reading *"quiet 11 days, searched calendar and email"* on a day the Gmail provider was failing would conclude nobody had emailed, when the truth is nobody had looked.

Section 7 of the brief makes this binding: the clock states its evidence, never just its number. Stating evidence it does not have is the same failure as `exceptionsRecorded` reporting what was accepted while naming what was written.

`SilenceClockInput` had no channel for it - the clock could not know which providers ran, and the scan's `providersRead` / `providersFailed` never reached it.

**Fixed** with a `ScanCoverage` input, threaded from the scan through the workflow. It is **required, not optional**: a default here would be an optimistic assertion inherited by every caller who forgot, which is the shape of the defect it exists to close. The type system caught all six call sites. A failed provider now leaves `searched` and joins `blindTo` as "email, which was attempted and failed on this run", and a run that read nothing says "searched nothing on this run" while still printing the number, so a degraded run is loud rather than silent. The standing phone blindness is stated unconditionally, because it is true regardless of coverage.

Seven assertions in `tests/phase-7-5c-scan-coverage.test.ts`.

---

## What the first real run looks like, for 7.5d to plan against

From the live export, no touch history, after both fixes:

```
14 stalls, 4 unmonitorable, 1 unattributable, 0 within threshold
every stall measured from the lead date - no contact has ever been observed
oldest: 514 days
```

Two things follow for 7.5d. **The first message is nine held back**, and the acceptance box requiring it to say so is the one that matters most on day one. And **every line will read "no touch on record"** until a real scan runs, which is honest but uniform - it may be worth distinguishing "never observed" from "observed, then went quiet" in the surface, because they are different problems and only the second is a stall in the ordinary sense.

**U018 reports `unattributable` through the clock**, which confirms the 7.5b fix works end to end rather than only in its own unit tests.

---

## Open

**Still no database and no live provider**, now four phases deep. The executor states it and agrees it is the binding constraint. I agree, and add: the ranking defect above was invisible for three phases of green tests and took ten minutes to find against real data. That is the argument for provisioning access, made concrete.

**The widening multiplier of 2 is an assumption**, flagged by the executor and unresolved. Both the trigger and the multiplier are configuration and a test asserts they are read from the policy, so this is a value for Ren to rule on, not a code change.

**`clearAdjustments` sends the full identity list every run.** Correct but broad; at 69 leads it is nothing. Worth narrowing if the CRM grows, as the executor noted.
