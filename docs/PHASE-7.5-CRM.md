# Phase 7.5 - CRM: Whetstone's existing sales pipeline

Owner: Athena. Auditor: Claude (Cowork). Status: ready to build, 7.5a first.

## Why this exists, and why it is not the anti-scope item

`CLAUDE.md` lists "a CRM integration" under anti-scope, and the build plan
records the reasoning: *"There is no CRM. The new Postgres is the system of
record. Adding one now is a migration on the critical path."*

That entry forbids adopting a third-party CRM **product** - HubSpot, Pipedrive,
Attio, Airtable, Notion. This phase does the opposite, and is what that entry
protects: it moves Whetstone's own lead records into the Postgres that is
already the system of record. Section 4 below rejects every CRM product for
exactly the reason the anti-scope entry gives.

An executor that stopped on the phrase "CRM" was right to stop. The wording has
been disambiguated in `CLAUDE.md`; this document is the scope.

Origin: Ren asked on 26 Aug 2026 that the existing pipeline outrank the Wyzant
board. On revenue at risk he is correct: the sheet holds 20 live leads in a
business whose rows carry $10,000 deal sizes, against Wyzant's first real lead
at $55/hr. This does not stop Wyzant, which is finished. Wyzant fills the top of
the funnel; this runs the middle. A Wyzant lead lands in the same table, gets
the same silence clock, and appears in the same daily message.

## 1. What the audit found

Two live Google Sheets, both partly authoritative, read 26-27 Aug 2026. All
three tabs and all 40 shared columns compared, not a sample.

| | `!Dashboard` | `Copy of !Dashboard` |
|---|---|---|
| UG Sales rows | 69 | 44 |
| UG Sales columns | 44 | 49 |
| Has `Status` / `Outcome` / `Deal Size` | yes | **no, absent entirely** |
| Has `Admission Status` / `Materials` / `SAT` / `Academic` / `Tutoring Notes` / `Capstone` / `Essays` / `Region School` | no | **yes** |

The copy is not a backup. It is a fork that diverged in both directions. The
original holds the sales funnel and cannot say what a student needs; the copy
holds the academic picture and cannot say who is close to signing.

**Fill rates, UG Sales tab of `!Dashboard`, 69 rows.** Identity fields are
populated. Decision fields are not.

| Field | Filled |
|---|---|
| `ID` | 69 |
| `S First` | 48 |
| `Status` | 45 |
| `Lead Date` | 44 |
| `Referrer Source` | 52 |
| `1M Client` / `1M Closer` / `CC 1M Med` | 34 each |
| `1M Date` | 8 |
| `2M Date` | 7 |
| `3M Date` | 4 |
| `Due Date` | 6, every one already past |
| `Next Action` | 4 |
| `Responsible` | 4 |
| `Deal Size` | 3, despite rows carrying $10,000 |
| `Outcome` | **0** |

24 rows have no `Status`. 21 rows have an ID but no student name.

**Staleness.** Every date cell in the tab, by month:

```
2025-04  6    2026-01   5
2025-06  4    2026-02  24   <- last write to the file
2025-07  3    2026-03   0
2025-08  6    2026-04   0
2025-09  8    2026-05   0
2025-10  4    2026-06   0
2025-11  3    2026-07   0
2025-12  0    2026-08   0
```

Six consecutive months with no write, while 20 leads sit in a live stage
(Active 8, Cold 8, Prospect 2, Engage 1, Negotiate 1).

**Fork divergence.** 43 IDs in both files, 25 only in the original, none only in
the copy. 16 total differences across all shared columns, and the split matters:
**6 are head-to-head** (both files hold a real, different value) and **10 are
one-sided** (one has a value, the other is blank, and `!Dashboard` wins).

| # | Lead | Student | Stage | Field | `!Dashboard` | copy |
|---|---|---|---|---|---|---|
| 1 | U024 | Natalie Wu | Active | Referrer Source | Direct | Sibling |
| 2 | U025 | Rohan Tobey | Cold | Referrer Source | Affiliate Referral | Student Referral |
| 3 | U042 | Rafi Carrillo | Active | Referrer Source | Parent Referral | Affiliate |
| 4 | U044 | Gabriela Wu | Prospect | Referrer Source | Direct | Sibling |
| 5 | U033 | Daron Pidedjian | Engage | Due Date | Jul 15 | Apr 2 |
| 6 | U036 | two students | Prospect / Negotiate | ID collision | see below | see below |

`U036` is **not a duplicate row**. Two unrelated students hold the same ID:
Hamza Benyass (Prospect, no meetings, Direct) and Jack Yu (Negotiate, three
meetings, Amy Han parent referral). Jack Yu is the only lead in the entire
pipeline at Negotiate, the closest thing to a signed deal, and he is sharing an
identifier.

