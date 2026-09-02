# Audit verdict — the exception channel across the runner boundary

**Commit audited:** `6e38c32` (parent `fd338de`)
**Auditor:** Claude (Cowork), independent probes in a Linux container from a source tarball of the working tree
**Verdict: PASS WITH FINDINGS.** The channel works. One finding is a real hole in the G5 guarantee this pass exists to enforce, proven by mutation. Two are observability defects. None of the three requires reverting anything.

---

## What I verified independently, and what held

I re-derived the numbers rather than accepting them.

**Full suite: 37 files, 419 tests, 0 skipped, all passing.** Matches the handoff exactly.

My first two runs reported 9 failures across 3 files. That was my sandbox: Playwright expected Chromium build 1234, the image has 1194. I aliased the build and everything passed. I have made this exact mistake twice in this project and reported a false defect for it once, so I checked before saying anything this time.

**The wire contract's must-block side works.** Refused, each confirmed by its own probe: a full URL, a severity the kind does not declare, an unregistered kind, a batch of 51, a non-array `exceptions` field, and a malformed entry inside an otherwise valid array. `undefined` and `null` are correctly distinguished, so an absent field is not treated as a malformed one.

**The must-pass side is intact — no over-blocking.** All five real message shapes are accepted: both inventory-mismatch variants (`online` and `in_person`, counted and count-unavailable), the real rejected-subject label list, a real malformed-job reason, and a real poll failure. A must-pass table is as binding as a must-block table, and this one holds.

**The 300-character outer cap really is unreachable, exactly as reported.** The executor said removing it changes nothing today and reported it rather than rounding up. I checked the arithmetic per kind: `WyzantSubjectsRejected` maxes at 272 characters (32 prefix + 240 label bound), `WyzantJobMalformed` at 227, `AdapterPollFailed` at 102, `WyzantBoardInventoryMismatch` at about 90. Nothing a registered kind can build reaches 300. **The claim was accurate.**

**The `finally` drain is correctly placed**, and a mutation that silences the drain is caught: I replaced `context.recordException(exception)` with a no-op and 3 tests across 2 files failed. The seam test earns its name.

**The subject-label guarantee holds at the adapter, as claimed.** `onRejectedSubjects` is fed only from `filterWyzantJobs`'s rejected-subject set, which is populated from `job.subject` and nothing else. The executor's self-reported residue — that a two-capitalised-word learner name is indistinguishable from a two-word subject label — is real, and I confirmed it passes the validator. Naming that split rather than implying the regex covered it was the right call.

---

## Finding 1 — the malformed-job reason slot is free text, and nothing pins it

**Severity: medium. Latent, not live. This is the finding of the pass.**

