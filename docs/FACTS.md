# Verified Facts Register

- Status: applicant-facing facts gate is BLOCKED
- Register verified: 2026-08-26
- Owner required to resolve conflicts: Cole

## Non-negotiable use rule

A workflow may use a fact in external copy only when its row is `VERIFIED`, its
verification date is current enough for the claim, and no related row is
`BLOCKED`. `BLOCKED` means do not choose a version, paraphrase around the
conflict, or omit a qualifier. Ask a human.

No workflow may produce Wright, scholarship, applicant, or parent-facing copy
until every relevant conflict below is either resolved by the owner or remains
explicitly `BLOCKED` and the workflow avoids it entirely.

## Safe verified facts

| ID    | Fact                                                                                                                                                        | Status   | Verified   | Source                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ---------------------------------------------------------------------------------------- |
| F-001 | Whetstone offers college admissions counseling, college essay coaching, SAT / ACT preparation, extracurricular mentorship, and graduate admissions support. | VERIFIED | 2026-08-26 | Current first-party navigation at `https://www.whetstoneadmissions.com/scholarship2026/` |
| F-002 | The 2026 Whetstone Scholarship is described as merit-only, with no application fee or financial disclosure.                                                 | VERIFIED | 2026-08-26 | Current first-party scholarship page and rules                                           |
| F-003 | Wright Fellows is described as a remote six-week program for high-school students to build and launch software with real users.                             | VERIFIED | 2026-08-26 | `https://wrightfellowship.org/`                                                          |
| F-004 | The current Wright public page says no coding prerequisite is required and expects ten to twenty hours per week.                                            | VERIFIED | 2026-08-26 | `https://wrightfellowship.org/` FAQ                                                      |
| F-005 | Cole is approved on Wyzant for exactly four subjects: College Counseling, English, Essay Writing, SAT Reading. He is not approved for SAT Math or any ACT section. | VERIFIED | 2026-08-26 | Owner-stated, 2026-08-26. Supersedes the archived v1 adapter configuration at `89bcb58`, which predates these approvals and must not be used as the source. |
| F-006 | The Wright demo day award is $5,000 to the single winning team, to fund the project. | VERIFIED | 2026-08-26 | Live `https://wrightfellowship.org/` ("One team wins $5,000"); agrees with `wright/CLAUDE.md`, `wright/GTM.md`, `wright/FRAMING.md`, `wright/index.html` |
| F-007 | Cole's tutoring rate is $400 per hour in person and $295 per hour online. A first-time student is offered a free 30 minutes. | VERIFIED | 2026-08-27 | Owner-stated via Athena, 2026-08-27. Same basis as `F-005`. |

### Note on F-007 wording

`F-007` makes the rate and the free 30 minutes safe to state. The **word** is not
safe: `VOICE.md` bans "consultation" outright, including "free consultation",
because it is the category word every competitor uses and it prices the hour
down. Drafts must name the thing directly - "a free 30 minutes to look at one
real example" - rather than paraphrasing the ban. The fact is verified; the
phrasing is still governed by `VOICE.md`.

## Blocked conflicts

