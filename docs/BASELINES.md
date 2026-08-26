# Human Work Baselines and KPI Definitions

- Status: Phase 0 baseline frozen before production approvals
- Captured: 2026-08-26
- Baseline owner: Cole

## Measurement honesty

Production human minutes must be timed by the application from artifact-open to
decision completion, excluding time while the task is not active. Self-reported
minutes never enter the scorecard.

Phase 0 has no hosted timer and v1 did not record active human work duration.
The values below are therefore planning baselines derived from a documented
task walkthrough, not production measurements. They are frozen comparison
targets for the build. Phase 7 must report observed usability timing separately;
that walkthrough never becomes scorecard data.

## Manual-work planning baseline

| Task ID | Human task without Whetstone OS                                 | Baseline minutes per occurrence | Evidence basis                                                      |
| ------- | --------------------------------------------------------------- | ------------------------------: | ------------------------------------------------------------------- |
| H-01    | Start or recover the local v1 web and worker processes          |                               6 | v1 README commands, PM2 config, and resurrection script walkthrough |
| H-02    | Check sources and decide whether an item qualifies              |                               5 | v1 find-alert-review flow decomposition                             |
| H-03    | Research one qualified prospect enough to draft responsibly     |                              15 | manual source review and note assembly                              |
| H-04    | Draft one personalized first response                           |                              10 | v1 drafting and review flow walkthrough                             |
| H-05    | Review, approve, paste, send, and log one prepared response     |                               4 | v1 six-step review console walkthrough                              |
| H-06    | Review a reply, prepare a follow-up, and update pipeline state  |                               7 | v1 reply and outcome workflow walkthrough                           |
| H-07    | Produce one review-ready marketing asset from an approved topic |                              35 | manual research, drafting, fact check, and formatting walkthrough   |
| H-08    | Assemble the weekly intelligence brief                          |                              45 | manual multi-source summary walkthrough                             |
| H-09    | Assemble the Thursday KPI one-liner                             |                              10 | manual metric collection and formatting walkthrough                 |
| H-10    | Diagnose and recover one failed recurring run                   |                              15 | v1 terminal and log inspection walkthrough                          |

These numbers may be revised only through an explicit baseline-change record
that explains better pre-production evidence. They must not be tuned after real
approvals or run outcomes are visible.

## Minor-edit threshold for KPI #3

The threshold is committed now, before any real approval exists:

- Normalize CRLF to LF, trim leading and trailing whitespace, collapse runs of
  horizontal whitespace, and preserve words and punctuation.
- Compute character-level Levenshtein distance between the generated artifact
  and the final approved artifact.
- Divide by the greater normalized character length. Two empty artifacts have
  distance 0.
- `minor_edit = normalized_distance < 0.20 AND required_new_research = false`.
- Exactly `0.20` is not a minor edit.
- Formatting-only changes count under the same formula; there is no manual
  override.

### Why 0.20 and not 0.15

Recorded 2026-08-26, before any real approval exists.

The build plan proposed roughly 0.15 as a starting point. The frozen value is
0.20. The reason is that this formula counts character-level distance over the
whole artifact, including whitespace-normalized formatting, so a reviewer who
retitles a subject line and tightens one sentence in a 120-word Wyzant reply can
cross 0.15 without doing any rethinking. That is the behavior the KPI doc calls
a minor edit, and a threshold that flags it would understate acceptance.

0.20 is a judgement about this specific formula, not a loosening of the
standard. The second clause does the real work: `required_new_research` sends
any edit that sent the reviewer back to a source into the rewrite bucket
regardless of how small the diff was.

Auditor note: this value was set before any approval row existed. It must never
be revised upward after real acceptance data is visible, and any future change
creates a new versioned definition rather than editing this one.

This threshold is immutable after the first real approval unless a future audit
creates a new versioned KPI definition. Historical rows keep the definition
version they were measured under.

## KPI definitions fixed in Phase 0

1. KPI #1 counts unique workflow-registry IDs that had at least one attempted
   run in the measurement window. It does not count agents, files, or phases.
2. KPI #2 sums app-timed active human minutes. It never reads self-report.
3. KPI #3 covers every YELLOW artifact: drafts, research briefs, and marketing
   content. Acceptance and minor-edit rates use approval rows.
4. KPI #4 uses all attempted runs as the denominator, including step-one
   failures. A run counts in the numerator only when successful and
   `human_rescue = false`.
5. KPI #5 counts an `icp_pass` only after the quality gate is complete and the
   artifact is ready for human approval. `out_of_scope` and qualified-but-
   unprepared records never count.

Pipeline generated requires a written `outcomes` row. Marketing counts approved
assets, never raw generations.

## Named non-adoption acceptance tests

Each `AT-Ux` id names the `U` criterion it tests, so `AT-U3-*` tests `U3`. Two
ids were realigned on 2026-08-26 after `U7` was added: the inline-artifact test
is a facet of `U3`, not a criterion of its own, and the restore test is `U6`.
Keep the numbers matching when a criterion is added.

| Test ID                | Failure being prevented                                                               | Pass condition                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| AT-U1-LAPTOP-OFF       | The laptop had to stay on for polling and alerts.                                     | Shut the laptop down; a test lead is ingested by hosted infrastructure and an alert email reaches a phone.               |
| AT-U2A-ZERO-TERMINAL   | Startup and recovery required terminal commands and PM2.                              | The runtime remains available with no local process, terminal, startup command, or crash-recovery command.                 |
| AT-U3-FIVE-DECISIONS   | v1 opened into an unbounded operational console rather than a daily decision surface. | `/today` opens with at most five decisions and each artifact is inline with approve, edit, and skip.                       |
| AT-U4-390PX-LOOP       | v1 had no measured phone-complete daily loop.                                         | The full daily loop completes at a 390px viewport without horizontal overflow or a desktop-only action.                    |
| AT-U5-TWO-TAP-SEND-LOG | v1 required a long copy-paste-mark-log sequence across surfaces.                      | Approve to human send to logged takes no more than two app taps plus the one paste required by G1.                         |
| AT-U3-INLINE-ARTIFACT  | Source, draft, and decision context were split across pages and platforms.            | Each daily decision shows its source evidence and artifact together; no separate copying step is required before approval. |
| AT-U6-HOSTED-RESTORE   | State lived in local SQLite without a verified hosted restore.                        | State is in hosted Postgres and a backup is restored into a clean target with row-count and integrity checks.              |
| AT-U7-ANON-DENIED      | Prisma creates tables with no row-level security and Supabase grants the public anon key access to everything in `public`. A live probe found every table world-readable. | Every table in `public` returns no rows to the anon key over PostgREST, verified against the live deployment rather than a settings screen. |
