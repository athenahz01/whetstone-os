# Audit verdict - Phase 7.5a: merge and reconcile

**Commit audited:** `fa62750`, on top of `6e38c32` plus the uncommitted auditor pass
**Auditor:** Claude (Cowork), independent probes in a Linux container from a source tarball of the working tree
**Verdict: PASS WITH FINDINGS.** The architecture is right and most of it is well guarded. One finding is a real defect that the live export triggers on three leads, found by running the merge against the real sheets, which the executor could not do. Fixed here, with assertions.

**After the fixes: 40 files / 493 tests / 0 skipped, all passing.** Typecheck, lint, `format:check`, `docs:lint` 6/6 and `next build` all clean. `lib/core/engine.ts` unchanged at `9f95451a2e60cd143afa1d46618b34e0`.

---

## What held

Verified independently, not accepted on report.

**The committed suite reproduces exactly: 39 files / 478 tests / 0 skipped.** My first run showed one failure; four consecutive re-runs passed. It was a cold-start Chromium artifact in my sandbox, not the code, and I am reporting it as such rather than as a flake I could not reproduce.

**The refusal path is real and reachable.** `writeMergeResult` was split out of `importCrmSources` specifically so the unbalanced case could be entered at all, and the test asserts all four repository collections are empty after the throw. The executor also caught that its own earlier version of this test threw the error itself and asserted that it threw, never calling the import code, and **replaced it rather than patching it**. That is the same self-satisfying-test defect as `renderTraceabilityIssues`, caught by the executor on its own sweep. Good.

**The disputed-value enforcement is centralised and holds.** `actionableValue` returns `undefined` for a disputed field, `selectStallCandidates` reads through it, and `{candidates, excluded}` with a reason per exclusion means a lead cannot silently vanish between the two lists. The "every lead in exactly one of the two lists" test is the right shape.

**Vocabularies do not coerce.** An unrecognised stage is stored raw and flagged; a near miss is not snapped to the nearest member. Both proven.

**The survivor is correctly reasoned.** The executor reported one uncaught mutation of 54: hardcoding `balanced: true` inside `mergeCrmSources`. It is behaviourally identical for every input the function can produce, because it balances by construction, so no test can catch it. **The executor declined to invent a test for it and said so.** That is the right call and the right disclosure - the protection lives at the write boundary, which re-derives the totals independently. I applied the same standard to my own fix below and hit the same situation once.

**G5 on the fixture is handled well.** The test reads the forbidden real names out of the brief at runtime rather than listing them, so the assertion cannot rot as the brief changes. Better than what I would have specified.

---

## Finding 1 - identity was keyed on the student name, and the live export splits three leads

**Severity: high. Live, and it reproduces the exact problem the phase exists to fix.**

`crmIdentity` is `tab::LEADREF::normalized name`. A row with an ID and no student name therefore gets a *different* identity from the same student's named row, and never joins it.

**21 rows in `!Dashboard` have an ID and no student name.** In the live export, U045, U046 and U047 are named in `!Dashboard` and nameless in the copy - the cases the audit classified as "one-sided fills, `!Dashboard` wins, no ruling needed".

I ran the merge's identity rule against the real sheets. Before the fix:

```
ug_sales:  43 shared references, only 40 joined
           dashboardOnly 28   copyOnly 3   split: U045, U046, U047
```

Each split produces **two records sharing one lead reference**: one carrying the sales funnel from `!Dashboard`, one carrying the academic columns from the copy. That is the fork this phase exists to end, rebuilt inside the database.

**And the reconciliation reported `balanced: true`.** It counts source rows, and every row was accounted for. This is the important part:

> Balance can only prove nothing was lost. It cannot prove anything was joined correctly - two rows that should be one lead balance perfectly.

The reconciliation already carried the signal that would have caught it. `copyOnly` was 3, and **no lead exists only in the copy** in this dataset, so `copyOnly > 0` is structurally impossible and is a perfect canary. Nothing asserted on it.

### The fix

A two-pass merge. The first pass indexes every *named* identity by lead reference, so the join no longer depends on which file's rows arrive first - row order is not a property of the data. A nameless row then adopts the named identity for its reference when there is exactly one.

When a reference is shared by **two or more named students** - `U036`, where Hamza Benyass and Jack Yu genuinely share an ID - there is no non-arbitrary answer, and guessing would fold two students together. That row is **rejected with a reason**, which is what the "no silently dropped row" rule is actually for: it leaves as a rejection, not as a wrong join.