| ID    | Conflict                                                                                                                                                                                                                                                | Evidence                                                                                                            | Status  | Required resolution                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| C-001 | Wright tuition appears as $5,500 on the current public site and in the `wright` project, while `wright-fellows` displays $4,500. This is not one stray number: the entire award ladder in `wright-fellows` is denominated on $4,500 as its top rate (Founding Fellow $0 x1, Fellowship $2,250 x3, Merit $3,000 x6, Partial $3,825 x3, Full tuition $4,500 x2 = 15 seats). If $5,500 is canonical, every rung is wrong, not just the headline. | Live `https://wrightfellowship.org/` ("Tuition is $5,500."); `C:\AA_Whetstone\wright\index.html`; `C:\AA_Whetstone\wright-fellows\app\page.tsx` lines 604-616 | BLOCKED | Cole names the canonical top rate, then the full ladder is recomputed or retired as one change. Correcting only the headline would leave the ladder inconsistent. |
| C-002 | Scholarship value appears as "up to $35,000 each" on the current public page and rules, while the local public-site checkout contains the older "$26,000 each" version.                                                                                 | Live scholarship page and rules; `C:\AA_Whetstone\whetstone-website\scholarship2026\index.html`; local terms page   | BLOCKED | Cole confirms the award valuation and every surface is reconciled.                          |
| C-003 | Scholarship dates conflict. The current live page says priority deadline August 31, final deadline September 15, and decisions by September 30, 2026. The local public-site checkout says rolling decisions and a final deadline of September 30, 2026. | Live scholarship page and rules; local scholarship page metadata                                                    | BLOCKED | Cole confirms the canonical schedule and every surface is reconciled.                       |
| C-004 | Scholarship structure conflicts. The current live page promises two full awards and says partial awards may be offered; the older local page describes two full awards without the same current partial-award structure.                                | Live scholarship page and both local scholarship files                                                              | BLOCKED | Cole confirms the exact number, value, and status of full and partial awards.               |
| C-005 | The live scholarship rules label themselves draft, not launched, and not reviewed by counsel, while the live campaign page relies on those terms.                                                                                                       | `https://www.whetstoneadmissions.com/scholarship2026/terms/` fetched 2026-08-26                                     | BLOCKED | Counsel review and owner sign-off, or removal of any claim that depends on the draft terms. |
| C-006 | Wright application dates are not yet announced on the current public site.                                                                                                                                                                              | `https://wrightfellowship.org/`                                                                                     | BLOCKED | A human supplies and verifies dates before any copy states or implies them.                 |

## Conflicts checked and found no longer live

Recorded so the register shows these were examined rather than skipped. Re-check
if either surface is edited.

| ID    | Previously reported conflict | Finding on 2026-08-26 | Status |
| ----- | ---------------------------- | --------------------- | ------ |
| R-001 | Demo day prize reported as "$5,000 to one winning team" versus "$1,000 cash each to 10 Builder Competition winners plus full tuition". | The second version is not present on the live site or in any current local Wright file. Live page, `CLAUDE.md`, `GTM.md`, `FRAMING.md` and `index.html` all agree on $5,000 to one winning team. Recorded as `F-006`. | RESOLVED |
| R-002 | Award-carrying seats reported as "Nine of the fifteen" versus a table implying thirteen. | The "nine of the fifteen" wording is not present on the live site or in any current local Wright file. The ladder in `wright-fellows/app/page.tsx` lists fifteen seats, of which thirteen sit below the top rate. No live contradiction remains, though the rung values are governed by `C-001`. | RESOLVED |

## Owner decisions pending confirmation

A decision row is a working assumption the build runs on until the owner
confirms or reverses it. Unlike a `BLOCKED` row it does not stop work, because
reversing it is a configuration change rather than a retraction of something
already said to a family.

| ID    | Decision taken | Reasoning | Status | Reverses by |
| ----- | -------------- | --------- | ------ | ----------- |
| D-001 | The Wyzant pilot accepts both in-person Manhattan / New York, NY and online or remote jobs. Both are in scope by default. | The archived v1 configuration excluded online work, inherited from an in-person-only pilot. Online is the larger share of available volume, and the standing position is that distance changes the format of the meeting and never disqualifies a prospect. Excluding it by default would starve the pilot of volume for no stated reason. | PENDING OWNER CONFIRMATION | Cole says otherwise. Change this row and the Geography section of `ICP.md` together. |

## Credential facts requiring owner confirmation

Legacy material repeatedly says Cole graduated from and taught at Harvard and
Oxford. These statements are not included in the safe table because Phase 0 did
not receive a canonical credential record from the owner. Until Cole verifies
the exact wording, external drafts must omit the claim.

Status: BLOCKED.

## Update protocol

Every edit must include:

1. the exact claim;
2. `VERIFIED`, `BLOCKED`, or `RETIRED`;
3. an ISO verification date;
4. a first-party source or owner sign-off record; and
5. the person who approved the change.

Never silently replace a disputed value. Keep the conflict row and add the
resolution evidence so the history remains auditable.
