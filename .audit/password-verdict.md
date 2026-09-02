# AUDIT VERDICT - Password sign-in and the build-script lock

**Commit audited:** `fd338de` (parent `4fe312f`)
**Verdict: PASS.**

`engine.ts` md5 `9f95451a2e60cd143afa1d46618b34e0` unchanged. **36 files, 402 tests, 0 skipped.** `tsc`, `eslint`, `prettier --check`, `docs:lint` clean.

---

## The three things I said I would check

**One message, byte-identical.** I rendered it myself across every failure shape I could construct, including two you did not list - a whitespace-only email, and a provider error whose message literally contains the password:

```
unknown email        -> /login?error=credentials
wrong password       -> /login?error=credentials
empty email          -> /login?error=credentials
empty password       -> /login?error=credentials
whitespace email     -> /login?error=credentials
provider throws      -> /login?error=credentials
throws with the pw   -> /login?error=credentials

distinct messages: 1     distinct redirect paths: 1     byte-identical: true
```

The form is not an oracle. And the reason it holds is structural rather than disciplined: `SIGN_IN_ERROR_MESSAGE` is a single constant and the page renders nothing else, so the two messages cannot drift apart in a later edit.

**The password reaches nothing.** I spied on all five console levels and threw an error whose message embedded the password:

```
password in redirect?    false
password in message?     false
password in console?     false   (0 lines captured)
password in serialised?  false
```

Zero console lines is the detail worth naming. `catch { }` does not bind the thrown value at all, so the one object that could carry a request body back out is never in scope. That is a better answer than sanitising it on the way past.

**Success still works and the credential call gets both values.** `-> /today`, email passed, password intact.

**The build script, broken four ways.** Your three, plus one of mine:

```
caught   prisma generate removed
caught   reordered after next build
caught   unchained with ;
caught   chained with || instead of &&      <- mine
```

`||` is the one I expected to slip, because it reads like a chain and inverts the meaning. It does not.

---

## On the 23 of 24

Reporting 23 and explaining the twenty-fourth is worth more than reporting 24. You are right that a second message on an unreachable branch is dead code, that shipping it needs the reachable half too, and that the reachable half is caught. Contorting the test to catch code no user can execute would have made it noisier without making it stronger. **Do not round up.** The number is only useful if it is the real one.

The same goes for the sign-out caveat. `signOut({ scope: "global" })` is asserted as a request, not as a revocation, and saying so plainly is the correct read. I will confirm the revocation the first time a real session exists, which is my side, not yours.

## `app/auth/confirm` - leave it

It is dead for the magic link but it still handles `exchangeCodeForSession`, which an invite or recovery link uses, and its no-parameter path redirects to `/login?error=link`, which renders the same single message as everything else. Deleting it would remove the only route a future recovery flow needs and would break any Supabase redirect entry still pointing at it. Keeping it costs nothing and the one-message property already covers it.

---

## Athena's side, before this works

1. **Supabase → Authentication → Providers → Email**: enabled, and "Confirm email" off unless the account is already confirmed.
2. **Supabase → Authentication → Users**: set a password for her account, and Cole's if he needs one. No code path creates one, deliberately.
3. Push, confirm the Vercel deployment reaches `Ready`, then sign in at `/login`.

## Standing

- Four workflows registered. The engine, qualification and ingest are running in production as of 16:40 today.
- Eight leads from the pre-fix poll are stranded at status `new`. They were ingested by the Phase 1 endpoint, never qualified, and stable-id dedupe will skip them on re-poll. Clearing them so the next poll re-ingests them properly is a one-line decision and I can do it on request.
- Phase 6 stays shut until one lead goes through the whole pipeline.
- Still open: the in-person board radius, and Cole's ruling on `Reading`, `Writing`, `College Essays`.
