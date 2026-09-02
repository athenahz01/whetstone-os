# Audit verdict - Phase 7.5b: touch detection from email and calendar

**Commit audited:** `c78c7cf`, on top of `fa62750`
**Auditor:** Claude (Cowork), independent probes in a Linux container, plus the contact index run against the live export
**Verdict: PASS WITH FINDINGS.** The strongest pass in this project so far. One finding, found by running the index against the real sheets: a lead can hold contact details, be indexed, and still never be credited a touch, and nothing counted it. Fixed here, with assertions.

**After the fix: 42 files / 558 tests / 0 skipped, all passing.** Typecheck, lint, `format:check`, `docs:lint` 6/6 and `next build` all clean. `lib/core/engine.ts` unchanged at `9f95451a2e60cd143afa1d46618b34e0`.

---

## What held, and what was better than asked for

**The 7.5a lesson was carried forward without being told twice.** `isTouchScanBalanced` carries this comment:

> this proves nothing was dropped. It cannot prove anything was matched to the right lead. That is what the separate `ambiguous` count is for, and why an ambiguous address is never resolved by taking the first hit.

That is the exact finding from the previous audit, applied to a different mechanism before anyone asked. `lookupContact` returns `ambiguous` as its own outcome rather than the first hit, and counts distinct **identities** rather than entries - so two cells on one lead holding the same address is correctly one lead, not an ambiguity. I probed that case; it holds.

**Two real defects found and fixed by the executor's own sweep, both reported rather than quietly patched.** Phone matching never worked at all: the sheets hold `(555) 010-1234` and a provider returns `+15550101234`, and `normalizePhone` alone keeps them apart, so every phone match would have failed silently while the counts still balanced. And `classifyScanFailure` matched "unexpected token in JSON" as a credentials error, which would have sent someone to re-issue a key that was never the problem. Both are exactly the class this project keeps finding, and the executor found them in its own code.

**I probed the phone normalizer against the live values and it holds up.** The sheets contain invisible Unicode - U+202C and U+202D directional-formatting marks - embedded in most phone cells, and three cells hold WeChat handles rather than numbers (`WC: hnhsyb`, `WC: linglinghan999`, `WC: fanfanmiao`). All of it is handled: the control characters are stripped as non-digits, and the WeChat handles fall outside the 7-to-15 digit bound and are correctly refused rather than indexed as short numeric junk. `WC: linglinghan999` reducing to `999` and being rejected on length is the case I expected to find broken, and it is not.

**Tightening the subject box was the right call, and the executor made it unprompted.** The brief permitted a subject reference; the executor stores a digest instead, reasoning that subject lines carry student names as a matter of course and that a slot admitting prose eventually carries a name with every test passing. That is the exception-channel finding generalised correctly. Four independent assertions back it, including a database pattern check.

**The survivor is honestly reported and the response was better than a test.** One mutation of 71 was uncaught: removing the kind filter in `lookupContact` changes nothing, because an email always contains an at sign and a comparable phone never does. Rather than invent a test for unreachable behaviour, the executor **added an assertion for the invariant that makes it unreachable**. That is the right move and I would not have specified it.

**KPI honesty held under pressure.** `S4.touch-scan` declares no baseline, because none of H-01 through H-10 covers noticing a contact and writing it down - in the spreadsheet era that work simply was not done, `1M Date` being filled on 8 rows of 69. A number there would have been self-report. The field is absent and a test asserts it stays absent.

---

## Finding 1 - a lead can have contact details and still be unreachable, and nothing counted it

**Severity: medium. Live, and it affects a live lead today.**

The index has two states for a lead that cannot be matched: `unmonitorable` (nothing usable to match on) and `disputedContacts` (an address the two files disagree on). Both are well built, and the separation between them is deliberate and correct.

There is a third state, and it is the one that hides. **A lead whose contact details are shared with another lead** is indexed, is not `unmonitorable`, is not disputed - and every message on those details resolves `ambiguous`, so it can never be credited a touch. It reports as perfectly healthy.

Siblings are the ordinary cause: a parent's address sits on both children's rows.

I ran `buildContactIndex`'s logic against the live export:

```
69 leads
  39  no usable contact detail          -> unmonitorable, correctly handled (5 of them live)
   2  every usable contact is shared    -> U017 (Lost), U018 (Cold, LIVE)
   2  some contacts shared              -> U013 (Complete), U024 (Active, LIVE)
```

**U017 and U018 each hold exactly one usable contact, and it is the same parent phone.** Neither can ever be credited a touch. U018 is a live lead, and before this fix it appeared in no count at all.

**U024 is Active with two of three contacts shared with U013.** She still matches on her one unshared cell, which is worse than being wholly blind: every parent email and call is invisible while the record looks partly alive.

This is not a shrinking problem. The sheet already holds Liu twice, Wu twice and Wang three times.

### The fix

`ContactIndex.unattributable` - leads holding usable contacts where at least one reaches more than one lead, carrying `sharedFields`, `usableFields`, and `wholly` (every usable value is shared). Computed from the index alone, no messages required. `S4.touch-scan` measures `s4.leads_unattributable`, counting the wholly blind, kept separate from `s4.leads_unmonitorable` so the two cannot be folded together and read as healthy.

Ten assertions in `tests/phase-7-5b-shared-contacts.test.ts`, including that the three states stay distinct, that a partially shared lead still matches on its unshared cell, and that two cells on one lead holding the same address is not sharing. A mutation that stops populating the list fails five tests across two files.

The brief and `CLAUDE.md` now carry the rule into 7.5c: **a wholly unattributable lead reaches the clock exactly as `unmonitorable` does - visible, never healthy** - and a partially shared lead names which fields are invisible, so the stall line does not imply a complete picture it does not have. That is section 7's evidence-basis rule, one layer down.

---

## Finding 2 - HEAD carries the 7.5a identity fix without its test

**Severity: low, but it should not survive the next commit.**

The executor flagged this itself, in deviation 4: its contact-field additions to `merge.ts` and `import.ts` could not be separated from the auditor's uncommitted 7.5a identity-join fix, so `c78c7cf` **carries that fix while `tests/phase-7-5a-identity-join.test.ts` remains untracked**.

So HEAD contains a two-pass join, a `splitLeadRefs` guard and a `SplitCrmLeadError` with nothing at HEAD proving any of them. Someone reverting the join tomorrow would see a green suite. The executor was right to report it rather than commit files that were not its own; the fix is simply to commit the test alongside, which is Athena's next action anyway.

---

## Open, and honestly open

**No database, no live provider, and this is now the binding constraint.** `TouchProvider` is an interface with no implementation, and every acceptance box in 7.5b is proven against fakes. Section 5.3 of the brief says Gmail and Calendar access is "genuinely required for 7.5b; no default can stand in", and that is still true - the same limitation the 7.5a audit recorded for the Prisma side, now stacked two phases deep.

**7.5c can be built on fakes as well, but 7.5d cannot be judged without real data.** Every phase since 7.5a has ended with the same sentence. The next thing that changes the project's confidence is not another phase; it is read-only Gmail and Calendar access and one real scan.

**The unbalanced-scan guard is unreachable by test**, the same situation as 7.5a's merge and reported the same way. `isTouchScanBalanced` is tested directly, the guard re-derives from the totals, and the database CHECK enforces it. No production seam was added to fake reachability, which is the correct call.

**The five earlier mutation sweeps were not re-run.** Stated plainly, and 7.5b touches none of the files they cover.
