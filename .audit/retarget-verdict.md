# Audit verdict - retarget the importer, and the flake

**Commit audited:** `ed8c4dc`
**Auditor:** Claude (Cowork)
**Verdict: PASS on task 1. Task 2 was correctly refused, and the refusal exposed an error of mine.** No findings against the executor. 713/713, typecheck, lint, format, docs:lint 6/6 and build all clean. `engine.ts` unchanged at `9f95451a2e60cd143afa1d46618b34e0`.

---

## First: my diagnosis was wrong, and it cost a pass

I wrote in `CLAUDE.md` that the flake was "four real `setTimeout` delays, no fake timers, timing out at vitest's 5000ms default", and put fake timers in the executor's instructions as if that were settled.

**It is impossible.** All four `setTimeout` calls are inside `<script>` bodies served to the page through `route.fulfill`, plus one inside `page.evaluate`. They run in the Chromium renderer process. `vi.useFakeTimers()` patches Node's timers and cannot reach them. I checked the file rather than taking the correction on trust, and the executor is right on every point.

I stated a mechanism I had not verified, in the one file executors are told to treat as authoritative. The executor then spent a pass on it, tried two other approaches, regressed the file twice, backed both out byte-for-byte, and reported rather than shipping a rewrite it could not verify. **That is exactly the behaviour this project's role split exists to produce**, and the wasted pass is mine, not its.

`CLAUDE.md` now carries the correction, the real cause, and what was and was not verified.

---

## Task 1 - retarget: PASS, all three traps hold under mutation

I did not read the guards; I broke them.

| mutation | caught |
|---|---|
| map the `Days Quiet` formula column as if it were data | yes, 1 test |
| add a derived tab (`Action Queue`) to `CRM_TABS` | yes, 2 tests |
| key `affiliate` on `ID` instead of `Full name` | yes, 3 tests |
| let a blank `Full name` fall back silently instead of rejecting | yes, 2 tests |

The affiliate finding is the one worth repeating, because it is this project's signature failure caught a third time by someone who has learned to look for it: reading `ID` on a tab that has no `ID` column would have **rejected all 21 rows while the reconciliation balanced perfectly.** A count that proves nothing was lost cannot prove anything arrived.

Declaring the six formula columns and the fifteen meeting columns *ignored* rather than unmapped is the right shape - it makes leaving them a recorded decision instead of a silent drop, and it respects the standing 7.5b lock that no CRM field exists for the milestone columns. 31 of 31 probes caught on the first pass, no survivors, which is the cleanest sweep of the project.

---

## Task 2 - the flake: refused correctly, and partly fixed here

The executor could not separate its own bugs from the environment while the machine was at 0.31 GB free with Chrome holding 5.93 GB, so it stopped. Given it had already regressed the file twice, stopping was better than shipping.

I had headroom it did not, so I did the part its evidence supported.

**Launches are down from seven to four.** Four tests launched a browser, opened a page, closed both. They now share one browser through `beforeAll`/`afterAll` - the pattern `tests/wyzant-extraction-fixture.test.ts` already used, which is the precedent the executor identified.

**The other three cannot share, and the reason is not the one the executor gave.** It said they "belong to tests about a browser session being closed and replaced". They do not - the test that exercises session replacement uses pure fakes and never launches a browser. The actual constraint is narrower and harder: those three expose `close: async () => actualBrowser.close()` **as the adapter's own close method**, and the production code calls it. A shared browser would be closed mid-file by the code under test. Its caution was right; its reason was not, and the distinction matters for whoever tries next.

### What I can and cannot claim

Isolated: 16/16 across four runs, 9.8s to 9.4s. Full suite: **eight consecutive green runs** after the change, against a failure on the first run before it. Three of those eight were under induced memory pressure.

**But the lowest available memory I could reach was 4.4 GB, and the failure appears below 1 GB.** So I have not reproduced the condition that triggers it. I have removed three of the seven launches - the mechanism the executor identified - and eight green runs is better evidence than existed before. It is not proof. **The real measurement is on the loaded machine, and until that happens the suite should not be trusted as a gate.**

I am flagging this rather than declaring the flake fixed, because declaring it fixed is how a gate quietly stops being one - which is the thing I told Athena to worry about two passes ago.

---

## The gap worth acting on next

Deviation 1 in the handoff is understated. The meeting columns are ignored, so nothing reaches `crm_touches` - but the numbers make it sharper than "no touch on record":

```
M1 Med / M1 Client / M1 Closer   34 rows each
M1 Date                           8 rows
M2 Date                           7
M3 Date                           4
```

**The sheet records 34 first meetings and knows the medium, who attended and who closed for all 34.** Only 8 have a date. So the importer will bring across zero touches while the source it is reading holds evidence of 34 conversations.

Converting those into `asserted` touches is the obvious next piece, exactly as the executor said, and it is more valuable than it sounds: it is the difference between a first daily message where every line reads "no touch on record, measured from the lead date" and one where 34 leads carry a real history. The 26 rows with a medium but no date need a rule - a touch whose date is unknown is not the same as no touch - and that rule is a decision, not an implementation.

## Open

The rebuilt map has still never seen a real export. The unmapped-column guard means a wrong header refuses rather than writes blanks, which is the right failure, but the first real import is the test.

`WORKING_SOURCE` is still `dashboard` and is inert for a single-source import. Worth retiring when the old export is.
