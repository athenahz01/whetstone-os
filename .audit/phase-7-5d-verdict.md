# Audit verdict - Phase 7.5d: the daily message

**Commit audited:** `1831727`
**Auditor:** Claude (Cowork), independent probes, the digest rendered against the live export, and a reply sent the way a person would actually send it
**Verdict: PASS WITH FINDINGS.** One finding would have made the entire surface do nothing, every day, in the only channel it is configured for. Fixed here. A second finding comes from Athena's rebuilt `!Dashboard` and is handed back rather than fixed, for a reason given below.

**After the fix: 46 files / 680 tests / 0 skipped, all passing.** Typecheck, lint, `format:check`, `docs:lint` 6/6 and `next build` clean. `lib/core/engine.ts` unchanged at `9f95451a2e60cd143afa1d46618b34e0`.

---

## Finding 1 - a reply sent from a mail client did nothing at all

**Severity: high. Certain, not hypothetical, and it hits every reply.**

`parseDigestReply` split the whole message on non-digits and treated every numeric run as a candidate command:

```ts
for (const token of text.split(/[^0-9]+/).filter(Boolean)) {
```

The digest prints all four codes for all five leads. Every mail client quotes the message being answered underneath the reply. So the quoted body carries the entire command vocabulary.

I rendered the real digest from the live export and replied to it the way Gmail does. **A reply of `13` parsed as twenty commands** - every action for every lead - and the conflict guard then refused all of them:

```
commands:  13=U033/lost, 11=U033/draft, 12=U033/snooze, 14=U033/spoke,
           21=U036/draft, 22=U036/snooze, 23=U036/lost, 24=U036/spoke, ... (20)
conflicts: U033[lost+draft+snooze+spoke], U036[...], U002[...], U004[...], U011[...]
```

Nothing written, Ren's instruction discarded, no error he would ever see. **Email is the defaulted delivery channel** under section 5.2, so this is every reply, every day. The conflict guard is what stopped it becoming data corruption, and it is the only reason this is a dead feature rather than a destructive one.

There is a second, quieter edge in the same tokeniser. A date or a clock time yields a valid code: `2026-08-24` and `08:24` both give `24`, which addresses the second lead. **One spurious code raises no conflict, so it applies** - a command nobody typed, from a timestamp in quoted text.

### The fix

`stripQuotedReply` cuts the message at the first quote marker - `>` prefixes, the Gmail and Apple Mail attribution line, the Outlook rule and header block, `Sent from my ...` - so only what the person typed is read. And a code must now stand on its own: `(?<![\d:/.\-])\d{2}(?![\d:/.\-])` refuses a run bounded by digits or date and time separators.

Same reply, after: `commands: 13=U033/lost`, no conflicts.

Twelve assertions in `tests/phase-7-5d-quoted-reply.test.ts`, covering the four client shapes, several codes typed deliberately, a code written among words, and four numbers that must not be read as commands. Removing the quote strip fails five; loosening the token pattern fails three. The two halves are independently caught.

---

## Finding 2 - the thresholds are the wrong numbers, and the source now exists

**Severity: medium. Reported, not fixed, deliberately.**

Athena rebuilt `!Dashboard` on 28 August and it carries Whetstone's real chase cadence, taken from the **CRM Action Sheet v1.0** and stored in its Lists tab, where it drives the sheet's own "Chase After" and "Chase Flag" columns. The code's numbers are the brief's invented placeholders, and they are uniformly about twice too slow:

```
stage       code   Action Sheet
Negotiate     3         2
Active        7         3
Engage        7         3
Prospect     14         7
Cold         30        15
```

Every live lead would sit roughly twice as long as Whetstone's own policy allows before the clock said anything. The sheet and the code currently chase on two different cadences.

