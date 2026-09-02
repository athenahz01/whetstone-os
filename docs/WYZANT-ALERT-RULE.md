# Wyzant: stop scoring as the gate, email on rate

Owner decision, Athena, 2026-09-02. Supersedes score-gated surfacing for the
Wyzant channel. Nothing else in the pipeline changes.

## What Athena asked for

> I don't want the agent to score anymore, can we make it pin me (email me)
> whenever there's relevant leads with no strict salary contradict? Our online is
> $295. If someone asked for $50 of course that's a no, but if someone is around
> $200 and above, or doesn't have a salary preference (left the field empty),
> that could be worth a shot and I want to reach out to them.

## The rule

A Wyzant job emails Athena when **both** hold:

1. **It is relevant.** Unchanged, and still the adapter's existing filter: one of
   Cole's four approved subjects (`docs/FACTS.md` F-005 - College Counseling,
   English, Essay Writing, SAT Reading), plus the configured lesson-type and
   location scoping. Relevance is not a judgement and is not being removed.
2. **Its rate does not contradict ours.** The board field is `Recommended rate`.
   - `None` -> **send.** No stated preference is an opening, not a rejection.
   - a number at or above `WYZANT_MIN_RATE` -> **send.**
   - a number below it -> **do not send**, and record why.

`WYZANT_MIN_RATE` defaults to **200**, from Athena's "around $200 and above"
against the $295 online rate in `docs/FACTS.md` F-007. It is configuration, not a
constant, because "around" is a judgement she may want to move once she has seen
a week of real alerts.

## What the field actually looks like

From `tests/fixtures/wyzant-board.real-capture.html`, both job cards:

```html
<span class="text-semibold text-underscore">
  <i class="wc-usd"></i> Recommended rate: None
</span>
```

Two things follow, and both matter more than the threshold.

**`None` is a real, common value.** Two of two cards in the real capture. Since
`None` sends, most jobs will reach her regardless of the number.

**The label says "Recommended", and that is worth watching.** The one live lead
this project has seen read `$55/hr recommended`. If that figure is Wyzant's own
suggestion rather than the student's budget, a $200 floor rejects almost every
job that carries a number at all - the opposite of the intent. The rule is safe
anyway because `None` sends, but **the first week of alerts should be read for
this**: if numbered rates cluster far below $295 while `None` rates convert
fine, the number is Wyzant's and not the family's, and the threshold should be
retired rather than tuned.

## Keep scoring, stop gating on it

Athena said stop scoring. Read literally that removes `S1.qualify`, and with it
KPI #5's only source, which is what Cole's scorecard is judged on.

**Recommendation: keep computing and recording the score, and stop letting it
decide what she sees.** She gets every relevant, non-contradicting job either
way. The score becomes a recorded prediction sitting next to her actual reply,
which after a few weeks answers a question nobody can answer today: was the
scoring any good? If it was not, retiring it is then an evidenced decision rather
than a preference. If it was, it earns its place back.

This is the owner's call to overrule. If she wants it gone, it goes - but KPI #5
needs a new definition in the same change, not silently zero.

## Acceptance

- [ ] A job with `Recommended rate: None` in an approved subject emails Athena.
      This is the case the whole rule exists for and it must not be an edge case
      in the tests.
- [ ] A job at or above `WYZANT_MIN_RATE` emails her. One at $50 does not, and
      the reason is recorded rather than the job being silently dropped. **A job
      that vanishes with no row is the defect this project has found in every
      phase.**
- [ ] `WYZANT_MIN_RATE` is configuration. Proven by a test that moves it and
      asserts the outcome changes.
- [ ] An unparsable rate cell is treated as `None`, not as zero. Zero would
      reject it, and a cell we cannot read is not a lowball - it is unknown.
      Recorded distinctly from a real `None` so the two can be told apart later.
- [ ] The rate is extracted, stored on the lead, and visible in the alert. She
      cannot judge "worth a shot" without seeing the number.
- [ ] The score is still computed and recorded, and does not gate the email.
      Proven by a test where a low-scoring, in-subject, `None`-rate job is sent.
- [ ] No learner name, no job body text and no URL in any log line. The alert
      itself may name the subject, the rate, the age and the link, because it
      goes to Athena alone.
- [ ] The email goes to `ALERT_EMAIL_TO` and nowhere else. The alert sender takes
      no recipient argument and must not gain one. G1 restated: this is a path to
      Athena, never to a family.

## Access, and who gets it

`athena@whetstoneadmissions.com` for now, more people later - Athena, 2026-09-02.

- `ALERT_EMAIL_TO=athena@whetstoneadmissions.com`
- The read-only Gmail and Calendar access that Phase 7.5b needs is the same
  account.

Written as one address, not a list, because that is what it is today. When more
people are added it becomes a list and the alert sender still takes no recipient
argument - the list is configuration, not a parameter a caller can set.