`WyzantJobMalformed`'s message shape is `^[A-Za-z0-9_-]{1,64}: [A-Za-z][A-Za-z0-9 ,.'-]{1,160}$`. The second half admits 160 characters of ordinary prose. These all pass the validator:

```
ACCEPTED  JOB-1: Sri needs help with his Fulbright essay
ACCEPTED  JOB-1: parent is Xiang Gao, dad
ACCEPTED  JOB-1: call 9144093253 today
ACCEPTED  JOB-1: contact max.z.gao gmail.com
```

The last one is worth noting on its own: `FORBIDDEN_IN_MESSAGE` blocks `@`, so an address with the at-sign removed reads as prose and crosses.

Nothing is leaking today. `reason` is `error.message` from three literal throws in `extractJobs` — "job URL is invalid", "job subject is missing", "job description is missing" — plus a fallback. I checked every `throw` in `lib/adapters/wyzant.ts` and none interpolates input.

**But that is the only thing holding the guarantee, and I proved it is not enough.** I changed one line:

```ts
- if (!job.text.trim()) throw new Error("job description is missing");
+ if (!job.text.trim()) throw new Error(`job description is missing for ${job.author}`);
```

A learner's name now crosses the runner boundary and lands in the `exceptions` table. **All 37 files and 419 tests still pass. `tsc --noEmit` is clean.** Nothing catches it.

`WyzantExtractionFailure.reason` is typed `string`. The `try` block it comes from wraps `isOfficialWyzantUrl`, `parseWyzantPostedAt` and a spread, so any callee that later throws an interpolated message puts that message on the wire. The G5 report listed what the validator refuses and named one honest gap; it did not name this one, and this one is the larger of the two, because the subject-label residue needs a board subject that happens to look like a name, whereas this needs one ordinary edit.

This project already has the right idiom for exactly this risk. `lib/core/research.ts` refuses "free-text why-fit labels", "free-text disqualifier labels" and a "hook kind outside the closed vocabulary." The exception channel is the one place carrying learner-adjacent strings that did not get a closed vocabulary.

**Fix.** Register the reason vocabulary the way kinds are registered. Replace `reason: string` with a union of the four reasons that exist, have the registry match `message` against `^<id>: (job URL is invalid|job subject is missing|job description is missing|job could not be normalized)$`, and add a probe that reproduces the mutation above and fails. Then the type system and the validator both refuse the edit, instead of both permitting it.

---

## Finding 2 — `exceptionsRecorded` measures what was accepted, not what was written

**Severity: medium, and it undermines the handoff's own closing instruction.**

`app/api/ingest/route.ts:85` returns `exceptionsRecorded: exceptions?.length ?? 0`, where `exceptions` is the parsed request body from line 35. It is computed before `runProspecting` runs and is never revised by it. The name says recorded; the value means received and validated.

No test references `exceptionsRecorded` at all — I grepped the whole `tests/` tree.

The mutation above shows the *mechanism* is protected: silencing the drain fails 3 tests. So this is narrower than it first looks. But the failure mode a live poll adds over the suite is precisely a production write failure — a rejected insert, an RLS refusal, a rolled-back transaction — and in every one of those `exceptionsRecorded` still returns the full count while the table holds nothing.

That matters because it is the exact number the handoff hands her: *"run the poll and read `exceptionsRecorded`."* If the write path fails in production, that number reads 3 and the channel looks healthy.

**Fix.** Count rows, not inputs: after `runProspecting`, count `exceptions` rows for the qualify run id and return that. A number named "recorded" should come from the table.

---

## Finding 3 — on a failed poll, the counts are computed, sent, and never printed

**Severity: low, but it is the run where she will be reading the log.**

`ops/wyzant-poll.ts` in order: POST, then `if (!response.ok) throw`, then `if (failedAdapters.length > 0) throw`, then `await response.json()`, then `console.info("[wyzant-poll:complete]", {...})`.

So when an adapter fails — the case the `finally` drain was written for — the exceptions are drained, sent and recorded, and then the script throws before reading the response and before logging. `exceptionsSent`, `exceptionsRecorded` and `exceptionsDropped` never print on that run.

Related: `heartbeat: "recorded"` is a hardcoded string in that log line. It is only ever correct because the failure path throws before reaching it.

**Fix.** Read the response and log the counts before either throw, so a partial failure reports what it managed to record.

---

## The two design calls the executor flagged, ruled

**Attaching rows to the `S1.qualify` run rather than the ingest run: keep it.** `drainExceptions` is already called there and nowhere else. The requirement was that exceptions land in `exceptions` with a run id, and they do. Adding a second recording path to satisfy the brief's wording would have been the worse outcome, and the executor was right to say so rather than build it.

**"One link is checked by shape, not by execution" — accepted, and it is the honest weak point.** `new BatchAdapter(body.leads, exceptions ?? [])` needs a live database to invoke, so its test reads the source. Everything either side is exercised for real. I could not close this without provisioning a database, and it is not worth one.

---

## Still open, unchanged by this pass

- The in-person board URL is unconfigured, so the poll sees online inventory only (D-001).
- Cole owes the `Reading` / `Writing` / `College Essays` ruling. After the next poll those labels will be rows in `exceptions` rather than lines in a runner log — which is the point of the pass.
- S2 spelled-out numerals, still bound in `CLAUDE.md` before any live `ResearchSourceProvider`.
- The workflow bills 2 minutes a run, about 2,040 minutes a month against a 2,000 budget. Correctly left out of scope; it is a cadence decision.
- `CLAUDE.md` and `whetstone-agentic-ops-build-plan.md` are still uncommitted in the working tree.

---

# Fixes applied — auditor pass on top of `6e38c32`

All three findings are closed. Verified: **442 tests in 38 files, 0 skipped, all passing** (baseline 419/37 — one new file, 23 new tests). `tsc --noEmit` clean, `eslint` clean, `prettier --check` clean, `docs:lint` 6/6, `next build` compiled. `lib/core/engine.ts` md5 unchanged at `9f95451a2e60cd143afa1d46618b34e0`.

## Finding 1 — closed, and it was worse than I reported

`lib/adapters/wyzant-reasons.ts` is new: the vocabulary of reasons a malformed job may report, in its own module with no Playwright import, because the adapter runs on the GitHub runner and the validator runs inside the Vercel route, and sharing a constant must not drag a browser driver into a serverless function.

The guarantee is now enforced twice, so neither side is load-bearing alone:
- **At the source.** `narrowWyzantExtractionReason` maps anything unrecognised to `job could not be normalized`. A thrown message is never passed through.
- **At the boundary.** `WyzantJobMalformed`'s registry entry is built from the vocabulary rather than from a shape, with regex metacharacters escaped — one reason ends in a period, and an unescaped `.` would have matched any character there.

`WyzantExtractionFailure.reason` is now the union type, so the type system refuses the edit too.

**Re-running the mutation:** interpolating `job.author` into the `job description is missing` throw now fails `tests/wyzant-extraction-fixture.test.ts`, because the reason silently becomes the fallback and the fixture asserts the real one. The leak is impossible and the behaviour change is visible. Before the fix, that same mutation passed all 419 tests.

**I got the enumeration wrong in the audit above, and the fix caught me.** I wrote that the reason set was "three literal throws plus a fallback" — I had grepped for interpolated throws, found none, and stopped. There is a fifth: `parseWyzantPostedAt` throws `Wyzant job is missing a recognizable posted time.` from inside the same try block, and that message was already crossing the wire. So the reason set was not merely open in theory to a future callee; it was **already open to a callee, in production, today**. That is the finding strengthened, not weakened — but the enumeration was mine and it was incomplete, and only the failing fixture test surfaced it. All five are now registered, and a test pins the list by value so adding one forces a review.

## Finding 2 — closed

`app/api/ingest/route.ts` counts rows:

```ts
const exceptionsRecorded = await prisma.exception.count({
  where: {
    runId: prospecting.qualification.run.runId,
    kind: { in: [...ADAPTER_EXCEPTION_KINDS] },
  },
});
```

A rejected insert, an RLS refusal or a rolled-back transaction now shows as a shortfall against `exceptionsSent` instead of reporting the full count from the request body.

## Finding 3 — closed

`ops/wyzant-poll.ts` reads the response and prints the counts **before** the failed-adapter throw, so the run the `finally` drain exists for is no longer the one run that reports nothing. A non-OK ingest logs `[wyzant-poll:ingest-failed]` with what it had. And `heartbeat` is now reported as `recorded` or `withheld` from the actual value rather than hardcoded to `"recorded"`.

## What is still not proven by execution

Unchanged from the executor's own report, and still the weakest link: `new BatchAdapter(body.leads, exceptions ?? [])` needs a live database to invoke. My row-count fix sits in the same function and has the same limitation — it is typechecked and built, not executed. **The next live poll is what proves it**, and now it proves something real: if `exceptionsRecorded` comes back lower than `exceptionsSent`, the rows did not land.
