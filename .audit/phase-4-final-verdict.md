# AUDIT VERDICT - Phase 4: S2 Prospect research

**Commit audited:** `2d8c304` (parent `6aa8d90`)
**Verdict: PASS.** Phase 4 is closed. Phase 5 opens, subject to the two standing gates below.

One residual gap is recorded as a carry-forward, not a defect. It is explained at the end and it cannot bite before Phase 5 builds a source provider.

---

## Independently reproduced

- `lib/core/engine.ts` md5 `9f95451a2e60cd143afa1d46618b34e0`. Unchanged.
- **29 files, 183 tests, 0 skipped, 0 failed.** `tsc --noEmit`, `eslint .`, `prettier --check .` all clean.
- 14 tables across the migration set, all with RLS enabled in the migration that creates them, no policy, no anon grant.

## Both tables pass, and the fix generalizes past them

All eleven must-EXCLUDE rows excluded. All seven must-PASS rows kept **with content byte-identical to what was fetched**. That was the binding pair and it holds.

More important, I wrote eight cases that were **not** in the brief, to check whether the fix solved the problem or fitted my table:

```
NEW: must EXCLUDE
ok    "Aged 14, Marcus trains with the reading squad..."      [minor-personal-data]
ok    "Marcus is in eleventh grade... his email is..."        [personal-contact-data]
ok    "My son Marcus needs SAT help; call me at 555-0143."    [minor-personal-data]
ok    "Priya, class of 2029, is looking for an essay tutor."  [minor-personal-data]

NEW: must PASS
ok    "The senior year curriculum includes an essay seminar each spring."
ok    "Questions about enrollment go to enroll@example.org or the front desk."
```

`senior year curriculum` surviving while `Jordan is a sophomore at North Example High` is excluded is the distinction the old filter could not make. That is a real fix, not a fitted one.

## Sentence-level retention is real

I checked the behavior the granularity change was for, on mixed pages:

```
"The Example Learning Center runs an SAT Reading intensive each fall.
 Jordan Lee is 16 years old and attends North Example School.
 Sessions meet on Saturday mornings."

exclusion: minor-personal-data
kept: "The Example Learning Center runs an SAT Reading intensive each fall. Sessions meet on Saturday mornings."
```

The minor sentence is removed, the page survives, and the exclusion is logged with the true reason. Same behavior for a contact-only sentence, logged as `personal-contact-data`.

## The blocking regression is gone

The end-to-end case that failed last round, with the same three organizational pages:

```
status: succeeded
confidence: 0.85   (was 0.30)
public-web evidence: 3
exclusions: 0

3. Public context: The public library offers a weekly SAT Reading study room. [evidence-e000b6136e70]
Disqualifier:
- Fit risk for SAT Reading: none identified in the scoped evidence.
```

The brief no longer manufactures an absence of public context. That was the blocker and it is closed.

## Finding 1 stayed closed, and the per-clause discipline held

I re-ran the prose-injection attack. It fails, and it names each clause on its own rather than dying at the first:

```
status: failed | saved: 0
exceptions: brief.whyFit.label: free-text why-fit labels are forbidden.
         || brief.disqualifier.label: free-text disqualifier labels are forbidden.
         || hook-1.angle: free-text hook angles are forbidden.
```

That is what a negative probe per clause is supposed to look like.

## Rendering

Fixed beyond what I named, and the generalization was the right call:

```
Fit evidence:
1. Prospect request: Grade 11 student wants a focused SAT Reading plan this fall.
2. Subject match: SAT Reading
3. Public context: The public library offers a weekly SAT Reading study room.
Disqualifier:
```

`Sources:` now lists only cited evidence. The label wins and the fact's own prefix is dropped only when the label already carries it, so no free-text field returns.

---

## Your two open questions

**Row 9's label. Your call stands.** `Home address 12 Oak Street belongs to the student Jordan Lee.` is `personal-contact-data`, not `minor-personal-data`. Your reasoning is right and I would have argued it the same way: no age, no grade, no enrollment verb, so a minor is not established by the sentence. Promoting bare `student` to a minor identifier would drop every page that says "our students," which is the over-block we just spent a pass removing. The sentence is excluded either way, and the label should say what was actually found.

**`daughter` and `son` as minor-identifying, `child` and `student` not.** Agreed, and for the same reason. "helps your child read closely" is marketing copy; "my daughter Emma" names a specific young person.

**The route count.** You compared against 14, but I never reported a route count. Fourteen is the number of **tables** in the migration set, in the line about the anon probe. Your 9 routes is correct and nothing changed.

**The `.audit/` reformat.** No harm done, and adding it to `.prettierignore` was the right response. Thank you for flagging it rather than leaving me to find it.

---

## Carry-forward, not a defect: spelled-out ages and grades

Numerals are caught. Words are not:

```
PASSED  "Marcus, sixteen years old, is preparing for the SAT."
PASSED  "Marcus is in eleventh grade at Example High School."
PASSED  "Marcus is a tenth grader at Example High School."
PASSED  "Marcus is in Year 11 at Example High School."
```

Each names a specific minor's age or grade and would reach a brief.

I am not failing the phase for this, for one specific reason: **there is no source provider.** `ResearchSourceProvider` is an interface with no implementation anywhere in `lib/` or `app/` - the only `fetchPublicSources` calls are the injected fakes in tests. No real page reaches this filter today, so the gap cannot produce a real brief containing real data about a real minor until someone builds the fetcher.

That makes it a gate on the provider rather than a gate on Phase 4:

> **Before any live source provider ships, the minor-identifying signal set must cover spelled-out numerals** - written ages (`sixteen years old`), written grades (`eleventh grade`, `tenth grader`, `eighth grade`), and `Year N` - with both tables extended and each new clause probed on its own.

Please add that line to `CLAUDE.md` next to the U6 line, so it binds the same way. It is a bounded addition to one regex table, not a redesign, and the structure it plugs into is now correct.

Two smaller residuals you already disclosed, both confirmed and both acceptable because they drop one sentence and never a page: an organization's own street address (`located at 400 Market Street`) and a named adult beside a role mailbox both read as personal contact data.

---

## Standing gates before Phase 5's work reaches production

1. **U6 restore drill is still open**, and the live Wyzant poll stays off until it closes.
2. **Deploy the Phase 2, 3, and 4 migrations**, then re-run the live anon probe across all **fourteen** tables: `approvals, drafts, exceptions, leads, measurements, metrics_daily, outcomes, poll_heartbeats, profiles, research_briefs, run_steps, runs, system_flags, tutors`.

Phase 5 - S3 outreach preparation, YELLOW, human-send - is open.
