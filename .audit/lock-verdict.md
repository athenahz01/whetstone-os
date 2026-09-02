# AUDIT VERDICT - The no-automatic-submission lock

**Commit audited:** `9aa780b` (parent `2465777`)
**Verdict: PASS.** The operational hardening pass is closed. Twelve probes, all caught, including two you did not write.

---

## Reproduced

`engine.ts` md5 `9f95451a2e60cd143afa1d46618b34e0` unchanged. **34 files, 384 tests, 0 skipped.** `tsc`, `eslint`, `prettier --check`, `docs:lint` clean. Pagination unaffected: the sixteen operational-hardening tests pass, including the 10 + 7 split extracting all 17.

## The probes

I re-ran my original probe verbatim, then six routes around it, then attacked the allow-list, then invented two of my own:

```
caught   dispatchEvent on submit (my original probe)
caught   .click()
caught   page.mouse.click
caught   keyboard.press
caught   click smuggled inside evaluate
caught   requestSubmit
caught   fill a form
caught   submit control added to the allow-list
caught   'Send next message' added to the allow-list
caught   allow-list emptied
caught   a BRAND NEW adapter file with a submit click     <- not on your list
caught   a second, unrestricted interaction in interaction.ts  <- not on your list
```

Those last two mattered most to me. A guard that only covers the files it was written against gets walked around by adding a file, and a guard that blesses one helper gets walked around by adding a second function to that helper. Both are closed.

The design is right for the reason you stated: `activateAllowedControl` resolves the locator itself from an allow-list entry, so **the shape of my probe is not expressible against that signature.** Not "would fail the test" - cannot be written. That is a stronger property than a wider regex, and it is what makes this a lock rather than a test.

Asserting that every allow-list entry must match `next|more|pagination` and none may match `submit|send|apply|message|contact` puts the check on the risk rather than the spelling. And naming `a[rel='next']` explicitly so the list cannot be emptied into silence is the `_prisma_migrations` lesson applied correctly, unprompted.

## The `email.ts` decision was the right one

Widening the scan pulled `email.ts` into scope, where `client.fetch(...)` is ImapFlow reading a mailbox. You excluded the method call rather than the file, and then asserted that `email.ts` uses `client.fetch` and opens `readOnly: true`. I checked: `expect(email).toMatch(/readOnly:\s*true/)` at line 218.

**An exclusion that is checked is worth more than one that is assumed.** Excluding the file would have created a hole shaped exactly like the one we just closed.

## On the overstated claim

You converted two of your own handoff sentences into assertions and cited them:

```ts
expect(code.indexOf("ForbiddenAdapterInteractionError"))
  .toBeLessThan(code.indexOf("page.locator"))
```

That is the standard, met. A claim and a test as the same object. Nothing more to say about it.

---

## What is left, and none of it is code

1. **Push and run the poll.** Everything blocking it is fixed. It has still never completed a run.
2. **The in-person board URL.** Still unresolved, still a loud exception rather than silent success. `D-001` puts both lesson types in scope, so until the real URL exists the pilot sees online inventory only. That needs a URL, not a commit.
3. **Cole rules on `Reading`, `Writing`, `College Essays`.** The rejected-subject exception surfaces them; nothing guesses.
4. **Phase 6 stays shut until one real lead goes through.** That gate has now survived four passes of things that would have made a real run lie about itself: a 41% silent inventory loss, a filter discarding most of its input unrecorded, a guard that reported green while guarding nothing. Every one of those would have looked like success on the first live run.

Phases 0 through 5 audited and closed. Operational hardening closed.
