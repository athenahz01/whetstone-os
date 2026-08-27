import { checkableFigures, normalizeFigure, type FactsRegister } from "./facts";
import { topicGate } from "./topics";

/**
 * Deterministic voice and safety lint. Runs before the model QA, so the model
 * is never asked to judge something a regex settles.
 *
 * Two failure modes matter equally here, and the second one is the one that
 * killed the Phase 4 source filter:
 *
 *   Letting a ban through ships copy that undoes a business decision or states
 *   a blocked fact to a family.
 *
 *   Blocking legitimate copy means every draft bounces, S3 reports
 *   honest-looking failures, and nothing ships.
 *
 * So each rule below was written against a near miss that must pass, not only
 * against the phrasing that must fail:
 *
 *   "comprehension" is not "comprehensive".
 *   Financial leverage is not the buzzword.
 *   "the best" with a stated basis is not a bare superlative.
 *   One link is not two.
 *   A hyphen is not an em dash.
 *   "I reserved time on Tuesday" is not a held seat.
 *   "I cannot promise a score" is not a promised outcome. It is the honest
 *   disqualifier this phase requires, and a lint that eats it would force every
 *   draft to either lie or bounce.
 */

export type OutreachChannel =
  "wyzant-inquiry-reply" | "warm-follow-up" | "referral-partner";

export interface VoiceLintIssue {
  /** Stable id, so a failure names the clause rather than the guard. */
  rule: string;
  reason: string;
  /** The offending text, so a rejection is actionable. */
  evidence: string;
}

export interface VoiceLintInput {
  body: string;
  channel: OutreachChannel;
  /** The honest limitation. Required, and it must appear in the body. */
  disqualifier: string;
  /** The single next step. Required, and it must be a question. */
  ask: string;
  /** Concrete details from the source message; at least one must appear. */
  sourceDetails: string[];
  facts: FactsRegister;
}

export const CHANNEL_WORD_BOUNDS: Record<
  OutreachChannel,
  { min: number; max: number }
> = {
  "wyzant-inquiry-reply": { min: 80, max: 140 },
  "warm-follow-up": { min: 15, max: 90 },
  "referral-partner": { min: 90, max: 160 },
};

