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
