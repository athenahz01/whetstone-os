# Ideal Customer Profile

- Status: approved Phase 0 operating definition
- Captured: 2026-08-26
- Owner for later changes: Cole

Source: Growth Engine v1 Wyzant configuration, the supplied build brief, and
the v1 qualification rules

This file defines who may enter the sales workflows. Passing this definition
does not authorize external contact. Every external draft remains YELLOW and
human-controlled.

## Allowed source populations

A prospect must come from exactly one of these populations:

1. An inbound inquiry on Cole's own Wyzant tutor account.
2. A dormant tutoring contact with recorded consent provenance. The record must
   include when, where, and for what kind of follow-up consent was given.
3. A professional referral partner, such as a counselor, educator, school,
   program leader, or other adult acting in a professional capacity.

Cold outbound to a parent or guardian of a minor is never allowed. Reddit,
Facebook, and Nextdoor are not sources. Scraper accounts, purchased lists,
sock-puppet accounts, impersonation, and contact details inferred from a minor's
identity are not sources.

## Wyzant fit

Cole's approved Wyzant subjects are:

- SAT
- ACT
- College admissions
- College counseling
- College essay
- Essay writing

The v1 geographic pilot is Manhattan / New York, NY. Online or remote jobs are
excluded by default and require an explicit operator decision to enter the
pilot. Geography is a routing rule, not a claim that other locations are poor
fits.

A Wyzant inquiry passes the ICP screen when all of the following are true:

- It is visible through Cole's operator-owned account.
- The subject matches one of the approved subjects above.
- The inquiry asks for tutoring, test preparation, counseling, or essay help
  that Whetstone actually offers.
- The message has enough specific context for a useful response without
  inventing facts.
- The prospect is not marked `out_of_scope`.
- Responding keeps the inquiry, lesson, payment, and tracking on Wyzant.

## Dormant-contact fit

A dormant contact passes only when:

- consent provenance is present and reviewable;
- the proposed follow-up is within the scope of that consent;
- the contact is not suppressed, unsubscribed, or marked do-not-contact;
- the contact is not a parent of a minor reached through cold outbound; and
- the proposed help maps to an approved Wyzant subject or another service
  explicitly verified in `FACTS.md`.

Missing consent provenance is a hard fail, not a research task.

## Referral-partner fit

A referral partner passes when the person is an adult acting professionally,
has a plausible reason to refer students or families, and can be contacted
without using a minor's private data. A partner conversation must not include
unverified student results, confidential family information, or blocked facts.

## Qualification result

The only valid classifications are:

- `icp_pass`: all source and fit requirements are satisfied.
- `icp_fail`: a requirement is false.
- `out_of_scope`: the request concerns a service, geography, audience, or
  channel the system does not handle.
- `needs_human_review`: evidence is incomplete but no hard exclusion is known.

`needs_human_review` is not an ICP pass. `out_of_scope` never counts toward the
qualified-prospect KPI.

## Quality gate for KPI #5

An `icp_pass` is only ready for human approval after the system has:

- normalized and deduplicated the source record;
- preserved the native source URL and stable native identifier;
- attached the evidence for every qualification decision;
- completed any workflow-required research;
- passed deterministic voice and safety checks; and
- produced the approval artifact inline.

Qualified-but-unprepared prospects are a leading indicator only. They do not
count toward KPI #5.

## Permanent exclusions

- No auto-send or auto-submit.
- No cold outbound to parents of minors.
- No activity that moves a Wyzant lesson, fee, or tracking off-platform.
- No comparative ranking of students.
- No money, contracts, pricing changes, commitments, or current-client-family
  actions.
- No content-strategy decisions by an agent.
