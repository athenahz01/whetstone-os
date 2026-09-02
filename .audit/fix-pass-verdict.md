# Audit verdict - handed-back tasks from the 7.5d verdict

**Commit audited:** `fe9a7a5`
**Auditor:** Claude (Cowork)
**Verdict: PASS.** No new findings. Task 1 is done and the fixtures came out stronger than they went in. Task 2's blocker was real and correctly refused; **it is unblocked below.**

**Reproduced: 47 files / 696 tests / 0 skipped.** Typecheck, lint (zero warnings), `format:check`, `docs:lint` 6/6, `next build` clean. `engine.ts` unchanged at `9f95451a2e60cd143afa1d46618b34e0`.

---

## Task 1 - the fixtures got stronger, which is the thing I was checking

I handed the thresholds back specifically because re-deriving twelve fixtures is how an assertion gets quietly weakened. So I mutation-tested the rebuilt fixtures rather than reading them.

| mutation | caught |
|---|---|
| delete the stage-urgency tie-break | **yes**, 1 test |
| delete the `byOverdue` third tie-break | **yes**, 1 test |
| revert ratio ranking to absolute overdue days | yes, 3 tests |
| restore the old, too-slow thresholds | yes, 12 tests |

The first two are the point. **Neither had coverage before this pass.** The executor reported that the stage-urgency tie was built as a tie in *absolute* overdue days, which the ratio rule does not tie on, so the probe that deleted stage urgency survived - and rebuilt it as a real ratio tie: eight days against Negotiate's two and sixty against Cold's fifteen are both four times past due, and only stage urgency separates them. It then noticed that `byOverdue`, the third tie-break, was reachable only when two leads of one stage tie on ratio with different thresholds, which happens only after a widening, and wrote the test for it.

That is a probe sweep finding a gap the *re-derivation itself* created the conditions to see, and closing it. The twelve fixtures now bite harder than the ones they replaced.

The threshold values match Whetstone's own Action Sheet cadence: Negotiate 2, Active 3, Engage 3, Prospect 7, Cold 15. The sheet and the code now chase on one cadence.

**One consequence to expect, flagged by the executor and worth restating:** every lead becomes a stall roughly twice as early. Against the live export that means more items from day one and more held back behind the five-item cap. That is the correction working, not a regression.

## Task 2 - the refusal was right, and the blocker is now gone

The executor would not invent `COLUMN_TO_FIELD` from three column names mentioned in passing. That is exactly the call I would want, and it is the same judgement that stopped the earlier session building a phase from a name.

**I read the header rows off the live sheet.** `docs/REBUILT-DASHBOARD-SCHEMA.md` has all three tabs, the renames, the fill counts and the traps. The retarget is a small change now.

Three things in there that are not obvious from the column names and would each cost a pass to discover:

- **Six columns are formulas, not data**: `Last Touch`, `Days Quiet`, `Chase After`, `Chase Flag`, `Contactable`, `Data Flags`. Importing them into `crm_leads` as typed values would store a snapshot of a computation and let it drift from the touch history the database maintains itself. `Days Quiet` and `Chase Flag` *are* the spreadsheet's silence clock, computing the same thing `S5.silence-clock` computes from `crm_touches`.
- **`Overview` and `Action Queue` are derived tabs** over `UG Sales`. Importing them would duplicate every lead.
- **`Affiliate` has no `ID` column.** It was restructured, not renamed, and its key is `Full name`, so `crmIdentity` needs a different rule for that tab.

**The academic columns are on the canonical sheet now.** `Admission Status`, `Materials`, `SAT / GRE`, `Academic`, `Tutoring Notes`, `Capstone`, `Essays` used to exist only in `Copy of !Dashboard`. The fork is resolved at the source, which is the real prize in retargeting - the merge stops being a reconciliation and becomes an import.

## What the fill counts say, and it is the same thing every audit has said

```
Last Touch 44   Lead Date 44   M1 Date 8   M2 Date 7   M3 Date 4
Chase Flag 19   Contact Method 0   Outcome 0
```

**`Last Touch` is filled on the same 44 rows as `Lead Date`,** because the meeting dates it should prefer are filled on 8, 7 and 4. So `Days Quiet` is measuring age since intake, not silence since contact, for almost every row. The formulas are right and their inputs are empty.

`Chase Flag` is set on 19 rows; `S5.silence-clock` independently produced 19 live leads from the same data. Two implementations agreeing is worth something.

`Contact Method` is 0 and the Action Sheet asks for it at lead creation. `Outcome` is still 0 of 69.

## The flake - confirmed, and it should not stay handed back much longer

`tests/wyzant-operational-hardening.test.ts` failed 1 of 8 full runs here and passed 3 of 3 isolated; the executor saw roughly 1 in 3 on Windows. The diagnosis is confirmed: four real `setTimeout` delays, no fake timers, timing out at vitest's 5000ms default under 47-file contention.

Handing it back was defensible - it is Phase 6 code and this was a fix pass. But it is worth being blunt about the cost: **a suite that fails one run in three stops being a gate.** `pnpm verify` is the thing standing between this project and the failure mode it was built to avoid, and the first time someone re-runs a red build and it goes green, it has stopped working as a gate. This should be fixed before anything runs on a schedule, and it is a small fix - fake timers in one file.

## Everything else

`unmappedColumns()` is the right instinct and it is this project's recurring lesson applied in a new place: a count that proves no row was lost cannot prove a row arrived with its contents. Point the importer at a renamed sheet without it and the import succeeds, balances, and writes blank leads.

`CrmWriteAllowances` being required rather than defaulted removes the last inherited-default trap of the kind the `ScanCoverage` finding named. The type checker found all fourteen call sites.

The executor also reported that one of its own "survivors" was a probe pointed at the wrong test file - a harness bug, not a coverage gap - and declined to count it as a catch. That is the fifth consecutive phase of accurate self-reporting.
