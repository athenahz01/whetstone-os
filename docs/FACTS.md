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
| F-005 | Cole may use only the Wyzant subjects listed in `ICP.md` for the Wyzant pilot.                                                                              | VERIFIED | 2026-08-26 | Archived v1 adapter configuration at commit `89bcb58`                                    |

## Blocked conflicts

| ID    | Conflict                                                                                                                                                                                                                                                | Evidence                                                                                                            | Status  | Required resolution                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| C-001 | Wright tuition appears as $5,500 on the current public site and in the current `wright` project, while the alternate `wright-fellows` application displays $4,500.                                                                                      | `https://wrightfellowship.org/`; `C:\AA_Whetstone\wright\index.html`; `C:\AA_Whetstone\wright-fellows\app\page.tsx` | BLOCKED | Cole names the canonical price and the non-canonical surface is corrected or retired.       |
| C-002 | Scholarship value appears as "up to $35,000 each" on the current public page and rules, while the local public-site checkout contains the older "$26,000 each" version.                                                                                 | Live scholarship page and rules; `C:\AA_Whetstone\whetstone-website\scholarship2026\index.html`; local terms page   | BLOCKED | Cole confirms the award valuation and every surface is reconciled.                          |
| C-003 | Scholarship dates conflict. The current live page says priority deadline August 31, final deadline September 15, and decisions by September 30, 2026. The local public-site checkout says rolling decisions and a final deadline of September 30, 2026. | Live scholarship page and rules; local scholarship page metadata                                                    | BLOCKED | Cole confirms the canonical schedule and every surface is reconciled.                       |
| C-004 | Scholarship structure conflicts. The current live page promises two full awards and says partial awards may be offered; the older local page describes two full awards without the same current partial-award structure.                                | Live scholarship page and both local scholarship files                                                              | BLOCKED | Cole confirms the exact number, value, and status of full and partial awards.               |
| C-005 | The live scholarship rules label themselves draft, not launched, and not reviewed by counsel, while the live campaign page relies on those terms.                                                                                                       | `https://www.whetstoneadmissions.com/scholarship2026/terms/` fetched 2026-08-26                                     | BLOCKED | Counsel review and owner sign-off, or removal of any claim that depends on the draft terms. |
| C-006 | Wright application dates are not yet announced on the current public site.                                                                                                                                                                              | `https://wrightfellowship.org/`                                                                                     | BLOCKED | A human supplies and verifies dates before any copy states or implies them.                 |

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
