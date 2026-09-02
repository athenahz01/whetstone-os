# Turning the Wyzant poll on

Two things are missing. Only one of them is the hard one.

1. **Nothing plugs the Wyzant adapter into the scheduled job.** `createScheduledAdapters()` in `lib/adapters/index.ts` returns the email adapter and nothing else. `createWyzantAdapterFromEnv()` exists and works; it is simply never called. That is a ten-line change.
2. **The adapter drives a real Chromium browser**, and Vercel's serverless functions cannot run one. The cron job also has a 60-second ceiling. This is the part that needs a decision.

Plus one small thing: `WYZANT_STORAGE_STATE_JSON` is empty in your `.env`, so the login cookies have to be captured again wherever the poll ends up running.

---

## Step 0 - the check that might delete the whole problem

**Do this before choosing any infrastructure.**

The adapter loads the board with `waitUntil: "domcontentloaded"` and then reads plain CSS selectors - `div.academy-card`, `a.job-details-link`, `p.spc-zero-s.job-description`. It never waits for JavaScript to render anything.

If Wyzant sends the jobs in the initial HTML, a browser is unnecessary. An authenticated `fetch` plus an HTML parser gets the identical result, runs on Vercel inside the existing cron, needs no new service, and costs nothing.

Give this to Claude Code after the Phase 5 fix lands:

```
Settle one question before we build anything.

Capture a fresh Wyzant session, then fetch the tutor jobs feed with a plain
HTTP request carrying those cookies - no browser. Save the raw response body
and tell me whether div.academy-card and a.job-details-link are present in it.

If they are, the Wyzant poll needs no browser: propose replacing Playwright in
lib/adapters/wyzant.ts with fetch plus an HTML parser, keeping every existing
extraction test passing against tests/fixtures/wyzant-board.real-capture.html.

If they are not, say so plainly and stop. Do not start either path.
```

If the answer is yes, stop reading. Wire the adapter into `createScheduledAdapters()`, slow the cron to human cadence, and it runs where everything else already runs.

---

## If a browser really is needed

| Option | Cost | Setup | Notes |
|---|---|---|---|
| **Google Cloud Run Job + Cloud Scheduler** | Free at this cadence | ~40 min, needs a card on file | 240,000 vCPU-seconds and 450,000 GiB-seconds free per month. A 30-second poll every 15 minutes uses roughly 86,000 and 173,000. Comfortably inside. No time limit. |
| **GitHub Actions, slower cadence** | Free | ~15 min | 2,000 Linux minutes/month on Free for private repos. Billed per job, rounded up, so a 30-second poll costs a whole minute. Every 5 minutes is ~8,600 minutes/month, which is why you ran out. Every 20 minutes during waking hours is about 1,300. Resets monthly. |
| **Hosted browser (Browserbase) + existing Vercel cron** | $20/month | ~20 min, smallest code change | Connect over CDP instead of launching locally. The free tier is 1 browser-hour/month, which this cadence burns in two days. |
| Your laptop | Free | none | This is the thing you said you would not do. Not an option. |

**Recommended: Cloud Run.** It is free at this scale, it has no time limit, and the poll stops depending on a monthly minute budget you can exhaust. GitHub Actions is the quick fallback once your usage resets, and the cadence fix is required either way.

### Cloud Run, step by step

You can do 1 to 4 now. Steps 5 and 6 need Claude Code.

1. Go to console.cloud.google.com and sign in with your Google account.
2. Create a project. Name it `whetstone-os`. Note the project ID it generates.
3. Enable billing on it. A card is required even on the free tier. Set a budget alert at $5 so nothing can surprise you.
4. In the search bar, enable these three APIs, one at a time: **Cloud Run**, **Cloud Scheduler**, **Artifact Registry**.
5. Tell me when those four are done and I will write the container and workflow for Claude Code to build: a `Dockerfile` on the Playwright base image, a small entry script that polls Wyzant and POSTs the leads to `https://whetstone-os.vercel.app/api/ingest` with `INGEST_SECRET`, and the deploy commands.
6. The Wyzant cookies go into Google Secret Manager, not into the image and not into the repo. I will filter the capture to Wyzant-only cookies again the way we did before - the raw export carried Facebook, LinkedIn and DoubleClick cookies.

### Cadence, whichever path wins

Do not keep `*/5`. The board showed jobs sitting for 5 and 12 hours, so five-minute polling buys nothing and it is what blew the Actions budget. **Every 15 to 20 minutes, jittered, during waking hours** is well inside G3 and far faster than the board changes.

---

## What this is, honestly

This is unbuilt work, not a switch. I told you it was a switch and that was wrong. It is closest in spirit to Phase 11, but it is the only thing standing between everything built so far and a single real lead, so it is worth pulling forward once Phase 5 closes.

Sequence I would follow: finish Phase 5, run Step 0, then either wire it up in an afternoon or build the Cloud Run job.
