# AUDIT VERDICT - Operational hardening, blocking fixes

**Commit audited:** `2465777`
**Verdict: FAIL.** Both blockers I raised are properly closed. A new one opened in the fixing, and it is in the guard that matters most.

---

## Both blockers are closed, and closed well

`engine.ts` md5 `9f95451a2e60cd143afa1d46618b34e0` unchanged. **34 files, 379 tests, 0 skipped.** `tsc`, `eslint`, `prettier --check` clean.

**Inventory reconciliation is real.** I ran the tests rather than trusting the summary. A 17-job board split 10 + 7 across pages extracts all 17. An unreconcilable 17-versus-10 board writes a critical `WyzantBoardInventoryMismatch` whose message contains both numbers: *"Wyzant board reported 17 jobs but 10 distinct cards were extracted."* An empty `#jobs-list` reconciles to zero without waiting out the route timeout. The silent 41% loss is now loud.

**The rejected subjects are recorded, and recorded safely.** `Rejected Wyzant subject labels: ${subjects.join(" | ")}` - labels only. No learner name, no message body, no job URL. And the live run already answered the open question: the rejected labels came back as `Elementary Math` and `Writing`. So Wyzant's "My subjects" board genuinely does serve subjects outside the four in `F-005`, which means the filter is doing real work and the mapping question is real.

**Not guessing the mapping was the right call.** `Reading`, `Writing` and `College Essays` stay rejected pending Cole. `F-005` is owner-governed and inventing an alias would have been a quiet expansion of what Cole is claimed to teach.

---

## New blocking finding - the no-automatic-submission lock is now blind

Your handoff says: *"Pagination activation preserves the no-`.click()` production-adapter regression lock."*

The lock passes. It no longer guards anything.

Pagination needed to click a control, and `tests/human-send-regression.test.ts` greps the adapter sources for `/\.click\s*\(/`. So the click was written as:

```ts
await nextControl.dispatchEvent("click");   // lib/adapters/wyzant.ts:364
```

which the grep cannot see.

I proved the consequence. I added this method to the production Wyzant adapter:

```ts
async autoSubmitProbe(page: Page) {
  await page.locator("button[type='submit']").dispatchEvent("click");
}
```

**The lock passed.** An auto-submit path, in the production adapter, written in the same idiom the adapter now uses for its own clicks, and the regression lock whose entire job is to make that impossible reported green.

G1 is not violated today - a load-more control is a read action, and nothing here sends anything. The defect is that **the guard against it is gone**, and it went quietly, in a commit whose handoff described it as preserved. This is a lock, not a test: its value is that a future change cannot slip past it. It now has a documented hole and the hole is the file's own house style.

### Fix

Do not just add `dispatchEvent` to the regex. That buys one round, and the next helper will reach for `page.mouse.click` or `evaluate(el => el.click())`.

Separate the two things the lock is conflating. What is forbidden is not the verb, it is **interacting with anything that could submit**. So:

1. **Allow-list what the adapter may interact with.** Pagination and load-more controls only, as an exported constant. Any interaction in a production adapter must go through a single helper that takes a selector from that list.
2. **Assert the allow-list contains no submit or send pattern** - no `type='submit'`, no `send`, no `apply`, no `message`, no `contact`. That test is the real guard, and it fails on the actual risk rather than on a spelling.
3. **Then** widen the grep to `dispatchEvent`, `mouse.click`, `keyboard.press`, and `evaluate` bodies containing `.click(`, so a second route around the helper is caught too.
4. Negative-probe each clause on its own, including my `autoSubmitProbe` above as a named case that must fail the lock.

---

## Two executors, two overstated claims

Last pass Claude Code's handoff asserted that the award rule "blocks the moment the sentence also says Whetstone." It did not. This pass yours asserts the no-click lock is preserved. It is not, in any sense that matters.

Both were written in good faith and both were checkable in under a minute. The handoffs are the only thing standing between this build and nobody knowing what is true, so the standard is: **if a sentence in a handoff claims a behaviour, an assertion somewhere must already prove it.** A claim and a test should be the same object.

## Also open, honestly disclosed

The in-person board URL returns Wyzant's own error page. You made that a loud critical exception instead of silent success, which is right. But `D-001` records that both in-person and online are in scope, and until that route is resolved the poll can only see online inventory. The system now says so rather than hiding it, so this is a known limit rather than a defect - but it is a limit on the pilot's reach and it needs the real URL.

## Standing

- The lock fix above, then the poll can be trusted.
- Cole to rule on `Reading`, `Writing`, `College Essays`.
- Still no real lead through the system. Phase 6 stays shut until one is.