const NEGATORS =
  /\b(?:not|never|no|none|nothing|nobody|no one|cannot|can't|can not|won't|will not|unable|isn't|aren't|doesn't|don't|didn't|refuse|avoid)\b/gi;

const FINANCIAL_CONTEXT =
  /\b(?:financial|finance|debt|loan|capital|equity|ratio|balance sheet|borrow|mortgage)\b/i;

const BASIS_MARKER =
  /\b(?:based on|according to|because|given that|judging by|from what you)\b/i;

const CREDENTIAL_CLAIM =
  /\b(?:I(?:'ve| have)\s+(?:taught|tutored|coached|worked with)|years of experience|my background|I hold a|I earned a)\b/gi;

const OUTCOME_NOUN =
  /\b(?:admission|admitted|acceptance|accepted|get in|getting in|score|scores|scholarship|award|result|results|chances?|odds|probability|spot|movement|progress|improvement|gains?|growth)\b/i;

const PROMISE_MARKER =
  /\b(?:guarantee[ds]?|guaranteeing|ensure[sd]?|promise[sd]?|will\s+(?:\w+\s+){0,2}(?:get|be|have|see|go|improve|raise|increase)|definitely|certainly|going to\s+(?:get|be)|expect to|should\s+(?:get|see|be)|likely|probably|tends? to|often|routinely|generally|commonly|in (?:her|his|their) position|good chance|strong chance|practically|virtually|almost certainly|confident (?:that|you|she|he|they))\b/i;

/**
 * An outcome that moves is an outcome claimed. "tend to see their scores move"
 * promises as much as "will improve" and reads softer, which is why the hedged
 * shapes need their own marker rather than a longer promise list.
 */
const OUTCOME_MOVEMENT =
  /\b(?:improve[sd]?|improving|move[sd]?|moving|rise[sn]?|rising|jump[a-z]*|climb[a-z]*|increase[sd]?|goes? up|gain[a-z]*|lift[a-z]*)\b/i;

/** Naming a probability at all is banned, favourable or not, hedged or not. */
const PROBABILITY_TALK = /\b(?:chances?|odds|probability|likelihood)\b/i;

const COST_WORD =
  /\b(?:tuition|cost|costs|fee|fees|price|priced|hourly rate|charges?|deposit)\b/i;

/**
 * Digits or words. A model told to avoid a figure reaches for the words.
 *
 * A bare small numeral is not a price: "guessing costs you the first session"
 * is a sentence about time. So the spelled-out branch needs a magnitude word
 * or an explicit currency noun, which is what "five and a half thousand" and
 * "fifty five hundred" both have.
 */
const AMOUNT =
  /\$\s?\d|\b\d[\d,]*\s*(?:dollars|usd|k)\b|\b(?:hundred|thousand|million|grand)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(?:hundred|thousand|dollars)\b/i;

/**
 * No credential row in FACTS.md is VERIFIED, so a claim that Cole studied or
 * taught at a named institution is unsupported whichever institution it names.
 * This is what catches the paraphrase that drops the blocked word and keeps
 * the claim.
 */
const INSTITUTION_CREDENTIAL =
  /\b(?:graduated?|degree|studied|read|taught|lectured|trained|educated)\s+(?:from|at|in)\s+(?:the\s+)?[A-Z][A-Za-z]+/;

const RESERVATION_TARGET = /\b(?:seat|spot|place|slot)s?\b/i;
const RESERVATION_VERB =
  /\b(?:held|hold|reserved|reserving|guaranteed|secured|securing|saved|set aside)\b/i;

const TEACHING_VERB =
  /\b(?:teach|teaches|teaching|tutor|tutors|tutoring|cover|covers|help(?:s)? with|work(?:s)? on|prep(?:s)? for|offer(?:s)?|support)\b/i;

const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;

/** The six positioning bans. Each undoes a decision the business has made. */
const POSITIONING_BANS: [string, RegExp, string][] = [
  [
    "positioning.consultation",
    /\bconsultations?\b/i,
    'the offer is a session with the founders, not a consultation. Say "a session" or name the thing directly',
  ],
  [
    "positioning.ikigai",
    /\bikigai\b/i,
    'an internal framework name. Say "direction" or "purpose"',
  ],
  [
    "positioning.common-app",
    /\bcommon\s+app\b/i,
    'internal shorthand. Say "the application" or "how the file gets read"',
  ],
  [
    "positioning.capstone",
    /\bcapstones?\b/i,
    'internal program vocabulary. Say "the project" or "what they build"',
  ],
  [
    "positioning.first-come-first-served",
    /\bfirst[\s-]?come[,\s-]+first[\s-]?served\b/i,
    'Whetstone selects. Say "we are selecting a small number of families"',
  ],
  [
    "positioning.youll-get-a-spot",
    /\byou(?:'|’)?(?:ll|\s+will)\s+get\s+a\s+spot\b/i,
    'nothing has been promised to anyone. Say "you can apply"',
  ],
];

/** The banned words and phrases list, one rule each. */
const BANNED_PHRASES: [string, RegExp][] = [
  ["ban.delve", /\bdelve\b/i],
  ["ban.its-worth-noting", /\bit(?:'|’)?s worth noting\b/i],
  ["ban.at-the-end-of-the-day", /\bat the end of the day\b/i],
  ["ban.i-wanted-to-reach-out", /\bI wanted to reach out\b/i],
  ["ban.multifaceted", /\bmultifaceted\b/i],
  ["ban.nuanced", /\bnuanced\b/i],
  ["ban.tapestry", /\btapestry\b/i],
  ["ban.comprehensive", /\bcomprehensive\b/i],
  ["ban.i-hope-this-helps", /\bI hope this helps\b/i],
  [
    "ban.thats-what-the-essay-is-for",
    /\bthat(?:'|’)?s what the essay is for\b/i,
  ],
  ["ban.happy-to-send", /\bhappy to send\b/i],
  [
    "ban.thats-more-than-most-applicants-have",
    /\bthat(?:'|’)?s more than most applicants have\b/i,
  ],
  ["ban.thats-good-for-a-sophomore", /\bthat(?:'|’)?s good for a sophomore\b/i],
  [
    "ban.thats-impressive-for-your-age",
    /\bthat(?:'|’)?s impressive for your age\b/i,
  ],
  [
    "ban.most-students-dont-have-this",
    /\bmost students don(?:'|’)?t have this\b/i,
  ],
  [
    "ban.the-thing-that-could-derail",
    /\bthe thing that could derail this whole profile\b/i,
  ],
  ["ban.which-shows", /\bwhich shows\b/i],
  ["ban.which-signals", /\bwhich signals\b/i],
  ["ban.thats-the-kind-of", /\bthat(?:'|’)?s the kind of\b/i],
];

function sentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function words(body: string): string[] {
  return body.split(/\s+/).filter(Boolean);
}

/**
 * True when a negator appears before the claim in the same sentence. This is
 * what lets an honest disqualifier through: "I cannot promise a score" is the
 * opposite of a promise, and blocking it would make every draft either lie or
 * bounce.
 */
function negatedBefore(sentence: string, claimIndex: number): boolean {
  NEGATORS.lastIndex = 0;
  for (const match of sentence.matchAll(NEGATORS)) {
    if (match.index !== undefined && match.index < claimIndex) return true;
  }
  return false;
}

function excerpt(sentence: string): string {
  return sentence.length <= 120 ? sentence : `${sentence.slice(0, 117)}...`;
}

/**
 * The content rules only, with no length or structure check.
 *
 * Used before echoing a prospect's own words back to them. A parent who writes
 * "she needs to get her score up" has said nothing wrong, but quoting it would
 * put a promised outcome in Cole's mouth, so the echo is linted before it is
 * borrowed.
 */
export function lintFragment(
  fragment: string,
  facts: FactsRegister,
): VoiceLintIssue[] {
  const issues: VoiceLintIssue[] = [];
  const add = (rule: string, reason: string, evidence: string) =>
    issues.push({ rule, reason, evidence });

  for (const [rule, pattern, reason] of POSITIONING_BANS) {
    const match = pattern.exec(fragment);
    if (match) add(rule, reason, match[0]);
  }
  for (const [rule, pattern] of BANNED_PHRASES) {
    const match = pattern.exec(fragment);
    if (match) add(rule, "banned word or phrase in VOICE.md", match[0]);
  }
  for (const sentence of sentences(fragment)) {
    for (const issue of topicGate(sentence, facts)) {
      add(issue.rule, issue.reason, issue.evidence);
    }
    lintSentence(
      sentence,
      {
        body: fragment,
        channel: "wyzant-inquiry-reply",
        disqualifier: "",
        ask: "",
        sourceDetails: [],
        facts,
      },
      add,
    );
  }
  lintFigures(fragment, facts, add);
  return issues;
}

export function voiceLint(input: VoiceLintInput): VoiceLintIssue[] {
  const issues: VoiceLintIssue[] = [];
  const { body, facts } = input;
  const add = (rule: string, reason: string, evidence: string) =>
    issues.push({ rule, reason, evidence });

  for (const [rule, pattern, reason] of POSITIONING_BANS) {
    const match = pattern.exec(body);
    if (match) add(rule, reason, match[0]);
  }

  for (const [rule, pattern] of BANNED_PHRASES) {
    const match = pattern.exec(body);
    if (match) add(rule, "banned word or phrase in VOICE.md", match[0]);
  }

  for (const sentence of sentences(body)) {
    // Topic first. It asks what the sentence is about and requires a VERIFIED
    // row behind any claim in a flagged topic, which is what catches the
    // paraphrase a word pattern cannot see.
    for (const issue of topicGate(sentence, facts)) {
      add(issue.rule, issue.reason, issue.evidence);
    }
    lintSentence(sentence, input, add);
  }

  lintFormatting(input, add);
  lintStructure(input, add);
  lintFigures(body, facts, add);

  return issues;
}

function lintSentence(
  sentence: string,
  input: VoiceLintInput,
  add: (rule: string, reason: string, evidence: string) => void,
): void {
  const { facts } = input;

  // "leverage" is banned as a buzzword, not as a financial term.
  const leverage = /\bleverag(?:e|es|ed|ing)\b/i.exec(sentence);
  if (leverage && !FINANCIAL_CONTEXT.test(sentence)) {
    add(
      "ban.leverage-buzzword",
      'banned unless it means financial leverage. Say "use" or name the thing',
      leverage[0],
    );
  }

  // A superlative needs a stated basis. "the best use of the next month, based
  // on the diagnostic you described" is a judgement with a reason behind it.
  const superlative = /\bthe (?:best|most important)\b/i.exec(sentence);
  if (superlative && !BASIS_MARKER.test(sentence)) {
    add(
      "ban.bare-superlative",
      "a superlative needs a cited, verified basis in the same sentence",
      superlative[0],
    );
  }

  const outcome = OUTCOME_NOUN.exec(sentence);
  const promise =
    PROMISE_MARKER.exec(sentence) ?? OUTCOME_MOVEMENT.exec(sentence);
  if (outcome && promise) {
    const claimIndex = Math.min(outcome.index, promise.index);
    if (!negatedBefore(sentence, claimIndex)) {
      add(
        "promise.outcome",
        "no promised outcomes, stated, implied or hedged",
        excerpt(sentence),
      );
    }
  }

  const probability = PROBABILITY_TALK.exec(sentence);
  if (probability && !negatedBefore(sentence, probability.index)) {
    add(
      "promise.probability",
      "never state, imply or hint at a probability, favourable or not",
      excerpt(sentence),
    );
  }

  const cost = COST_WORD.exec(sentence);
  const amount = AMOUNT.exec(sentence);
  if (cost && amount) {
    const supported = checkableFigures(sentence).some((figure) =>
      facts.supportedFigures.has(normalizeFigure(figure)),
    );
    if (!supported) {
      add(
        "facts.unsupported-price",
        "do not state a price unless the exact claim is VERIFIED in FACTS.md, in digits or in words",
        excerpt(sentence),
      );
    }
  }

  const target = RESERVATION_TARGET.exec(sentence);
  const verb = RESERVATION_VERB.exec(sentence);
  if (target && verb) {
    const claimIndex = Math.min(target.index, verb.index);
    if (!negatedBefore(sentence, claimIndex)) {
      add(
        "reservation.language",
        "the offer is an application, not a reservation. No seat is held, reserved, guaranteed or secured",
        excerpt(sentence),
      );
    }
  }

  lintBlockedSubjects(sentence, facts, add);

  if (
    /\b(?:more than most|better than (?:most|other|the other)|ahead of (?:most|other)|stronger than (?:most|other)|top \d+\s?%)\b/i.test(
      sentence,
    )
  ) {
    add(
      "voice.comparative-ranking",
      "never compare one student's quality with another's",
      excerpt(sentence),
    );
  }

  const impliedSend =
    /\b(?:I(?:'|’)?(?:ve| have) sent|this (?:was|has been) sent|already sent|has been approved|I approved)\b/i.exec(
      sentence,
    );
  if (impliedSend) {
    add(
      "voice.auto-send-implication",
      "never imply a message was sent or a human approved something that was not recorded",
      impliedSend[0],
    );
  }

  if (input.channel === "wyzant-inquiry-reply") {
    const offPlatform =
      /\b(?:text me|call me at|whatsapp|venmo|zelle|off[- ]platform|my personal email|email me directly|reach me directly at)\b/i.exec(
        sentence,
      );
    if (offPlatform) {
      add(
        "voice.off-platform",
        "keep the entire interaction on Wyzant",
        offPlatform[0],
      );
    }
  }
}

/**
 * The five hard blocks. Each names the FACTS.md row that blocks it, so a
 * rejection points at the register rather than at a rule nobody can trace.
 */
function lintBlockedSubjects(
  sentence: string,
  facts: FactsRegister,
  add: (rule: string, reason: string, evidence: string) => void,
): void {
  const blocked = new Set(facts.blockedIds);

  // C-001: Wright tuition and the entire award ladder denominated on it.
  if (blocked.has("C-001")) {
    // Any cost word in a Wright sentence, with or without a figure. Told to
    // avoid the number, a model says "runs about five and a half thousand".
    const tuition =
      /\btuition\b|\baward ladder\b|\bfounding fellow\b|\bmerit rate\b/i.exec(
        sentence,
      ) ??
      (/\bwright\b/i.test(sentence)
        ? // A cost word, or any unsupported amount at all. "Wright runs about
          // fifty five hundred" states the blocked figure without either.
          (COST_WORD.exec(sentence) ??
          (AMOUNT.test(sentence) &&
          !checkableFigures(sentence).some((figure) =>
            facts.supportedFigures.has(normalizeFigure(figure)),
          )
            ? AMOUNT.exec(sentence)
            : null))
        : null);
    if (tuition) {
      add(
        "blocked.wright-tuition",
        "FACTS.md C-001 blocks Wright tuition and every rung of the ladder denominated on it. Do not paraphrase around it",
        tuition[0],
      );
    }
  }

  // C-002, C-003, C-004: scholarship value, dates and award structure.
  if (blocked.has("C-002") || blocked.has("C-003") || blocked.has("C-004")) {
    const scholarship = /\bscholarships?\b/i.exec(sentence);
    const detail =
      /\$\s?\d|\bdeadline\b|\bdue\b|\bdecisions?\b|\bpriority\b|\bfull award\b|\bpartial award\b|\bawards?\b|\bworth\b|\bup to\b|\bapply by\b|\bopens?\b|\bopening\b|\bcloses?\b|\bclosing\b|\bends?\b|\bstarts?\b|\bwindow\b|\bnext month\b|\bthis month\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.exec(
        sentence,
      );
    if (scholarship && detail) {
      add(
        "blocked.scholarship-terms",
        "FACTS.md C-002, C-003 and C-004 block the scholarship value, dates and award structure",
        excerpt(sentence),
      );
    }
  }

  // C-005: the live rules label themselves draft and unreviewed by counsel.
  if (blocked.has("C-005")) {
    const terms =
      /\b(?:per the (?:terms|rules)|under the (?:terms|rules)|the (?:scholarship )?(?:terms|rules) (?:say|state|provide))\b/i.exec(
        sentence,
      );
    if (terms) {
      add(
        "blocked.draft-terms",
        "FACTS.md C-005 blocks any claim that leans on the draft scholarship terms",
        terms[0],
      );
    }
  }

  // C-006: Wright application dates are not announced.
  if (blocked.has("C-006")) {
    const wright = /\bwright\b/i.test(sentence);
    const dates =
      /\bapplications? (?:open|close|are due)\b|\bapply by\b|\bdeadline\b|\bcohort starts\b/i.exec(
        sentence,
      );
    if (wright && dates) {
      add(
        "blocked.wright-dates",
        "FACTS.md C-006 blocks Wright application dates until a human verifies them",
        dates[0],
      );
    }
  }

  // The credential rows. Legacy material is full of this and a model will
  // reach for it as the strongest credential available.
  if (facts.credentialsBlocked) {
    const credential = /\b(?:harvard|oxford|oxbridge|ivy league)\b/i.exec(
      sentence,
    );
    if (credential) {
      add(
        "blocked.harvard-oxford-credential",
        "FACTS.md blocks Cole's Harvard and Oxford credentials until he verifies the exact wording. Omit the claim",
        credential[0],
      );
    }
  }

  const institution = INSTITUTION_CREDENTIAL.exec(sentence);
  if (institution) {
    add(
      "blocked.credential-claim",
      "FACTS.md holds no VERIFIED credential row, so no institutional credential may be stated",
      institution[0],
    );
  }

  // F-005: exactly four approved subjects, stated as something he teaches.
  const unapproved =
    /\bSAT\s+Math\b|\bACT\s+(?:Math|English|Science|Reading)\b|\bthe ACT\b|\bACT prep(?:aration)?\b/i.exec(
      sentence,
    );
  if (unapproved && TEACHING_VERB.test(sentence)) {
    const claimIndex = unapproved.index;
    if (!negatedBefore(sentence, claimIndex)) {
      add(
        "blocked.unapproved-subject",
        `FACTS.md F-005 approves exactly ${facts.approvedSubjects.join(", ")}. Offering anything else misstates what Cole can take`,
        unapproved[0],
      );
    }
  }
}

function lintFormatting(
  input: VoiceLintInput,
  add: (rule: string, reason: string, evidence: string) => void,
): void {
  const { body, channel } = input;

  if (body.includes("—")) {
    add("format.em-dash", "no em dash. A simple hyphen is allowed", "—");
  }
  if (body.includes("–")) {
    add("format.en-dash", "no en dash. A simple hyphen is allowed", "–");
  }

  const links = body.match(LINK) ?? [];
  if (links.length > 1) {
    add("format.link-count", "at most one link", links.join(" "));
  }

  const bounds = CHANNEL_WORD_BOUNDS[channel];
  const count = words(body).length;
  if (count < bounds.min || count > bounds.max) {
    add(
      "length.out-of-bounds",
      `${channel} runs ${bounds.min} to ${bounds.max} words`,
      `${count} words`,
    );
  }

  const credentials = body.match(CREDENTIAL_CLAIM) ?? [];
  if (credentials.length > 1) {
    add(
      "credential.repeated",
      "a credential may appear at most once",
      credentials.join(" / "),
    );
  }
}

function lintStructure(
  input: VoiceLintInput,
  add: (rule: string, reason: string, evidence: string) => void,
): void {
  const { body, disqualifier, ask, sourceDetails } = input;

  if (!disqualifier.trim()) {
    add(
      "structure.missing-disqualifier",
      "every draft states one honest limitation",
      "(none)",
    );
  } else if (!body.includes(disqualifier.trim())) {
    add(
      "structure.missing-disqualifier",
      "the declared limitation does not appear in the body",
      disqualifier.trim(),
    );
  }

  const trimmedAsk = ask.trim();
  if (!trimmedAsk.endsWith("?")) {
    add(
      "structure.ask-not-a-question",
      "the next step is phrased as a question",
      trimmedAsk || "(none)",
    );
  } else if (!body.includes(trimmedAsk)) {
    add(
      "structure.ask-not-a-question",
      "the declared next step does not appear in the body",
      trimmedAsk,
    );
  }

  const lowerBody = body.toLowerCase();
  const matched = sourceDetails.filter((detail) =>
    lowerBody.includes(detail.trim().toLowerCase()),
  );
  if (sourceDetails.length > 0 && matched.length === 0) {
    add(
      "structure.missing-source-detail",
      "refer to at least one concrete detail from the source message",
      sourceDetails.join(" / "),
    );
  }
}

function lintFigures(
  body: string,
  facts: FactsRegister,
  add: (rule: string, reason: string, evidence: string) => void,
): void {
  for (const figure of checkableFigures(body)) {
    if (!facts.supportedFigures.has(normalizeFigure(figure))) {
      add(
        "facts.unsupported-figure",
        "every checkable figure must appear in a VERIFIED row of FACTS.md",
        figure,
      );
    }
  }
}
