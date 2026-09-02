# The first end-to-end run

**The pipeline worked.** One real Wyzant lead, screened, recorded, measured. And it exposed one more disconnect of the same family as everything else today.

---

## What actually happened

```
LEADS        1, subject "Essay Writing", status new
VERDICT      needs_human_review
RUNS         S1.qualify succeeded, S1.ingest succeeded
RUN STEPS    poll-dedupe-qualify, poll-and-ingest, handoff - all succeeded
MEASUREMENTS s1.leads_polled 1, s1.leads_inserted 1,
             s1.prospects_qualified 1, s1.icp_pass_leading_indicator 0
EXCEPTIONS   none
```

`Essay Writing` is one of Cole's four approved subjects, so the scope filter did its job. The verdict is `needs_human_review` rather than `icp_pass`, which is why no research brief and no draft followed - the pipeline correctly declined to auto-advance something it was not sure about. That is the design working, not a stall.

Four KPI measurements written from a real run. KPI #4's denominator exists for the first time.

---

## The disconnect: adapter exceptions never leave the GitHub runner

The Wyzant adapter builds three kinds of exception - `WyzantBoardInventoryMismatch`, `WyzantSubjectsRejected`, `WyzantJobMalformed` - and hands them out through `drainExceptions()`.

`drainExceptions` has exactly one caller: `lib/workflows/s1-qualify.ts:60`. That workflow runs **on Vercel**, against the `BatchAdapter` that wraps the POSTed leads. The BatchAdapter is a container; it has no exceptions to drain.

The real Wyzant adapter runs **on the GitHub runner**, where it generates its exceptions. And `ops/wyzant-poll.ts` sends this:

```ts
body: JSON.stringify({ leads, heartbeat }),
```

No exceptions. The ingest contract has no field for them. They are created on the runner, drained by nobody, and discarded when the job ends.

**So everything built this morning to make inventory loss loud cannot reach the database on the production path.** The reconciliation exception that names both counts, the rejected-subject labels that would answer Cole's question about `Reading` and `Writing` - all of it works in tests, because tests call the adapter directly, and none of it works in production.

Today's run reported zero exceptions. That is consistent with a board that happened to hold exactly one matching job and nothing rejected. It is equally consistent with a mismatch and a pile of rejected subjects that vanished with the runner. **There is no way to tell, and that is the defect.** The board held 17 online jobs in Cole's subjects six hours ago.

This is the fourth instance today of the same shape: a mechanism that is correct in tests and disconnected in production. The session secret, the deployed app, the interaction lock, and now the exception channel.

---

## Also now measurable: the run still bills two minutes

`1m54s`, of which `Initialize containers` is 29s. The container change is live and it did remove the browser install, but the job is still over the 60-second line, so GitHub bills 2 minutes. At 34 runs a day that is about **2,040 minutes a month against a 2,000 budget** - still marginally over, and shared with the other repository.

Not urgent, and cheaper than the 5,700 it was. Worth one look at whether the container init can be trimmed, or the cadence dropped to hourly outside peak hours.

---

## Fix brief for the executor

**1. Carry adapter exceptions across the boundary.**

- Extend the ingest contract to accept `exceptions?: AdapterException[]` alongside `leads` and `heartbeat`, validated the same way the leads are - bounded length, known `kind`, known `severity`, message length capped.
- `ops/wyzant-poll.ts` drains every adapter after polling and sends what it collects, **including when the poll itself failed**. A poll that dies mid-way is exactly when the exceptions matter most.
- The route records them against the ingest run so they land in `exceptions` with a run id.
- **G5 still applies.** These messages carry hashed source refs, subject labels and counts. Assert that no message field can carry a learner name, a job URL, or message body text, with a test that feeds one in and proves it is refused or stripped.

**2. Prove it end to end, not per unit.**

- A test that runs the real `WyzantAdapter` against the 17-versus-10 unreconcilable fixture, serialises what the poll script would POST, feeds that through the ingest route's validator, and asserts a `WyzantBoardInventoryMismatch` row exists afterwards with both numbers in it.
- The same for `WyzantSubjectsRejected` with rejected labels.
- **This is the test whose absence let the gap exist.** Every piece was tested; the seam between them was not. Name it for that.

**3. Then re-run the poll and confirm the exceptions table is non-empty**, or that it is legitimately empty because the board really was clean. Either answer is fine. Not being able to tell is not.

---

## Standing

- Phases 0 through 5 audited. Engine, qualification and ingest live in production.
- `/today` is still the Phase 1 placeholder: no status filter, so it shows every lead regardless of verdict. Phase 7 replaces it.
- Source expiry and the delete control are now in the Phase 6 plan, per the owner's call.
- Cole owes a ruling on `Reading`, `Writing`, `College Essays`, and a travel radius for the in-person board.
- Phase 6 opens once the exception channel is closed and one poll's observability can be trusted.
