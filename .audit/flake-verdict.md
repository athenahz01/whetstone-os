# Audit verdict - the Wyzant test flake

**Verdict: PASS.** The fix is correct, the three tests were not weakened, and I confirmed that independently rather than reading the argument. **773/773, six consecutive full-suite runs green in my container**, on top of the executor's twelve on the machine where it was failing. `engine.ts` unchanged.

---

## The insight was the right one, and the previous two passes were wrong

Two passes left those three tests alone - the executor's, and mine - because the adapter calls `browser.close()` on what it is handed, so a shared browser would be closed mid-file by the code under test. That was true.

What neither of us questioned was **what `close` needs to close**. The contract the adapter needs is "release the session you gave me", not "end the process". `sharedSession()` hands out contexts and closes those; the browser underneath survives. A context is what actually holds the routes and pages each test sets up, so it is the meaningful cleanup, and the adapter's own code is unchanged.

**Seven launches to one.** I confirmed: one `chromium.launch`, in `beforeAll`.

## The tests still bite

The claim to check was not "do they pass" but "do they still catch anything". I broke the adapter three times:

| mutation | caught |
|---|---|
| stop raising the inventory mismatch | yes, 1 test |
| stop reporting rejected subject labels | yes, 2 tests |
| remove the redirect retry | yes, 2 tests |

The executor said it verified by reading each test before changing it rather than by running them afterwards. Reading was the right first step; this is the second one, and the tests hold.

I also confirmed the safety argument directly: the only `close()` calls in the file are `page.close()`, `context.close()` and the `afterAll` browser close. No test asserts the browser was torn down. The one test that does assert `close` was called uses pure fakes and never launches anything.

## Timing, mine

```
file, isolated   8.6s / 10.0s      (was 9.0-9.8s)
full suite       773/773, six for six
```

Less improvement than the executor measured, which is expected - my container has headroom, and the launches were never the binding cost here.

## One thing worth knowing about the new shape

My very first run of the file returned **`Tests 16 skipped (16)`** rather than passed - a cold-start where the shared launch in `beforeAll` did not come up. It did not reproduce in the next six runs.

I checked whether that is dangerous, because a shared `beforeAll` can turn one launch failure into sixteen silent skips. **It is not: the run exits 1 and reports `Test Files 1 failed`.** In a full suite it reads `757 passed | 16 skipped` with a failed file and a non-zero exit. The gate holds.

But the count line no longer says "failed" in the Tests row when this happens. **This project reports "N tests / 0 skipped" in every handoff, and that "0 skipped" is now load-bearing rather than decoration** - a non-zero skip count means the browser file did not run at all. Worth reading, not just printing.

## What is still not measured, and why I am not asking for it again

The sub-1 GB threshold measurement has not been taken. The executor tried a bounded 900 MB allocation, saw free memory barely move, and stopped rather than escalate pressure on a machine someone was working on. That was the right call and I am not going to ask a third time.

The evidence that exists is better suited to the question anyway: **the same machine, the same session, the same condition that failed 2 to 4 tests on every one of four runs now passes twelve consecutively at 1.16 to 1.9 GB free.** A threshold test would tell us where it breaks; this tells us it stopped breaking where it was breaking.

`pnpm verify` is a gate again. That was the thing worth fixing.

## Remaining

The rate number still needs a week of real alerts read for it, per `docs/WYZANT-ALERT-RULE.md`. And no email has been sent - `ALERT_EMAIL_TO` and the SMTP credentials are still provisioning only Athena can do.
