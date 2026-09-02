# Ruling needed: 26 meetings with a medium and no date

**Status: open. Nothing here is implemented.** The backfill in
`lib/crm/meeting-backfill.ts` converts the meetings that have a date and carries
the rest out as unconverted rows with the reason `no-date`. Choosing what
happens to them is a decision, so it is written up rather than coded.

Raised 2026-09-02 by the executor, after `.audit/retarget-verdict.md` flagged the
gap.

## The situation, in numbers

From `docs/REBUILT-DASHBOARD-SCHEMA.md`, UG Sales, 69 rows:

```
M1 Med / M1 Client / M1 Closer   34 rows each
M1 Date                           8 rows
M2 Date                           7
M3 Date                           4
```

The sheet records **34 first meetings** and knows the medium, who attended and
who closed for all 34. It holds a date for 8. So **26 rows carry evidence that a
conversation happened and no day to put it on.**

A touch with no date is not the same as no touch, and it is not the same as a
touch either. The silence clock needs a day to subtract from today. Every option
below is a different answer to "what does the clock do with a conversation whose
date nobody wrote down".

## Why this cannot be decided in code

The importer's standing rule is that nothing is auto-resolved. Where the two
sheets disagreed, 7.5a imported the cell as `disputed`, kept both values, and
barred it from driving an action until a human ruled. This is the same shape: a
plausible date is still a date the record does not hold, and writing one would
be the system asserting a fact nobody gave it.

The four head-to-head `Referrer Source` conflicts waited for Ren rather than
being resolved by a rule. These should get the same treatment or a deliberate
exception, and that is Athena's call.

## Option A - import nothing, leave them unconverted

What happens: the 26 stay out of `crm_touches`. Those leads read "no touch on
record, measured from the lead date" in the daily message.

- **Costs:** 26 of the 34 known conversations stay invisible. The first daily
  message is barely better than it would have been with no backfill at all.
- **Buys:** no fabricated date ever enters the record. The count of touches is
  exactly the count of conversations whose date is known.
- **Reversible:** completely. The rows are carried out with their reason, so any
  later rule can be applied without re-reading the sheet.

## Option B - date them at the lead date

What happens: a first meeting cannot have happened before the lead existed, so
the lead date is the earliest possible day. Each undated meeting is written as an
`asserted` touch on that day.

- **Costs:** the date is invented. It is a bound, not an observation, and the
  touch record would present it as an observation. It also does the least useful
  thing: dating a touch as early as possible maximises days quiet, so these leads
  sort to the top of the stall list on a date nobody chose.
- **Buys:** the lead has a meeting on record, so `meetingMilestones` returns
  something and the medium is preserved.
- **Watch for:** 44 of 69 rows have a lead date, so 25 have neither a meeting
  date nor a lead date and this option does nothing for them.

## Option C - a dated-unknown touch, and a clock outcome to match

What happens: the touch is recorded with the medium and the closer and no date.
The silence clock gains an outcome for a lead whose last contact is known to have
happened and not when, alongside `unmeasurable` and `unmonitorable`.

- **Costs:** the largest change. `crm_touches.occurred_at` is `NOT NULL` and
  every consumer reads it, so this is a migration plus changes in the clock, the
  digest and the milestone view.
- **Buys:** the most honest model. It says exactly what is true: a conversation
  happened, its date is not recorded. It also fits a pattern the system already
  has three examples of, where "cannot be measured" is a visible state rather
  than an absence.
- **Note:** the clock's existing rule is that a lead it cannot measure is
  visible and never healthy, so these 26 would surface for attention rather than
  disappear.

## Option D - ask Ren, through the surface that already exists

What happens: the undated meetings become a fifth reply on the daily message. A
few appear per day with the medium, the closer and the lead, and the reply is a
date or "do not know".

- **Costs:** 26 human decisions, spread over days. It is the slowest option and
  the only one that needs a person.
- **Buys:** real dates. It reuses the 7.5d machinery exactly as designed, where
  the reply is the CRM write and the record gets accurate through use rather
  than through maintenance. A dismissal is itself a signal: "do not know" is a
  fact worth storing.
- **Note:** the person who closed each meeting is recorded on 34 of 34 rows, so
  the question can go to the person most likely to remember.

## Recommendation, offered as one

**A now, D next, and never B.**

Option A is the state the code is already in, so choosing it costs nothing and
loses nothing that Option D cannot recover later. The unconverted rows carry
their medium, client, closer and reason, so the question can be asked at any
point without touching the sheet again.

Option B is the one to avoid. A bound presented as an observation is the defect
this project has found in some form in every phase: a number that reads as
evidence when it is an assumption. It would also put 26 leads at the top of the
stall list on the strength of a date nobody chose.

Option C is the most correct model and the most expensive, and it is worth
revisiting only if the undated meetings turn out to matter more than the 8 dated
ones do.

**This is a recommendation, not a decision, and nothing in the code assumes it.**

## What is already true either way

- The backfill converts the 8 dated first meetings, plus the dated M2 and M3
  meetings, into `asserted` touches attributed to their closer.
- Nothing invents a date today. The 26 leave as unconverted rows carrying their
  reason.
- `M1 Notes` and its siblings are never read. They are prose a human wrote about
  a student and `crm_touches` has nowhere to put prose.
- A backfilled meeting is keyed on its slot, so it can never overwrite a human
  answering "already spoke to them" on the same day.