**I made this change, saw twelve tests fail, and reverted it.** The failures are not defects: several tests engineer exact ties in overdue days to prove the tie-break rules, and those constructions are built around the old numbers. Re-deriving twelve fixtures is real work, and quietly rewriting a dozen of the executor's tests at the end of an audit is how an assertion gets weakened without anyone noticing. The role split in `CLAUDE.md` exists for this. **The note is in `thresholds.ts` where the next person will read it**, and the change belongs in the next executor pass.

---

## What held, and it is a lot

**The message is good.** Rendered against the live export it reads as intended: five items worst-first, each with its evidence basis, the held-back count, and this line, which is section 7's rule working exactly as designed:

> `5 lead(s) cannot be measured at all: 4 with nothing to match on, 1 whose contacts reach another lead, 0 never contacted and with no lead date. These are not healthy and they are not in the list above.`

**The stale-digest risk is already closed.** Codes resolve against the digest that was sent, so yesterday's `24` cannot act on today's second lead. I went looking for that and found it handled, with the reasoning written down.

**G1 is enforced by shape, not by discipline.** `notifyDigest(subject, body)` has no recipient parameter, and a test asserts its arity - there is no argument through which a prospect's address could be passed. That is the right way to make a guardrail true.

**Names are handled in four places**, including the log line and everything a reply writes, plus a migration test that no column could hold one.

**The executor found a real defect in its own code and named the pattern**: the digest reconstructed scan coverage from clock entries, so a day with no live leads reported "read no mailbox" on a healthy run. It also said, unprompted, that this was the same shape as the auditor's finding one layer up, which it had read before writing the code and reproduced anyway. That is worth more than a clean report.

**The survivor disclosure is now consistent across four phases** and correct again here.

---

## Athena's rebuilt !Dashboard - how it relates to this build

It is good work and it converges with ours independently, including flagging the WeChat handles hidden in the phone column, which I found in the 7.5b audit. Its Overview and Action Queue are live formulas over the data, and its Read Me is explicit that nothing was deleted, resolved or overwritten - twenty-one flagged decisions sit on a Data Issues tab rather than being silently fixed. That is the same discipline as `disputed`.

**Two things follow, and they matter for what gets built next.**

The rebuild is the better **target schema**. It has one header row, real dates, money as numbers, and three columns the Action Sheet requires that the old sheet had nowhere to put. 7.5a's importer is written against the old two-file fork. Retargeting it at this sheet is less work than it sounds and removes the fork problem at the source rather than reconciling it - but it is a real change to a phase already audited, and it should be a deliberate decision rather than a drift.

**Its Action Queue is the silence clock, in a spreadsheet - and it inherits the original problem.** The Read Me says the formulas "update themselves the moment you change a stage or add a meeting date." That is true, and it is exactly the constraint: `Last Touch` is derived from the meeting-date columns, which are the columns a human types after a call. Those are filled on 8, 7 and 4 rows of 69. The formulas cannot go stale; their inputs already are.

So the rebuild and 7.5b are not competing, they are the two halves. The sheet is the right schema and the right cadence; the touch scan is what fills `Last Touch` without anyone typing it. **Neither half works alone**, and that is worth saying plainly before someone concludes the rebuild made the build redundant, or the reverse.

---

## Open

**Nothing here has reached a person and nothing has touched a database.** Five phases. The acceptance box "Ren completes a full day's triage" is a fact about a person, and the executor correctly declined to claim it.

**Inbound replies have no transport.** `parseDigestReply` takes a string; nothing reads a mailbox. My fix makes an email reply parse correctly once something delivers it, which is progress on a path that is otherwise unbuilt.

**One lint warning**: an unused `daysAgo` in `tests/phase-7-5d-daily-message.test.ts`. `pnpm lint` passes because the script does not fail on warnings; worth a one-line cleanup rather than a finding.

**The two-digit code is the executor's reading of "the reply is a number"**, flagged honestly. Rendered, it looks right, and it is one number typed once. Whether Ren can act on it from a phone is the thing only Ren can answer.
