# Audit verdict - meeting-column backfill

**Commit:** the 7.5a backfill pass. **Verdict: PASS.** One scope correction, no defects.

**What I verified.** The two safety claims hold: backfilled touches key on
`sheet-meeting:<slot>`, not on `asserted:<identity>:<date>`, with a named test
that the two schemes cannot collide - so importing the sheet can never overwrite
a human answering "already spoke to them". `M1 Notes` is read by nothing, with
four tests on it. `no-closer` is already a first-class skip reason, so a dated
meeting nobody signed is refused rather than attributed to no one.

**I did not re-run the suite this round.** The Windows `node_modules` will not
resolve in the audit VM and the change I made is documentation only, checked with
`docs:lint`. The executor's 738/738 is taken on report - its self-reports have
matched my independent runs on all six previous passes, and it has reported its
own weak assertions and dead code unprompted each time.

## The scope correction

Deviation 3 said the `M2 Med` and `M3 Med` counts were unstated, so "26" was firm
for `M1` only. That was the right thing to flag. I counted every slot on both
tabs from the live sheet:

| tab / slot | converts | needs a date ruling | dated but unsigned |
|---|---|---|---|
| UG Sales M1 | 8 | 26 | 0 |
| UG Sales M2 | 6 | 3 | 1 |
| UG Sales M3 | 3 | 2 | 1 |
| G Sales M1 | 4 | 0 | 0 |
| **total** | **21** | **31** | **2** |

**21 touches convert, not 8.** Second and third meetings and the graduate tab
were not counted. The first daily message is less blind than the handoff expected.

**31 rows need the ruling, not 26.** The four options and the recommendation are
unchanged; the number they apply to is larger.

**Two rows are dated but unsigned, and the ruling document does not cover them.**
The code handles them correctly as `no-closer`. But whether a dated meeting with
no recorded closer should convert under a house attribution or stay out is a
second, smaller decision nobody has been asked for.

`docs/MEETING-BACKFILL-RULING.md` carries all three, and its status stays open.

## Agreeing with the recommendation

A now, D next, never B. Option B - dating the undated at the lead date - would put
31 leads at the top of the stall list on a date nobody chose, and a bound
presented as an observation is the defect found in some form in every phase of
this project. The unconverted rows keep their medium, client, closer and reason,
so D can recover the real dates later without touching the sheet again.

## The flake measurement is the useful part of this handoff

The executor reached 0.69 GB free - the condition I could not reproduce, having
bottomed out at 4.4 GB - and measured **one failure in four full runs, against six
or seven of sixteen before the shared-browser change.** The one failure was in
`records both board and extracted counts`, one of the three tests that still
launch their own browser, which is exactly where it should be if the diagnosis is
right. So: the four shared launches help below 1 GB, and the failure is not gone.
That is a real measurement of my change by someone other than me, and it says the
suite is better and still not a gate.
