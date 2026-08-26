# Automation Map

- Audience: humans only
- Captured: 2026-08-26

Do not load this file into agent prompts.

This map classifies recurring work. It is a map of intended responsibilities,
not evidence an agent may use to qualify, draft, approve, or send.

## Fixed roster: six workflow agents

| Registry ID | Name                          | Work                                                                                     | Birth level                                   | Human boundary                                                               |
| ----------- | ----------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| S1          | Prospecting and qualification | Normalize inbound sources, deduplicate, score, and classify ICP fit                      | GREEN                                         | No external action; uncertain fit becomes human review                       |
| S2          | Research briefs               | Gather cited evidence for a qualified prospect                                           | YELLOW                                        | Every brief writes an approval row before it can support an external surface |
| S3          | Outreach preparation          | Draft the first response and run deterministic voice lint                                | YELLOW                                        | Human approves, pastes, and sends                                            |
| S4          | Follow-up and pipeline        | Detect stalls and replies, draft follow-up, maintain sales state, prompt outcome logging | Mixed: detection GREEN, external draft YELLOW | No auto-send; money, commitments, and current clients remain absent          |
| M1          | Marketing production          | Produce review-ready assets from a human-approved topic and strategy                     | YELLOW                                        | Cole owns what to publish and why; every asset is approved before queueing   |
| B1          | Weekly brief                  | Query operating evidence, surface bad news, and prepare the next-cycle review            | GREEN                                         | No publishing or external action                                             |

The Sales Manager is the `/today` interface over this roster, not a seventh
agent. Content strategy is a human responsibility, not an agent.

## Fixed roster: four automations

| Automation ID | Trigger and host                              | Recurring work                                                                          | Classification         | Failure behavior                                                                           |
| ------------- | --------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| A1            | Jittered GitHub Actions + Playwright Chromium | Poll Cole's operator-owned Wyzant surfaces and POST normalized records to `/api/ingest` | Automate, GREEN ingest | Session expiry becomes `SESSION_STALE`; no login automation and no effect on other polls   |
| A2            | Jittered Vercel Cron                          | Read Cole's own IMAP inbox in read-only mode and ingest matching inbound inquiries      | Automate, GREEN ingest | Missing credentials warn once; no crash loop and no mailbox mutation                       |
| A3            | Vercel Cron                                   | Run the daily workflow tick and refresh `/today` decisions                              | Automate/augment       | Each workflow writes a run row; one failure is isolated; kill switch and pause are honored |
| A4            | Weekly Vercel Cron                            | Run B1 and materialize the weekly brief plus query-rendered KPI summary                 | Automate, GREEN brief  | Missing sources are labeled; bad news is surfaced; no hand-typed KPI line                  |

## Cole's four questions, per row

Every proposed agent or automation must answer four questions before it earns a
place. The rosters above answer question 1. This section answers all four.

Value is stated in reclaimed baseline minutes per occurrence, taken from the
`H-0x` rows in `BASELINES.md`. It is deliberately not stated in dollars: the
hourly rate is itself disputed and the figure would be fiction. Convert to
dollars only once Cole sets a canonical rate.

Occurrence counts are the honest weak point. v1 recorded no volume, so a
per-cycle count would be invented. What is knowable now is the trigger cadence,
and Phase 2's `runs` table makes the count real from the first measurement
window. Rows marked `TO MEASURE` are commitments, not estimates.

| ID | 1. Human work replaced | 2. How often | 3. Value per occurrence | 4. How we know it beat the status quo |
| -- | ---------------------- | ------------ | ----------------------- | ------------------------------------- |
| S1 | `H-02` check sources and decide whether an item qualifies | Once per ingested item. Volume `TO MEASURE` from `runs` in the first window. | 5 min | Every prospect carries an ICP verdict, a rationale and evidence, and a human spot-check of a sample agrees with the verdict. |
| S2 | `H-03` research one qualified prospect enough to draft responsibly | Once per `icp_pass`. Volume `TO MEASURE`. | 15 min | Briefs cite a source for every claim, declare unknowns, and the acceptance rate on brief approval rows holds at or above 80 percent. |
| S3 | `H-04` draft one personalized first response | Once per prospect reaching outreach. Volume `TO MEASURE`. | 10 min | Minor-edit rate at or above 80 percent under the frozen `BASELINES.md` formula, with zero voice-lint escapes in the sampled drafts. |
| S4 | `H-06` review a reply, prepare a follow-up, and update pipeline state | Once per reply, plus a stall sweep each tick. Volume `TO MEASURE`. | 7 min | No prospect sits without a next action or a recorded reason. Reply-classification accuracy is reported on a labeled set rather than assumed. |
| M1 | `H-07` produce one review-ready marketing asset from an approved topic | Once per approved topic, plus four channel assets per approved issue. | 35 min | Approved assets per cycle rises while human minutes per approved asset falls, both measured, and no asset ships with an unsourced factual claim. |
| B1 | `H-08` assemble the weekly intelligence brief, and `H-09` the KPI one-liner | Once per week, by schedule. | 55 min | The brief and the one-liner render from queries with zero human assembly minutes, and a seeded failure appears in the output rather than being smoothed over. |
| A1 | `H-02` manual source checking on Wyzant | Every poll interval, jittered. | Feeds S1 | Records arrive with the laptop shut, and an expired session raises `SESSION_STALE` rather than returning a silent zero. |
| A2 | `H-02` manual inbox checking | Every cron interval, jittered. | Feeds S1 | Matching inbound inquiries are ingested read-only, with no mailbox mutation and no crash loop on missing credentials. |
| A3 | `H-01` start or recover local processes, and `H-10` diagnose a failed run | Every tick, by schedule. | 6 min and 15 min respectively | The runtime needs no terminal, one workflow failure isolates from the rest, and the kill switch and pause are honored. |
| A4 | `H-08` and `H-09` assembly and formatting | Once per week, by schedule. | Feeds B1 | The weekly artifact exists without anyone assembling it, and the KPI line is never hand-typed. |

Two rows deliberately claim no time saving. A1 and A2 exist to make the system
reachable at all rather than to shorten a task, and A4 materializes B1's output.
Counting their value twice would inflate KPI #2.

## Work that remains human

- Approve, edit, skip, paste, and send every external message.
- Choose marketing strategy, topics, channels, and publication timing.
- Set or change pricing, awards, deadlines, contracts, commitments, or client
  terms.
- Communicate with current client families.
- Resolve disputed facts and consent questions.
- Decide whether an external outcome occurred when evidence is not already in
  the system.

## Work the system never performs

- Auto-send or auto-submit.
- Cold outbound to parents of minors.
- Scraping through alternate accounts or impersonation.
- Wyzant fee, lesson, or tracking workarounds.
- Comparative student rankings or leaderboards.
- RED work: money, contracts, pricing, commitments, or current-client-family
  external actions.
