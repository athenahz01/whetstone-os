# The first real run, and what it exposed

**Poll run #5: Success. Eight real Wyzant leads landed at 14:17 today.** The session, the extraction, the HTTPS ingest and the heartbeat all work. That is the first time anything real has been through this system.

It also exposed something that makes almost everything built since Phase 1 inert.

---

## Vercel is running Phase 1 code

I POSTed an empty batch to the live ingest endpoint. It returned:

```json
{"ok":true,"polled":0,"inserted":0,"deduped":0}
```

The code in the repository returns `{ok, qualificationRunId, runId, status, ...}`. **No `runId`. No `qualificationRunId`.** That response shape is the Phase 1 endpoint, which saved leads directly with no workflow engine behind it.

The database agrees. Eight leads inserted at 14:17:24 through 14:17:32, and:

```
runs: 0          run_steps: 0     measurements: 0
exceptions: 0    research_briefs: 0   outreach_drafts: 0
```

`runProspecting` writes a `runs` row before it does anything else. Eight leads with zero runs is only possible if the deployed endpoint never called it.

### What that means, concretely

- **The ICP screen never ran.** Of the eight leads, three are `Study Skills`, `Writing` and `Reading`. `F-005` says Cole is approved for exactly four subjects and none of those three are among them. They are sitting in `leads` with status `new` because nothing screened them.
- **No KPI data exists.** Measurements is empty, so KPI #2 (time saved) and KPI #4 (reliability) have no denominator. Runs that were never recorded cannot be counted.
- **Exceptions cannot reach the database.** Everything built this morning to make inventory loss loud - the reconciliation mismatch, the rejected-subject labels - writes to `exceptions`, and the deployed app has no path to it.
- **Phases 2 through 5 are not running.** The engine, the approval gate, the research brief, the drafting and the voice lint are all in the repository and none of them are in production.

The migrations are current, because you ran those from your laptop against the database directly. The **application** was never redeployed.

## The poll ran once and stopped

```
last_run_at:      14:17:23
stale_alerted_at: 15:05:48
```

One run, then nothing, then the staleness alert fired 45 minutes later. **You should have an email about it.** That is the alerting working exactly as designed, on its first real opportunity.

The likely cause is Actions quota. What you pushed is `d2c1ba9`, which still has `cron: "*/15"`. The cadence fix is in `b9324d5`, which is not pushed. So the live schedule is the 5,700-minutes-a-month one.

## The in-person URL is not an error page

```
highered.wyzant.com/tutor/jobs?utf8=✓&subject_id=-1&lesson_type=in_person
  &location=My+Travel+Radius&zip_code=10036&distance=1&sort_by=1
```

`distance=1`. A **one-mile radius** around zip 10036, which is Times Square. That is why the in-person view returned zero, and it is not a broken route - it is a very narrow filter that has to be built into the URL.

`ICP.md` says Manhattan and New York, NY. One mile is far narrower than that, so somebody has to decide the radius. That is a config decision, not a code fix.

Also worth knowing: `subject_id=-1` means all subjects, and the location filter is a Wyzant account setting rather than a URL default, so the in-person URL cannot be derived from the online one by swapping `lesson_type`. It has to be configured.

## One more, smaller

`tutors` and `profiles` are both empty. Drafting reads a profile for the rate and the bio, so even once the current code is deployed, S3 has nothing to draft from until a tutor row and profile exist.

---

## What to do, in order

**1. Push.** Two commits are sitting local: `b9324d5` and `2465777` and `9aa780b`.

```powershell
cd C:\AA_Whetstone\whetstone-os
git push
```

**2. Redeploy Vercel from the new HEAD.** If the project is linked to the repo it deploys on push; check the Deployments tab and confirm the newest one is `9aa780b` and succeeded. If it is not linked, deploy manually.

**3. Verify the deployment is actually current** by re-running my test:

```powershell
$s = (Select-String -Path .env -Pattern '^INGEST_SECRET=').Line -replace '^INGEST_SECRET=',''
curl.exe -s -X POST https://whetstone-os.vercel.app/api/ingest -H "content-type: application/json" -H "x-ingest-secret: $($s.Trim('\"'))" -d '{\"leads\":[]}'
```

A current deployment returns a `runId`. The old one does not. This is the check to repeat after every deploy.

**4. Then run the poll again** and send me the log. With the current code deployed, the eight leads already in the table will be re-screened on the next ingest and the out-of-scope ones should be caught.

**5. Two decisions for Cole**, unchanged: the three subject labels, and the in-person travel radius.

---

## The honest read

The gate on Phase 6 was "one real lead through the system." Eight leads landed today and **none of them went through the system** - they went into a table. The plumbing is real and that is genuine progress. But Phases 2 through 5 have never executed against anything, and until step 2 above is done, they still have not.

This is also the fourth time in a day that something reported success while doing much less than it appeared to. A green workflow run, eight rows in a table, and a health endpoint saying `ok` - all true, and all compatible with the actual system being four phases behind.
