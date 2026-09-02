# TASK FOR CLAUDE CODE - Phase 4 fix pass 2

Read `CLAUDE.md` at the repo root first. It is the binding contract. Then read `whetstone-agentic-ops-build-plan.md`, section **Phase 4**.

You are the executor. I am the auditor. Current HEAD is `6aa8d90` ("Fix Phase 4 research audit gaps"). Three of four audit findings are closed and must stay closed. One is rejected. Fix it and the two smaller items below, then stop and print the AUDIT HANDOFF block. **Do not start Phase 5.**

Everything below is in `lib/core/research.ts` unless stated.

---

## 1. BLOCKING - the minor-data filter excludes ordinary pages

The under-block is fixed: all eleven minor-data phrasings are now caught. Keep that. The problem is the other direction. Five of seven safe pages are dropped whole, and every one is logged as `minor-personal-data`, which is not the truth.

Root cause is two conflated ideas at one granularity. Separate them.

**a. Split the signal sets by what they actually mean.**

- **Minor-identifying context** - an age under 18, `N years old`, `turning N`, a grade level, `class of 20XX`, a date of birth _with a date_, enrollment language (`attends`, `enrolled at`, `student at`). This is the genuine block.
- **Personal contact details** - email, phone, street address. These are only a concern when attached to a person. On an organization's page they are ordinary and must not trigger anything.

**b. Fix the granularity.** Evaluate **both sets at sentence level**. Drop the whole page only when a minor-identifying signal is present. Never drop a whole page because a contact detail appears somewhere in it. Keep the current behavior of retaining the safe sentences and logging the exclusion.

**c. Reject a sentence when** it carries a minor-identifying signal, **or** it carries a personal-contact signal together with a person reference in the same sentence (a capitalized given name, or `daughter`/`son`/`child`/`student`/`he`/`she`/`they`). A bare contact line with no person in it stays.

**d. Delete or tighten these specific patterns. Each one is currently firing on ordinary text:**

| Pattern                                                                | Fires on                                   | Do this                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*(?:,\|is)\s*(?:[1-9]\|1[0-7])\b/` | `sessions on Saturday, 9 a.m.`             | Delete it. Replace with a pattern that requires an age unit or `is N and`, so a name adjacency alone is not enough. |
| `/\b(?:born\|date of birth\|dob)\b/i`                                  | `the program was born out of a 2019 pilot` | Require a following date or year.                                                                                   |
| `/\b(?:freshman\|sophomore\|junior\|senior)\b/i`                       | `our senior instructors`                   | Require school, grade, or year context in the same sentence, or a capitalized name.                                 |
| email / phone / street, tested page-wide                               | any org contact footer                     | Move to sentence level, and only with a person reference present (see c).                                           |

**e. Log the true reason.** Add `"personal-contact-data"` to `ResearchExclusion["reason"]` and use it when that is what matched. `minor-personal-data` must mean a minor was involved.

**f. Tests. Both tables are required, in one test file, each case named.**

Must be EXCLUDED (all eleven):

```
Jordan Lee is age 16 and attends North Example School.
Jordan Lee is 16 years old and attends North Example School.
Emma is 15 and her mom can be reached at emma.mom@example.test.
Jordan is in 10th grade at North Example School and his cell is 555-0100.
Jordan is a sophomore at North Example High. Email jordan@example.test.
My daughter Emma attends North Example School; reach her at emma@example.test.
Priya, a junior at Example High School, lives at 12 Oak Street.
Jordan Lee, born March 2010, attends North Example School.
Home address 12 Oak Street belongs to the student Jordan Lee.
Jordan turns 17 next month and attends North Example School.
Jordan is turning 17 next month at North Example School.
```

Must PASS with content intact and zero exclusions (all seven):

```
The public library offers a weekly test preparation study room. Sessions run each Saturday morning during the fall term.
The fall workshop emphasizes evidence-based reading strategies. Small groups focus on passage analysis.
The Example Learning Center runs an SAT Reading intensive each fall. For details contact info@example.org.
The published fall calendar lists study sessions on Saturday, 9 a.m. in the east wing.
The reading program was born out of a 2019 pilot and now serves the whole district.
Our senior instructors design each SAT Reading plan around diagnostic results.
The Example Learning Center offers SAT Reading tutoring. Call 555-867-5309 to enroll.
```

**g. Add one end-to-end test that the degradation cannot come back silently.** Feed the three organizational pages (library with contact email, learning center with phone, calendar with `Saturday, 9 a.m.`) through `createResearchWorkflow` for a complete `icp_pass` prospect and assert: at least one `public-web` hook is present, `confidence > 0.30`, and the disqualifier does **not** say no public context corroborates the record.

This last assertion is the point. The current build reports "no relevant public context corroborates the supplied record" at confidence 0.30 when the context was there and the filter removed it. A brief that states a false research finding in its own voice, with a citation, is worse than a brief that crashes.

---

## 2. `renderTraceabilityIssues` cannot fail

Its only call site is inside `citationGateIssues`:

```ts
issues.push(...renderTraceabilityIssues(brief, renderResearchBrief(brief)));
```

It then rebuilds `expected` from the same brief with the same expressions `renderResearchBrief` uses, and diffs the two. It is comparing a function's output against a copy of that function's output, so it returns `[]` for every brief this code can produce.

Pick one:

- **Delete it.** The real Finding 1 protection is the type change plus the trust fingerprints, and that protection is verified working - I re-ran the injection attack against this commit and it failed the workflow with zero briefs saved. Nothing is lost.
- **Or make it real:** render from the **trusted** brief and compare against the artifact that was actually stored, so a divergence between what passed the gate and what the human reads is caught.

Do not leave a gate that cannot fail sitting in the file whose job is assurance.

---

## 3. Rendering warts

`Location: Location: Palo Alto` - the hook label duplicates the fact's own prefix. `Disqualifier: Disqualifier` - the heading duplicates its constant. Fix both without reintroducing any free-text field.

---

## Rules for this pass

- Do not touch `lib/core/engine.ts`. Report its md5 in the handoff.
- Do not weaken anything that closed Findings 1, 3, or 4. The trust fingerprints, the closed hook vocabulary, the `Object.hasOwn` rejections, the distinct fit-risk disqualifier, and the rejoined ICP bullets all stay. Re-run the prose-injection case as a regression test if one is not already there.
- **Negative probe per clause, not per guard.** Break each clause of each new rule on its own and prove the gate names that clause.
- A filter that excludes everything is not a fix. The must-PASS table is as binding as the must-EXCLUDE table.
- Run `pnpm verify` and report file, test, and skipped counts exactly. Currently 28 files / 156 tests / 0 skipped.
- House rules in `CLAUDE.md`: PowerShell, no em dashes, never push.
- Stop after the fix and print the AUDIT HANDOFF block. State plainly which items you fixed and which you did not.
