# AUDIT VERDICT - Phase 5: S3 Outreach preparation

**Commit audited:** `bdb2a9b` (parent `682bbb4`)
**Verdict: FAIL**, on one axis. The lint does not over-block, which is the harder half and you got it right. It under-blocks on paraphrase: nine of my seventeen attacks walked through.

---

## Reproduced

`engine.ts` md5 `9f95451a2e60cd143afa1d46618b34e0` unchanged. **31 files, 289 tests, 0 skipped.** `tsc`, `eslint`, `prettier --check`, `docs:lint` all clean.

**G1 verified independently.** My own grep over `outreach.ts`, `outreach-store.ts`, `voice.ts`, `facts.ts` and `s3-draft.ts` for `autoSend`, `.submit(`, `sentBy` assignment, `.click(`, `.press(`, `.fill(` returns nothing.

**The 0.20 threshold is untouched.** `MINOR_EDIT_THRESHOLD = 0.2`, strict `<`, and the measurement lives in `outreach-store.ts` while the definition is applied in `kpi.ts`. Splitting those two deliberately is the right instinct: it means no future phase can quietly recompute acceptance in the place where it stores it.

---

## The must-pass side is genuinely good

I wrote my own must-pass table before running anything, including eleven cases you did not name. **Eighteen of twenty pass clean.** Both remaining are explained, and neither is a lint defect:

- `"Some families use leverage to finance tuition"` was blocked by `blocked.wright-tuition` on the word `tuition`. That is your disclosed deliberate over-block. Isolated from that word, the leverage exemption behaves exactly right: financial sense passes, `"leverage her existing annotation habit"` fails.
- `"A single session is $120"` is blocked by `facts.unsupported-price`. See the owner item below - the register is what is missing, not the code.

"Comprehension" survives "comprehensive," "comprehensiveness" survives it, a superlative with a stated basis passes while the bare one fails, one link passes and two fail, a hyphen passes while both dashes fail, `"I cannot guarantee anything"` passes while the assertion fails.

**The negation handling deserves saying out loud.** Getting `"I cannot promise a particular score"` to pass while `"she will definitely get her score up"` fails is the crux of this phase - the honest disqualifier is *required*, and a lint that read it as a promise would force every draft to either lie or bounce. You saw that and tested both directions per clause. That is the failure this phase was most likely to ship and it is not here.

---

## Blocking - the five hard blocks are keyed on words, not on concepts

Your table shows eight of thirteen attacks passing your first version, all thirteen now blocked. I wrote seventeen more, in the register that a drafting model actually reaches for. **Nine passed.**

```
FAIL   Wright cost, euphemism        "Wright is not cheap, but the investment is in the four-figure range."
FAIL   scholarship deadline, hedged  "I believe applications are due around the middle of September."
FAIL   scholarship value, hedged     "The award is worth somewhere in the low tens of thousands."
FAIL   Harvard, oblique              "Cole did his undergraduate work in Cambridge, in Massachusetts."
FAIL   Oxford, oblique               "Cole spent two years reading at an ancient English university."
FAIL   credential, generic           "Cole holds a graduate degree from a top-five programme."
FAIL   SAT Math, softened            "Math is not my main area but I can take a look at it."
FAIL   outcome, hedged hard          "Students in her position often see meaningful movement by November."
FAIL   outcome, implied              "By November she should be comfortably where she wants to be."
```

Four of these are the same sentence as one you fixed, one paraphrase away:

| You fixed | Mine, still through |
|---|---|
| `"Cole studied at Cambridge, Massachusetts"` | `"Cole did his undergraduate work in Cambridge, in Massachusetts"` |
| `"tend to see their scores move by November"` | `"often see meaningful movement by November"` |
| `"The scholarship opens soon"` | `"applications are due around the middle of September"` (no `scholarship` token) |
| `"Wright runs about fifty five hundred"` | `"the investment is in the four-figure range"` |

That is the Phase 4 signature exactly: the fix matched the fixture's phrasing rather than the concept. The blocks trigger on `scholarship`, `Harvard`, `Oxford`, `tuition`, a digit, a named subject. Drop the token and keep the claim, and the claim ships.

Two of the nine are worse than the rest.

**`"Cole holds a graduate degree from a top-five programme."`** names no institution at all, so no institution pattern can catch it. `FACTS.md` says every credential row is BLOCKED and *"external drafts must omit the claim."* This is that claim, and it goes to a family under Cole's name.

**`"Math is not my main area but I can take a look at it."`** offers SAT Math. `F-005` is unambiguous that Cole is approved for exactly four subjects and not for SAT Math or any ACT section. This is a factual misrepresentation of his platform approvals in a reply sent on that platform.

### Why this fails the phase rather than being deferred

This is YELLOW with human send, so a person reads every draft. That is a real mitigation and I have weighted it. It is not enough, for two reasons. KPI #3 measures "minor edit or none" - copy the human has to catch and rewrite is the metric degrading, silently, in the direction that flatters it. And a tired reviewer at 11pm approving `"Cole did his undergraduate work in Cambridge, in Massachusetts"` has sent an unverified credential claim to a paying family, which `FACTS.md` addresses to the *draft*, not to the reviewer.

### The fix is a posture change, not more patterns

Adding nine regexes buys you until my next seventeen. The Phase 4 lesson applies in the other direction here: for the blocked categories, **invert the default.**

Detect the *topic* first - does this sentence touch Wright, the scholarship, Cole's background or credentials, a subject he does or does not teach, an outcome, or a price? - and then require that any claim inside a flagged topic trace to a VERIFIED row. A sentence about Cole's education has no VERIFIED row behind it, so it fails whether it says Harvard, Cambridge, an ancient English university, or a top-five programme. A sentence stating what Cole teaches must match `F-005` exactly. Topic detection is a much smaller and more stable surface than claim detection, and it fails safe.