`splitLeadRefs` is added to the reconciliation, and `writeMergeResult` refuses any split that was not declared. `ug_sales::U036` is the one declared split; everything else is a failed join and is refused before a single row is written.

After the fix, against the live export:

```
ug_sales:  69 leads   merged 44   dashboardOnly 25   copyOnly 0
           split lead references: U036 only
           ambiguous rejections: 0
g_sales:   31 leads   merged 31   dashboardOnly 0    copyOnly 0
```

**This closes the acceptance box the executor correctly said it could not close.** 44 merged leads across 43 shared references, because `U036` contributes two - which is what "plus the U036 split" in the box was anticipating. The brief now records these as the expected values so the box is mechanically checkable.

Nine assertions in `tests/phase-7-5a-identity-join.test.ts`, including that a partial name (`Terrence` vs `Terrence Liu`) still stays split on purpose - a missing surname is not the same as a missing name - and that balance alone reports healthy while `splitLeadRefs` catches it.

---

## Finding 2 - the subject-label slot, raised by the executor and upheld

**Severity: medium. The executor was right and my previous audit was inconsistent.**

The executor reported that `.audit/exc-probe.test.ts` still fails P3 and P4: `"Rejected Wyzant subject labels: applying for Fulbright this year"` and `"Rejected Wyzant subject labels: Sri Ramanathan"` both pass the wire validator. It flagged this as an open G5 finding rather than a stale probe, while correctly not acting on it because I had told it not to.

**It was right.** In the previous pass I gave the malformed-job reason a closed vocabulary on the argument that "safe today, pinned by nothing" is not safe - and then left the structurally identical slot one function over alone, on the argument that the labels come from `job.subject` and the board controls that field. That is the same argument, applied strictly to one slot and leniently to the next, in the same file, in the same pass. The reason slot proved the strict reading correct when `parseWyzantPostedAt` turned out to already be feeding it.

A vocabulary cannot guard this one: the message exists to carry labels the board shows and we do **not** recognise, so its legitimate contents are unknown by definition. **The source is what gets pinned instead.** `attestedSubjectLabels` keeps only labels that were read off a card in the same run, so a label that did not come from a card is dropped rather than sent.

**One honest limitation, in the executor's own style.** The integration path cannot reach the dropping branch today, because the rejected set is built from `job.subject` and nothing else. I drafted a test-only injection hook into the adapter to fake reachability and then removed it - adding a production seam to make a test pass is exactly what I would flag in an audit. The rule is a named exported function with six tests of its own, and the limitation is stated in the code where the next person will read it.

---

## Finding 3 - my scratch broke `pnpm verify`, and that is a config defect

**Severity: low, but it cost an executor a decision.**

`.audit/exc-probe.test.ts` is mine. I wrote it on the Windows working tree while trying to run vitest there, the run failed on unresolvable `node_modules`, and I never removed it - the audit bridge cannot delete files. `vitest` collected it, so `pnpm verify` went red on a file that was never a regression test.

The executor handled this correctly: it did not delete the file, did not exclude it, did not edit the code it probes, and reported it. But it had to spend a judgement call deciding whether a failing probe was a real finding - and in this case it was, which makes the ambiguity worse, not better.

`vitest.config.ts` now scopes collection to `tests/`. `.audit/` is auditor scratch: probes there are written to break a clause and watch the gate name it, and their assertions encode questions, not requirements. `CLAUDE.md` now says so.

---

## Open, and honestly open

**Nothing here has touched a database.** `lib/crm/prisma-repository.ts`, the migration, the RLS policies and the CHECK constraints are typechecked and built, not executed. The merge core is exercised hard through a fake repository; the Prisma side is not exercised at all. That is the same limitation as the ingest route's `BatchAdapter` line, and it does not close until 7.5a runs against the real database.

**The importer has not been run against the real export end to end.** I ran the *identity rule* against the real sheets and closed the reconciliation box with real numbers. The full path - fetch, parse, merge, write, re-run for idempotency - has not been executed with the real data, because it needs the sheets exported and a database to write to. That is the next concrete step for 7.5a, and it is Athena's to run.

**The five earlier mutation sweeps were not re-run.** The executor said so plainly and did not claim a result it did not produce. 7.5a touches none of the files they cover, and my own sweep here covers the files I changed, but the statement stands as written.
