# Audit verdict - Wyzant alert rule

**Verdict: PASS WITH ONE FINDING.** The rule is built correctly and the finding is a guardrail hole, not a defect in the rule. Fixed here. **757 tests pass** excluding the known browser flake; typecheck, lint, format, docs:lint 6/6 clean; `engine.ts` unchanged at `9f95451a2e60cd143afa1d46618b34e0`.

---

## Finding - the kill switch stopped covering the alert

**Severity: medium. A safety control that no longer covers a path.**

The executor flagged the shape of this as deviation 2, framed as capacity: "the email is not gated by the governor's caps... worth a deliberate decision if the board ever floods." The sharper reading is not about floods.

`app/api/ingest/route.ts` runs `runWyzantAlerts` at line 57 and `runProspecting` at line 66. **The kill switch lives inside the governor, which only `runProspecting` consults.** So tripping the kill switch stopped qualification, ingestion and drafting, and left the alert emails sending.

`CLAUDE.md`'s Phase 11 acceptance says the kill switch stops all scheduled work. An operator trips it because something is wrong - a board flood, bad extraction, a compromised session - and the one path still running is the one that mails a human.

**This is separable from what the owner asked for.** She asked that the *score* stop gating the email. That is not the same as the *kill switch* stopping gating it, and the engine lock that forced the alert out of `engine.ts` does not require it to escape the governor too.

### The fix

`killSwitchEngaged` is an explicit input to `runWyzantAlerts`, read in the route from `PrismaFlagStore` and `KILL_SWITCH_KEY`. Under the switch every considered lead is **suppressed with the reason `kill_switch_engaged`** rather than skipped, so the run still balances and still says what it held back - and the reason is distinct from `rate_below_floor`, because telling someone their rate floor suppressed a job when the kill switch did would send them to the wrong setting.

The flag is passed in rather than read inside, so the function stays pure over its inputs, and it is explicit at the call site so no caller inherits "off" by forgetting. That is the trap the `ScanCoverage` finding named.

Seven assertions. Removing the gate fails four.

---

## A weak test of my own, caught by mutation

My first route test asserted the file *contained* `killSwitchEngaged` and that the read preceded the call. I then deleted the argument from the call - and **all 35 tests passed**, because the declaration still matched and the ordering still held.

That is a test asserting a name exists somewhere in a file rather than that the value reaches the function: the same class as the self-satisfying assertions I have flagged in three previous passes. It now slices the call expression and asserts the argument is inside it, and the mutation fails.

I am recording it because I have held this executor to that standard repeatedly and wrote the same defect on my first attempt.

---

## What held

**The rate extraction is right, and proven against real markup.** A test reads both cards out of `wyzant-board.real-capture.html` and asserts each parses as `none` - the case the whole rule exists for, tested against the board rather than a fixture someone wrote.

**`unreadable` is distinct from `none`.** Both send, and they are recorded separately, so a parser that quietly breaks does not disguise itself as a run of families with no stated budget. That distinction was in the brief and it would have been easy to collapse.

**The score is computed and does not gate**, asserted three ways including that the rule modules never read a score and `engine.ts` carries no Wyzant branch. KPI #5 keeps its source.

**G1 holds by shape**: `notifyWyzantJob` takes one argument, arity-asserted, and the envelope has exactly `from`, `to`, `subject`, `text` - no reply-to, cc or bcc through which a family's address could travel.

**The executor caught itself writing `balanced: outcomes.length === outcomes.length`** - a number equalling itself - and replaced it with four disjoint counts summed against the total. That is the `renderTraceabilityIssues` shape, self-caught, and it is the second time this executor has found that pattern in its own work.

**It also corrected its own previous handoff** on `docs:lint 7/7` being 6/6, unprompted, with the reason.

---

## Still open, and the order I would take them

**`pnpm verify` is red, and that is now the biggest operational problem.** 2 to 4 failures every run, all in the three browser tests that cannot share a launch. It has been degrading: I measured one failure in eight runs, the executor measured one in four, now it is every run. **A suite that fails every run is not a gate**, and the whole method of this project rests on that gate meaning something. This should be fixed before the next feature, not after.

**The rate number needs a week of real alerts read for it.** The board says "Recommended", and the only live lead this project has seen read `$55/hr recommended`. If that figure is Wyzant's suggestion rather than the family's budget, a $200 floor rejects nearly every job carrying a number. The rule is safe because a stated absence sends, and both real cards say `None` - but if numbered rates cluster far below $295 while `None` rates convert, retire the threshold rather than tuning it.

**No email has ever been sent.** The transport is exercised through a fake. `ALERT_EMAIL_TO=athena@whetstoneadmissions.com` and the SMTP credentials are provisioning only Athena can do, and this is the first feature whose entire value is that a message arrives.