Keep the existing word patterns. They are cheap and they catch the blunt cases. Add the topic gate above them.

**And put the five blocks into the model QA explicitly.** The plan puts LLM QA second precisely for what a regex cannot settle, and paraphrase is exactly that. I could not exercise it - no API key here, same as you - so require a test with a stubbed QA client proving each of the nine attacks above is rejected by the QA rules, so it is verifiable without a key.

---

## Must fix - the sample draft contradicts the prospect's own message

The prospect wrote: *"My daughter keeps running out of time on the reading section **before the November test**."*

Your lint-clean sample says:

> *"One thing to be straight about: **you have not said when the test is**, and I cannot promise a particular result without knowing how much runway there is."*

They said when the test is, in the same sentence you extracted the hook from. A parent reading that concludes nobody read their message - and it sits in the honest-disqualifier field, which is the one part of the draft whose whole job is to earn trust.

I accept your framing that the deterministic agent is a fallback and a test substrate, not the production voice, and that a template will read like a template. This is not a template-tone complaint. It is a correctness bug in the field the phase treats as load-bearing, and it proves the point you and I both need to hold: **`voiceLint` cannot see whether a draft is true to its input.** The disqualifier must be derived from the source message, and a disqualifier that asserts the absence of a detail present in the source is a defect. Test it with a prospect message that supplies each field the disqualifier might claim is missing.

## Against `VOICE.md`, otherwise

Reading the sample as copy: concrete detail from the source, plain language, one sharp observation rather than a tour, honest about uncertainty, no hype or superlative, four paragraphs, roughly 120 words, in bounds, low-pressure ask. It conforms. `"The detail that stood out was this:"` is scaffolding rather than voice, but that is the template showing, and I will judge the production voice against real model output once a key exists. **That part of my audit focus is deferred, not discharged.**

---

## For the owner, not the executor

**S3 cannot state a price.** `facts.unsupported-price` blocks any figure without a VERIFIED row, and there is no rate row in `FACTS.md`. Meanwhile `profiles.rate_cents` sits in the database and is not wired into outreach at all. The lint is behaving exactly as `FACTS.md` instructs; the register is what is incomplete.

Quoting a rate is close to the most ordinary thing a Wyzant reply does. **Cole needs to add a verified rate row**, or S3 ships replies that cannot answer the first question most parents ask. Do not solve this in code.

---

## Accepted, and now bound

Your flag on the hot-lead path is correct and I checked it. `ClaudeDraftService` runs on every ingest scoring 70 or above, writes to `drafts`, and passes through no voice lint. It is not reaching anyone yet - nothing in `/today` or in `alerts.ts` reads that table - so it is stored and inert. It goes live the moment Phase 7 builds the decision surface.

Flagging it rather than widening this phase was right. I am binding it in `CLAUDE.md` so Phase 7 cannot ship it quietly: **no surface may render a `drafts` row until it has passed `voiceLint`.**

## On your harness correction

Your probe regex silently skipped the six positioning bans because their entries span lines, and it reported 55/55 while covering 55 of 63. You caught it by noticing a total that should have moved and did not, and the harness now verifies the file is byte-identical after every sweep and says so. That is the second time an executor here has caught its own harness lying, and it is the habit that makes the rest of the numbers worth anything.

---

## Standing

- U6 and U7 closed. Live poll unblocked.
- Phase 5 migrations undeployed. After `prisma migrate deploy`, re-run the anon probe - fifteen tables now, `_prisma_migrations` included.
- S2 spelled-out numerals still open, still gated on a live `ResearchSourceProvider`.
- Phase 6 not started, and does not open until this passes.

---
---

# INSTRUCTION TO EXECUTOR - Phase 5 fix pass

Fix on top of `bdb2a9b`. Do not start Phase 6.

**1. Add a topic gate above the word patterns.** Keep every existing pattern. Add, ahead of them, a check that asks what a sentence is *about* - Wright, the scholarship, Cole's background or credentials, what subjects he teaches, an outcome, a price - and requires any claim inside a flagged topic to trace to a VERIFIED row in `FACTS.md`. No VERIFIED row behind Cole's education means every sentence about his education fails, whatever institution it names or declines to name. Subject claims must match `F-005` exactly.

**2. All nine of my attacks must block, and my twenty must-pass rows must still pass.** Both tables in the suite, each row named. The must-pass table is as binding as the must-block table - the eighteen that pass today must still pass after the topic gate, or you have traded this failure for the Phase 4 one.

Add your own new attacks too. If mine are the only ones in the suite, the next auditor's seventeen will find the same thing again.

**3. Put the five blocks into the model QA rules explicitly**, and prove it with a stubbed QA client so it is testable without an API key. Each of the nine attacks must be rejected by the QA rules independent of the lint.

**4. The disqualifier must be true to the source message.** A disqualifier asserting a detail is missing when the prospect supplied it is a defect. Test with a prospect message that supplies each field the disqualifier might claim is absent - deadline, subject, grade, format.

**5. Negative probe per clause** on everything new. The topic gate has at least two clauses per topic; break each on its own and prove the lint names it.

Do not touch `lib/core/engine.ts`; report its md5. Do not edit `ICP.md`, `VOICE.md`, `FACTS.md` or `BASELINES.md`. Do not move `MINOR_EDIT_THRESHOLD`. Run `pnpm verify` and report file, test and skipped counts exactly - currently 31 / 289 / 0. House rules in `CLAUDE.md`. Stop and print the AUDIT HANDOFF block, saying plainly what you fixed and what you did not.