All 25 leads unique to `!Dashboard` are closed (7 Complete, 8 NQ, 9 Lost, 1
Inactive), so no live deal depends on that gap. G Sales and Affiliate have zero
conflicts across all rows and columns.

**Controlled vocabularies observed, for the schema.**

- `Status`: Cold, Active, Complete, NQ, Lost, Engage, Prospect, Negotiate, Inactive
- `Referrer Source`: Parent Referral, Student Referral, Sibling, Affiliate Referral, Direct, Event, Influencer, Linkedin
- `CC nM Med`: Video 16, Phone 8, HC 8, Meet 2. This distribution is why section 7 exists.
- `nM Client`: P, S, "P, S"
- `nM Closer`: R, C, "R, C", Jayden

## 2. The diagnosis

The fields that stayed full are filled once, at intake, while someone is already
at a keyboard. The fields that emptied need updating **after a call, when the
call is over**. So the CRM is not failing at storage. It is failing at two jobs
a file structurally cannot do:

1. Recording that a touch happened. The event exists in email and calendar; it
   never got copied into a column.
2. Saying what has been missed. A spreadsheet is a pull surface, and "what needs
   checking in on" is only asked when someone remembers to ask.

This is the v1 Growth Engine failure again: an agent system nobody opens saves
zero hours. **Do not build a dashboard as the primary deliverable.** Ren already
has a dashboard he does not open.

## 3. The build

### 7.5a - Merge and reconcile (GREEN, one-time). Build this first.

Load both files' UG Sales, G Sales and Affiliate tabs into the existing Postgres
under the existing `orgId`. The copy's eight academic columns become real
columns. The vocabularies above become enums with an `unmapped` escape hatch
that records the raw string rather than dropping it.

Conflicts are never auto-resolved, and never block the import either. A
disagreeing cell imports as `disputed`: `!Dashboard`'s value is the working
value, the copy's is retained alongside it, and the cell is flagged. A disputed
cell is excluded from anything that **acts** - it never drives a stall, a
threshold or a draft - so the build proceeds now and a ruling lands later as an
update rather than a re-import.

After merge, both spreadsheets become read-only mirrors or are archived, so no
one edits a fork again.

Acceptance:

- [ ] Every one of the 122 non-empty rows across both files lands in the
      database, or appears in a rejected-rows report with a reason. **A silently
      dropped row fails the phase.** This is the 41% inventory-loss defect from
      Phase 4 and it must not recur.
- [x] Row counts reconcile. **Closed 2026-08-27 against the live export.**
      UG Sales: **69 leads, 44 merged, 25 dashboard-only, 0 copy-only**, with
      `ug_sales::U036` the only split lead reference and no ambiguous rejections.
      44 merged leads across 43 shared references, because `U036` contributes
      two. G Sales: 31 merged, 0 and 0. `copyOnly` must be **0** for this data,
      and it is the canary: no lead exists only in the copy, so any non-zero
      value is a failed join rather than a real orphan.
- [ ] All 6 head-to-head conflicts import as `disputed` and appear in a ruling
      list. None is resolved by a rule.
- [ ] A `disputed` cell cannot drive a stall, a threshold or a draft. Proven by
      a test that disputes a stage and asserts the lead is excluded from the
      stall list rather than silently defaulting.
- [ ] `U036` imports as two rows with distinct ids. Never merged by a dedupe
      heuristic.
- [ ] A row with an ID and no student name joins the named row for that ID when
      there is exactly one. **21 rows in `!Dashboard` have an ID and no name**,
      and in the live export U045, U046 and U047 are named in `!Dashboard` and
      nameless in the copy. Keying identity on the name split each into two
      records sharing one reference, one holding the funnel and one holding the
      academic columns.
- [ ] When an ID is shared by two or more **named** students, a nameless row for
      that ID is rejected with a reason rather than joined by a guess.
- [ ] `splitLeadRefs` is empty apart from declared splits, and the write
      boundary refuses an undeclared one. **Balance cannot catch a failed join**
      - it counts source rows, and two rows that should be one lead balance
      perfectly.
- [ ] A value outside a vocabulary is stored raw and flagged, never coerced to
      the nearest match.
- [ ] Re-running the import is idempotent. Proven by running it twice and
      diffing the table.
- [ ] Applying a ruling afterwards is an update, not a re-import. Proven by
      applying one and asserting no other row changed.

### 7.5b - Touch detection from email and calendar (GREEN, scheduled)

A scheduled job reads the Whetstone Gmail and Calendar and matches against
`S Email`, `P1 Email`, `P2 Email`, `S Phone`, `P1 Phone`. Every match writes a
`touches` row: lead, timestamp, channel, direction, subject reference.
Read-only: the job never sends. Calendar is read forwards as well as backwards,
because a booked call is a reason not to nag.

Acceptance:

- [ ] A seeded email to a known lead address produces exactly one `touches` row.
      Re-running produces none.
- [ ] An email matching no lead is recorded as unmatched with a count, not
      discarded. A silent zero-match day and a silent failure must not look
      identical.
- [ ] `1M/2M/3M Date` are never written by a human again. They are derived views
      over `touches`.
- [ ] Meeting and email are distinguishable in the row, because the thresholds
      depend on it.
- [ ] A future calendar event with a lead attendee is stored as a scheduled
      touch, distinct from a past one.
- [ ] Every `touches` row records how it was learned: `email`, `calendar`, or
      `asserted` (section 7). A row can always say whether a human or a mailbox
      produced it.
- [ ] A lead whose contact details are **shared with another lead** is reported
      as `unattributable`, separately from `unmonitorable`. Having a contact
      detail is not the same as being reachable: in the live export U017 and
      U018 hold one usable contact each and it is the same parent phone, so
      every message from that parent is ambiguous and neither lead can ever be
      credited a touch. **U018 is live.** Siblings are the ordinary cause and
      the sheet already holds Liu twice, Wu twice and Wang three times.
- [ ] No message body text is stored. Subject reference and metadata only.

### 7.5c - The silence clock (GREEN, scheduled)

Per live lead: days since the last `touches` row, against a per-stage threshold.
Starting values, to be tuned: Negotiate 3, Active 7, Engage 7, Prospect 14,
Cold 30. Complete, Lost, NQ and Inactive are excluded.

A lead whose contact details are too sparse to match on is `unmonitorable`, not
healthy. This follows the Wyzant source-expiry rule: a lead that cannot be
re-checked is marked unverified, not expired. 52 of 69 rows have no student
email, so this class is large and must be visible.

Acceptance:

- [ ] Run against the merged data, produces a ranked stall list on the first
      execution.
- [ ] A lead with no matchable contact detail appears as `unmonitorable` with
      the missing field named. It never appears as "no action needed".
- [ ] A wholly `unattributable` lead reaches the clock the same way, and for the
      same reason: it cannot be re-checked, so it is visible, never healthy. A
      partially shared lead names which fields are invisible, so the stall line
      can say so rather than implying a complete picture.
- [ ] A lead with a scheduled call ahead of it is not a stall, however long it
      has been quiet.
- [ ] Every stall states its evidence basis, not just its number. A stall that
      reads "quiet 11 days" without saying what was searched fails the phase.
- [ ] Thresholds are configuration, not constants. Proven by a test that flips
      one and asserts the output changes.
- [ ] Every stall can name the row and the last touch that produced its number.

### 7.5d - The daily message (YELLOW where it drafts)

One message per day. At most five stalls, worst first, each with the lead, the
stage, how long it has been quiet, the last touch, and what the clock could see.
The reply is a number: draft a follow-up, snooze a week, mark lost, or already
spoke to them. **The reply is the CRM write.** Nobody opens a spreadsheet.

"Draft a follow-up" hands off to the existing `S3.draft` and `S3.voicelint`
path. Nothing sends without approval.

Acceptance:

- [ ] Ren completes a full day's triage without opening a spreadsheet or the web
      app. This is the phase's real test; everything else is plumbing.
- [ ] A reply writes the CRM and is attributed with a timestamp.
- [ ] "Already spoke to them" writes a real `touches` row dated today with basis
      `asserted`, and resets the clock. It does not merely hide the row.
- [ ] Snooze suppresses that lead for exactly the snooze window, then returns
      it.
- [ ] More than five stalls: the message says how many were held back. **A
      truncated list that reads as complete fails the phase.**
- [ ] Zero stalls sends a message saying so. Silence must never be ambiguous
      between "clear" and "broken".
- [ ] No draft reaches a human without passing `voiceLint`.
- [ ] Minor students' names appear only to the recipient. No name in a log line,
      an exception payload, or a notification preview.

## 4. Alternatives rejected

- **A CRM product: HubSpot, Attio, Pipedrive.** Fixes storage, which was never
  broken. Ren still logs every call by hand, the exact task that stopped in
  February, now with a per-seat bill and a migration on the critical path. This
  is the anti-scope item and it stays rejected.
- **Keep Sheets, add Apps Script.** Cheapest, and genuinely tempting. But it
  leaves both forks alive, still requires someone to open the file, and cannot
  run the drafting or the voice rules. It makes a stale file look healthier
  without making it current.
- **Rebuild in Airtable or Notion.** The same pull-not-push problem in a nicer
  grid, plus a second system of record to keep in sync.
- **Chosen: build on Whetstone OS.** The database, auth, scheduler, drafting
  agent, voice checker, exception channel and `/today` surface all exist and are
  audited. This is three scheduled jobs and one message format. Every touch it
  records also feeds Cole's KPI scorecard, which currently has no real events to
  count.

