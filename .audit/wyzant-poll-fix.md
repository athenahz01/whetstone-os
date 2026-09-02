# Getting the Wyzant poll actually running

The poll is built and wired. It has never had credentials, so every run has failed at startup. Three things to fix.

---

## A. Two secrets you already have (5 minutes, yours)

`ops/wyzant-poll.ts` throws on line 8 if `INGEST_URL` or `INGEST_SECRET` is missing, before any browser opens. Both values are already in your local `.env`.

1. In PowerShell:
   ```powershell
   cd C:\AA_Whetstone\whetstone-os
   Select-String -Path .env -Pattern '^(INGEST_URL|INGEST_SECRET)='
   ```
2. Go to `github.com/athenahz01/whetstone-os` → **Settings** → **Secrets and variables** → **Actions**.
3. **New repository secret**, name `INGEST_URL`, paste the value. Save.
4. Same again for `INGEST_SECRET`.
5. Switch to the **Variables** tab. **New repository variable**, name `WYZANT_FEED_URL`, value `https://www.wyzant.com/tutor/jobs`.

`INGEST_SECRET` must be byte-identical to the one in Vercel or ingest returns 401.

---

## B. The Wyzant session (needs a script that does not exist yet)

`WYZANT_STORAGE_STATE_JSON` is the signed-in browser session. There is tooling to *use* it and to *read the board with it*, but nothing that *creates* it - last time it came from a manual browser export, and the raw export carried Facebook, LinkedIn and DoubleClick cookies that would have gone straight into a GitHub secret.

That should not be a manual step, because the session expires and this will need doing again.

Give this to Claude Code:

```
Add ops/wyzant-login.ts, a local-only helper that produces the Wyzant session
secret safely.

It opens a headed Chromium, navigates to the Wyzant sign-in page, and waits for
the operator to sign in by hand. Detect success by the tutor jobs feed URL, not
by a timer. Then save storage state, and before writing anything:

- keep only cookies whose domain is wyzant.com or a subdomain, and drop every
  origin entry that is not wyzant.com. The raw export carries Facebook, LinkedIn
  and DoubleClick cookies and those must never reach a repository secret.
- write the filtered JSON to playwright/.auth/, which is gitignored, and print
  the path, the cookie count, and the earliest cookie expiry so the operator
  knows when this has to be redone.
- print no cookie values and no session token.

Add a test over the filter with a fixture containing third-party cookies,
asserting they are removed and the wyzant.com ones survive. Never call
production ingest. Do not touch lib/core/engine.ts; report its md5. Stop and
print the AUDIT HANDOFF block.
```

Then run `pnpm wyzant:login`, sign in as Whetstone's own Wyzant account, and paste the file's contents into a new `WYZANT_STORAGE_STATE_JSON` repository secret.

---

## C. Cadence and runtime, or it runs out of minutes again

The schedule is `*/15`, which is 96 runs a day. Each run takes about 1m11s, and GitHub bills whole minutes per job, so that is 2 minutes each: roughly **5,700 minutes a month against a 2,000 budget**. This alone exhausts the account, and it is shared with your other repositories.

Two changes, both for Claude Code:

```
Two changes to .github/workflows/wyzant-poll.yml. It currently costs about
5,700 GitHub Actions minutes a month against a 2,000 free budget shared across
the whole account.

1. Cut the run under 60 seconds so each job bills one minute instead of two.
   Most of the current time is `playwright install --with-deps chromium`, which
   runs apt every time and is not cacheable. Run the job in the official
   Playwright container instead - image mcr.microsoft.com/playwright:v1.62.1
   matching the pinned playwright ^1.62.0 - so the browser and its OS
   dependencies are already present, and drop the install step. Keep the pnpm
   cache.

2. Change the schedule to every 30 minutes during waking hours only:
   `0,30 0-3,11-23 * * *`, which is 07:00 to 23:00 Eastern while EDT is in
   effect. Keep the jitter and keep workflow_dispatch. Note in a comment that
   this drifts an hour in winter and that the board shows jobs sitting for 5 to
   12 hours, so 30 minutes is far faster than the source changes.

That is 32 runs a day, about 960 minutes a month. Do not touch
lib/core/engine.ts; report its md5. Stop and print the AUDIT HANDOFF block.
```

---

## Order

1. Do **A** now. Five minutes, no code.
2. Hand **C** to Claude Code when Phase 5 lands - it is independent of the session secret and stops the bleeding.
3. Then **B**, and add the secret.
4. Trigger a run by hand: Actions → Wyzant poll → **Run workflow**. Do not wait for the schedule.
5. Send me the log. Expect it to fail again the first time on something real - that is the point of running it by hand.

## What "working" looks like

The final line is `[wyzant-poll:complete]` with `heartbeat: "recorded"`. Vercel's five-minute tick checks that heartbeat and emails you if 45 minutes pass without one, so once this is green you will hear about it breaking rather than discovering it later.

## Still true

The session cookies expire. Whatever the login script reports as the earliest expiry is when this needs redoing, and the heartbeat alert is what will tell you if you forget.
