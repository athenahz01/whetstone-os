# AUDIT VERDICT - Phase 4 fix pass

**Commit audited:** `6aa8d90bc11ced50bc8b80da306ad04dbeb868c4`
**Verdict: FAIL.** Three of four findings are properly closed. Finding 2's fix traded an under-block for a worse over-block and has to go back.

Independently reproduced: `engine.ts` md5 `9f95451a2e60cd143afa1d46618b34e0` unchanged, **156/156 tests, 0 skipped**, `tsc --noEmit`, `eslint .`, and `prettier --check .` all clean.

---

## Closed, and closed well

**Finding 1 - prose injection. CLOSED.** I re-ran the exact attack that shipped last time. `angle` and both `label` fields are gone from the type, `Object.hasOwn` rejects a brief that carries them anyway, `hook.kind` must be in the closed vocabulary _and_ match the trusted brief, and every claim is now fingerprint-matched by id, text, and evidence ids. Result:

```
status: failed | briefs saved: 0
```

The right fix. The trust registry now covers every string that reaches the page.

**Finding 3 - constant disqualifier. CLOSED.** It cites its own `fit-risk` evidence, is distinct from unknowns, and names the actual reason: `"Fit risk for SAT Reading: no relevant public context corroborates the supplied record."` Choosing to say "none identified in the scoped evidence" rather than manufacture a risk was the honest call.

**Finding 4 - truncated ICP claims. CLOSED.** Wrapped bullets are rejoined and the selector now refuses a fact that does not end a sentence. The claim renders whole: `"The subject matches one of the four approved subjects above, and no part of the request falls in the out-of-scope list."`

---

## Blocking - Finding 2's fix excludes ordinary pages and hides it as an honest finding

The under-block is genuinely gone. All eleven minor-data phrasings I supplied are now excluded, including the ones the old regexes missed. That half is done.

But the new signal set is far too broad and is applied at the wrong granularity. I ran seven safe pages - no person named, no minor mentioned:

```
--- must PASS ---
ok           library program page
ok           workshop page
OVERBLOCKED  org page with contact email    reason=minor-personal-data  kept=null
OVERBLOCKED  schedule page w/ time          reason=minor-personal-data  kept=null
OVERBLOCKED  page using 'born'              reason=minor-personal-data  kept=null
OVERBLOCKED  page about senior tutors       reason=minor-personal-data  kept=null
OVERBLOCKED  page w/ phone                  reason=minor-personal-data  kept=null
```

Five of seven dropped whole. The causes:

- `PUBLIC_PERSONAL_DATA_SIGNALS` is tested against **the entire page** and drops it entirely. An organization's contact email or phone number in a footer kills a page whose body is completely usable. The instruction was sentence level _in addition to_ page level; this applied the broadest set at page level.
- `/\b(?:born|date of birth|dob)\b/i` matches the ordinary verb. `"The reading program was born out of a 2019 pilot"` is excluded as minor personal data.
- `/\b(?:freshman|sophomore|junior|senior)\b/i` matches `"Our senior instructors design each SAT Reading plan"`.
- `/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*(?:,|is)\s*(?:[1-9]|1[0-7])\b/` matches any capitalized word followed by a comma and a small number. `"sessions on Saturday, 9 a.m."` is excluded.
- Every one of these logs `reason: "minor-personal-data"`. The exclusion log now states a reason that is not true.

### Why this is blocking rather than cosmetic

Run it end to end with three plausible public pages - a library, a learning center, and a schedule, none mentioning any person:

```
allowed pages: 0 | exclusions: ["minor-personal-data","minor-personal-data","minor-personal-data"]
gate issues: 0

Disqualifier: Disqualifier
- Fit risk for SAT Reading: no relevant public context corroborates the supplied record.
Unknowns:
- Relevant public research facts recorded: 0
Confidence: 0.30
```

The brief does not report a filter problem. It reports, in its own voice and with a citation, that **no public context corroborates this prospect** - and hands Athena a 0.30-confidence brief that looks like an honest thin-evidence result. It is not. The evidence was there and the filter ate it.

That is the same failure the plan named for this phase, wearing different clothes: a fluent, plausible, wrong brief that passes every automated check. Last round the wrong content was injected; this round it is manufactured by omission. In production nearly every real source page carries a contact address, so the steady state is every brief at 0.30 and S2 producing nothing of value while reporting success.

The fix instruction said a filter that excludes everything is not a fix, and asked for at least one page that must still pass. One safe page was added to the suite. It happens to contain no email, no phone, no date, and no common word from the block list, so it passed and the problem stayed invisible.

---

## Two smaller items

**`renderTraceabilityIssues` cannot ever fire.** Its only call site is `citationGateIssues`, which invokes it as `renderTraceabilityIssues(brief, renderResearchBrief(brief))`. The function then rebuilds `expected` from the same brief using the same expressions as `renderResearchBrief` and compares. It is comparing a function's output to a copy of that function's output. It reports nothing for any brief this code can produce. The real protection for Finding 1 comes from the type change and the trust fingerprints - which is why the attack failed - so nothing is lost, but a gate that cannot fail is worse than no gate in a file whose entire job is assurance. Either delete it, or give it a real input: render from the **trusted** brief and compare that against the artifact that was actually stored.

**Rendering warts.** `Location: Location: Palo Alto` and `Disqualifier: Disqualifier` - the hook label duplicates the fact's own prefix, and the disqualifier heading duplicates its constant.

---

## Standing gates, unchanged

- Live Wyzant poll stays off. **U6 is still open.**
- Phase 2, 3, and 4 migrations undeployed; the live anon probe over all fourteen tables has not been run.
