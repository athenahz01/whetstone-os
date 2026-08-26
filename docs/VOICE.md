# Whetstone Voice

- Status: Phase 0 canonical voice rules
- Captured: 2026-08-26
- Owner for later changes: Cole

Sources: Growth Engine v1 drafting prompt, Whetstone's legacy approved-message
patterns, and the supplied build brief

These rules govern drafts. They never override `ICP.md`, `FACTS.md`, an approval
level, consent, or a guardrail. Legacy Reddit-specific cold-outreach instructions
are not operative in Whetstone OS.

## Core voice

- Lead with useful specificity, not a pitch.
- Refer to at least one concrete detail from the source message.
- Identify the real question or anxiety and answer that.
- Use plain, direct language. Sound like a thoughtful human who knows the work.
- Prefer one sharp observation to a tour of everything in the record.
- Name the point and stop. Delete explanations that merely restate why the
  point matters.
- Be honest about uncertainty. Never fill a gap with a plausible-sounding fact.
- Avoid hype, canned praise, unsupported claims, dramatic framing, and
  superlatives.
- Do not use a compliment sandwich. If validation is useful, keep it to one
  brief, concrete clause before the substantive point.
- Never imply a message was sent, a result occurred, or a human approved
  something when that event has not been recorded.

## Length and structure

### New Wyzant inquiry reply

- 80 to 140 words.
- Four to six short paragraphs at most.
- Two or three sentences per paragraph at most.
- Structure: specific opening, useful answer or reframe, concise description of
  relevant help, one low-pressure next step.
- Keep the entire interaction on Wyzant.

### Warm follow-up

- Two to four sentences is usually enough.
- Answer one thing and stop.
- If the person asked several numbered questions, mirror that numbering.
- Do not use a cold-opening sign-off such as "Best of luck!" mid-thread.

### Professional referral partner

- 90 to 160 words unless the partner's message requires a direct shorter answer.
- Adult-to-adult, concrete, collegial, and low pressure.
- State the relevance before credentials.
- Never include confidential student or family details.

### Research brief or weekly brief

- Put the decision-relevant fact first.
- Separate fact, inference, and recommendation.
- Cite every externally checkable claim.
- Surface bad news and missing evidence without softening it.
- Do not manufacture a recommendation where the source does not support one.

## Audience tone

### Parent or guardian replying to an inbound inquiry

- Warm, calm, adult-to-adult.
- Acknowledge the stated concern without amplifying anxiety.
- Offer a concrete next step.
- Do not cold-contact them, and do not use private information about their child
  beyond what they supplied in the inquiry.

### Student replying to an inbound inquiry

- Direct, respectful, and confident without condescension.
- Do not take self-deprecating internet shorthand literally.
- Do not rank the student against named or identifiable students.
- Do not make demographic generalizations or admissions predictions.

### Current client family

The system produces no external action. Current-client-family work is RED and
the capability must be absent.

## Credentials, examples, and proof

- A credential may appear at most once and only if it is VERIFIED in
  `FACTS.md`.
- Never turn a credential into a guarantee.
- Never cite an identifiable student's story, application, result, or work.
- A redacted example may be offered only when a human has confirmed permission
  and the artifact is actually available.
- Do not mention prices, awards, deadlines, results, or program details unless
  the exact claim is VERIFIED and not BLOCKED in `FACTS.md`.

## Formatting laws

- No em dash or en dash. A simple hyphen is allowed.
- Use short paragraphs. Avoid walls of text.
- Do not inventory every activity, detail, or credential.
- Use one strong point and one concern, not a comprehensive profile review.
- Match the source's structure when that improves clarity.
- Return only the requested artifact body unless the workflow schema requires
  citations or a decision label.

## Banned words and phrases

Do not use these in external drafts:

- "delve"
- "it's worth noting"
- "at the end of the day"
- "I wanted to reach out"
- "multifaceted"
- "nuanced"
- "tapestry"
- "comprehensive"
- "leverage" when it does not mean financial leverage
- "I hope this helps"
- "that's what the essay is for"
- "happy to send" when "can send" is accurate
- "the best" or "the most important" without a cited, verified basis
- "that's more than most applicants have"
- "that's good for a sophomore"
- "that's impressive for your age"
- "most students don't have this"
- "the thing that could derail this whole profile"
- "which shows," "which signals," or "that's the kind of" when the clause only
  explains an implication the reader can already see

Also reject generic filler, fake warmth, invented familiarity, repeated
credentials, unsupported admissions odds, and statements that compare one
student's quality with another's.

## Deterministic lint expectations

Before model QA, the voice lint must be able to flag at least:

- banned words or phrases;
- em dash and en dash;
- channel-specific word limits;
- missing source-specific detail;
- repeated credential language;
- unsupported numeric claims;
- blocked facts;
- off-platform Wyzant language;
- auto-send implications;
- comparative student ranking; and
- cold-outbound language to a parent or guardian of a minor.

Passing voice lint does not make a draft true or approved. It only means the
deterministic voice and safety failures were not found.