## 5. Defaults standing in for Ren's rulings

Athena's call, 27 Aug 2026: build without waiting on Ren. Each default is
revisable without a re-import, which is what makes waiting unnecessary.

1. **Which file wins: defaulted, flagged, revisable.** The 6 head-to-head
   conflicts import as `disputed` with `!Dashboard` as the working value. Four
   are `Referrer Source`, which decides referral credit, so those are excluded
   from anything computing attribution until answered.
2. **Where the daily message lands: defaulted to email.** Email is the one
   channel already wired. The message format is channel-agnostic on purpose, so
   moving to WhatsApp, Telegram or text later is an adapter, not a redesign.
   **This is the one real risk in the phase:** the design rests on the message
   reaching somewhere it gets answered same-day. If email is not that place,
   7.5d fails its own first acceptance box while 7.5a-c still stand.
3. **Access: Whetstone Gmail and Calendar, read-only.** Genuinely required for
   7.5b; no default can stand in. Note for whoever approves: the records include
   minors and parent contact details.

**7.5a, 7.5b and 7.5c need a ruling from nobody** and are most of the work.
Build them in order. 7.5d is last regardless.

## 6. Not in this phase

Auto-send of any kind. Cold outbound. A dashboard as the primary deliverable.
Any third-party CRM product. Deal-size or revenue forecasting, which needs the
`Deal Size` column populated first and it is filled on 3 of 69 rows.

## 7. Calls the system cannot see

Athena's question, 27 Aug 2026: what if the touch was a phone call, with nothing
on paper for the agent to find?

Correct, and not an edge case. Confirmed: Ren and Cole call from **personal
mobiles**, and also hold **scheduled Zoom/Meet calls**. The sheet's own
`CC 1M Med` distribution matches - Video 16 and Meet 2 leave a calendar trace,
Phone 8 and HC 8 leave nothing. So on recorded first meetings, roughly half to
two-thirds are visible and the rest are invisible.

There is no ingestion path for a personal-mobile call. Personal mobiles have no
reachable log, and Whetstone uses no business VoIP line that would have an API.
Anything that asks for a note after the call is asking for the same discipline
that emptied the `Next Action` column, and will fail the same way.

### The design rule

**Do not try to see the call. Make being wrong about it cost one keystroke, and
make the system say what it cannot see.** Three parts:

1. **A fourth reply: "already spoke to them."** It writes a real `touches` row
   dated today with basis `asserted`, and the clock resets. Ren is not logging a
   call; he is answering "is this stale?", which he knows from memory in one
   second. A false stall costs one tap and produces a true record.
2. **The clock states its evidence, never just its number.** A stall reads
   "quiet 11 days, email and calendar only, no phone visibility". Asserting a
   fact the system does not have is exactly the defect found in the Wyzant
   exception channel, where `exceptionsRecorded` reported what was accepted
   while naming what was written. Same class. Do not reintroduce it here.
3. **A booked call suppresses the stall.** Calendar is read forwards. A lead
   with a call on Friday is not stalled today however quiet it has been, which
   removes a large slice of false positives for free, and those are precisely
   the scheduled Zoom/Meet calls that make up the visible half.

### Why this is better than it sounds

**The record gets accurate through use rather than through maintenance.** Every
false stall Ren dismisses becomes a real touch. He never opens a form; the
correction rides on a decision he was making anyway. That inverts the failure
that emptied the spreadsheet, where keeping the record current was a separate
chore and the chore lost.

**A dismissal is itself a signal.** A lead marked "already spoke to them" three
times with no email or calendar trace is a relationship run entirely by phone,
and the system should widen that lead's threshold rather than nagging on a
cadence it has no evidence for.

Acceptance:

- [ ] "Already spoke to them" writes a `touches` row with basis `asserted`, not
      a suppression flag. Proven by asserting the row exists and the clock reset.
- [ ] Every stall line names its evidence basis. A stall that reads as a
      complete picture when only email and calendar were searched fails.
- [ ] A future calendar event suppresses the stall for that lead. Proven by a
      test that books one and asserts the lead leaves the list.
- [ ] After three `asserted` touches with no `email` or `calendar` touch between
      them, the lead's threshold widens and the change is recorded with its
      reason. Never a silent tuning.

### Explicitly not doing

- **Phone-log ingestion.** No API on a personal mobile, and an app on their
  phones is a bigger ask than the problem justifies.
- **Post-call voice notes or a quick-capture form.** The same discipline that
  already failed, in a new wrapper.
- **Inferring a call from a stage change.** Circular: stage changes come from
  the daily message, which is downstream of the clock.
- **Moving them to a business VoIP line.** That would make calls ingestible and
  is worth raising with Cole eventually, but it is a process change dressed as
  automation, and this phase does not depend on it.
