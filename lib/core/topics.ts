import { checkableFigures, normalizeFigure, type FactsRegister } from "./facts";

/**
 * The topic gate. It runs ahead of the word patterns and inverts their default.
 *
 * A word pattern asks "does this sentence contain a banned token", so dropping
 * the token ships the claim: "Cole studied at Cambridge" is blocked while "Cole
 * did his undergraduate work in Cambridge, in Massachusetts" is not, and the
 * audit walked nine paraphrases straight through on exactly that shape.
 *
 * This asks a smaller and more stable question first: what is the sentence
 * about. If it touches Wright, the scholarship, Cole's education, what he
 * teaches, a price, or an outcome, then any claim inside it has to trace to a
 * VERIFIED row in FACTS.md. A sentence about Cole's education fails whether it
 * names Harvard, Cambridge, an ancient English university, or a top-five
 * programme, because no VERIFIED row stands behind any of them.
 *
 * Topic detection is a much smaller surface than claim detection, and it fails
 * safe rather than open.
 */

export interface TopicIssue {
  rule: string;
  reason: string;
  evidence: string;
}

/* Shared vocabulary ------------------------------------------------------- */

/**
 * Money words, including the ones a model reaches for when told to avoid the
 * figure. "award" is deliberately absent: F-006 verifies the Wright demo day
 * award, and a prize is not a price.
 */
export const COST_TOPIC =
  /\b(?:tuition|cost|costs|costing|fee|fees|price|prices|priced|pricing|hourly rate|charges?|deposit|investment|invest|invests|invested|investing|expense|outlay|budget|out of pocket|per hour|an hour|runs to|comes to|works out to|sets you back|spend|spends|spent|spending|pay|pays|paid|paying)\b/i;

/**
 * A qualitative price claim needs no figure to be a price claim. "We are not
 * the cheapest option in the city" tells a parent what the hour costs relative
 * to the market, which is exactly the claim FACTS.md has nothing to support.
 */
export const COST_QUALITY =
  /\b(?:cheap(?:er|est)?|inexpensive|expensive|pricey|afford(?:able|ably)?|value for money|reasonable rate)\b/i;

/** Amounts in digits, in words, or as a range a reader can still price. */
export const AMOUNT_TOPIC =
  /\$\s?\d|\b\d[\d,]*\s*(?:dollars|usd|k)\b|\b(?:hundred|thousand|million|grand)\b|\b(?:four|five|six)[-\s]figure\b|\btens of thousands\b|\bhundreds of\b/i;

const DATE_CLAIM =
  /\b(?:deadline|due|closes?|closing|opens?|opening|by the (?:end|middle|start)|middle of|end of|start of|cut[- ]?off|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

const APPLICATION_WORD = /\b(?:applications?|applying|apply)\b/i;

/**
 * Education and institutional credentials. Not general experience: "I have
 * taught this section for years" is a work claim and VOICE.md allows one, while
 * "holds a graduate degree from a top-five programme" is a credential claim
 * with no VERIFIED row behind it.
 */
const CREDENTIAL_NOUN =
  /\b(?:undergraduate|postgraduate|graduate work|doctorate|doctoral|ph\.?d|d\.?phil|alma mater|ivy league|oxbridge|harvard|oxford|yale|princeton|stanford|cambridge|top[-\s]?(?:five|ten|twenty)|russell group|pedigree|credentials?|qualifications?)\b/i;

/**
 * A degree only counts as a credential when it is a qualification. "There is a
 * degree of guesswork until I see the work" is the comprehension and
 * comprehensive family again, on a word that comes up constantly in copy about
 * uncertainty, which is the copy this phase most wants.
 */
const CREDENTIAL_DEGREE =
  /\b(?:undergraduate|postgraduate|graduate|doctoral|masters?|bachelors?)\s+degrees?\b|\bdegrees?\s+(?:from|in|at)\b/i;

/**
 * An institution referred to without being named. "my own days at a very
 * selective college" makes the claim and leaves the name out, which is exactly
 * what a token-keyed pattern cannot see.
 */
const UNNAMED_INSTITUTION =
  /\b(?:my|his|her|their)\s+(?:own\s+)?(?:days|years|time)\s+at\b|\b(?:very\s+)?(?:selective|competitive|prestigious|elite|well[-\s]known|highly[-\s]ranked|top)\s+(?:college|university|school|programme|program|institution)\b/i;

/**
 * The same claim made as a possession rather than a place: "Cole's academic
 * background", "his training". Separate from the noun list so each can be
 * broken on its own in a probe.
 */
const CREDENTIAL_POSSESSIVE =
  /\b(?:his|her|their|my|cole(?:'|’)s)\s+(?:academic\s+|educational\s+|professional\s+)?(?:background|training|education|schooling)\b/i;

const CREDENTIAL_VERB =
  /\b(?:holds?|held|earned|received|did|completed|studied|read|reading|trained|educated|schooled|matriculated|graduated|attended|lectured|taught|teaches|worked)\b/i;

const INSTITUTION_NOUN =
  /\b(?:universit(?:y|ies)|institute|academy|conservatoire|business school|law school|medical school|programme|program|faculty)\b/i;

/** What a reply might offer to help with. */
const SUBJECT_NOUNS = [
  "College Counseling",
  "Essay Writing",
  "SAT Reading",
  "SAT Math",
  "SAT Writing",
  "ACT Math",
  "ACT English",
  "ACT Science",
  "ACT Reading",
  "ACT",
  "English",
  "Mathematics",
  "Maths",
  "Math",
  "Algebra",
  "Geometry",
  "Calculus",
  "Trigonometry",
  "Statistics",
  "Physics",
  "Chemistry",
  "Biology",
  "Science",
  "History",
  "Economics",
  "Spanish",
  "French",
  "Latin",
  "Computer Science",
  "Coding",
];

const OFFER_VERB =
  /\b(?:teach|teaches|teaching|tutor|tutors|tutoring|cover|covers|covering|help(?:s|ing)? with|work(?:s|ing)? on|prep(?:s|ping)? for|offer(?:s|ing)?|support|take a look at|look at|handle|do|take on|assist with|have a go at|run through|dig into|get into|sit with)\b/i;

/**
 * An offer with no boundary on it. "Whatever section she is weakest in, we can
 * work on it" is not an exotic phrasing, it is the warm sentence a model writes
 * when a parent sounds worried, and an unbounded offer includes the subjects
 * F-005 excludes.
 */
const OPEN_ENDED_OFFER =
  /\b(?:whatever|whichever|any)\s+(?:section|subject|area|part|topic|paper|test)\b|\bwhatever (?:she|he|they|you) (?:is|are|needs?|struggles?)\b|\banything (?:she|he|they|you) needs?\b|\bwhatever is weakest\b/i;

/**
 * A refusal names plainly what Cole does not do, which is what VOICE.md asks
 * for and what keeps a reply trustworthy. Three ways to recognise one:
 *
 *   a negator anywhere up to the later of the subject and the offer, so
 *   "SAT Math is not something I take on" reads the same as "I do not tutor
 *   SAT Math";
 *
 *   a word that declines outright, for the sentences with no negator at all
 *   like "Chemistry is outside what I do";
 *
 *   and neither counts when an adversative turns the sentence back round, so
 *   "Math is not my main area but I can take a look at it" is still an offer.
 */
const DECLINE_WORD =
  /\b(?:outside|beyond|elsewhere|someone else|another tutor|out of scope|not my area|refer you)\b/i;

const ADVERSATIVE = /\b(?:but|however|though|although|still|that said)\b/i;

function isRefusal(
  sentence: string,
  subjectIndex: number,
  offerIndex: number,
): boolean {
  const decline = DECLINE_WORD.exec(sentence);
  const limit = Math.max(subjectIndex, offerIndex);
  NEGATOR.lastIndex = 0;
  const negator = [...sentence.matchAll(NEGATOR)].find(
    (match) => match.index !== undefined && match.index <= limit,
  );
  const marker = negator ?? decline;
  if (!marker || marker.index === undefined) return false;
  // An adversative between the refusal and the offer takes it back.
  const turn = ADVERSATIVE.exec(sentence.slice(marker.index, offerIndex));
  return !turn;
}

const SATISFACTION_CLAIM =
  /\b(?:are|is|will be|tend to be|end up)\s+(?:usually\s+|often\s+|generally\s+|very\s+|really\s+)?(?:delighted|thrilled|pleased|happy|glad)\b/i;

const THIRD_PARTY_ATTESTATION =
  /\b(?:most|many|other|plenty of|a lot of)\s+(?:families|parents|students|clients|people)\s+(?:tell|told|say|said|report|find|found)\b/i;

const ATTESTED_BENEFIT =
  /\b(?:difference|results?|change|improvement|progress|movement|pays? off|shows? up|worth it|works)\b/i;

const EXPECTATION =
  /\byou (?:can|should) expect\b|\bexpect (?:the|her|his|him|them|it|things) to\b|\byou will (?:see|find|notice|get)\b|\b(?:it|things|the pacing) will click\b/i;

const FUTURE_STATE =
  /\b(?:should|will|ought to)\s+(?:be\s+)?(?:comfortably\s+|well\s+|right\s+)?(?:be\s+)?(?:where|what|there|ready|set|fine|solid|in good shape)\b|\bwhere (?:she|he|they|you) wants? to be\b|\bin a (?:much )?(?:better|stronger) place\b/i;

const NEGATOR =
  /\b(?:not|never|no|none|nothing|nobody|no one|cannot|can't|can not|won't|will not|unable|isn't|aren't|doesn't|don't|didn't|refuse|avoid)\b/gi;

function negatedBefore(sentence: string, claimIndex: number): boolean {
  NEGATOR.lastIndex = 0;
  for (const match of sentence.matchAll(NEGATOR)) {
    if (match.index !== undefined && match.index < claimIndex) return true;
  }
  return false;
}

function excerpt(sentence: string): string {
  return sentence.length <= 120 ? sentence : `${sentence.slice(0, 117)}...`;
}

function everyFigureSupported(sentence: string, facts: FactsRegister): boolean {
  const figures = checkableFigures(sentence);
  return (
    figures.length > 0 &&
    figures.every((figure) =>
      facts.supportedFigures.has(normalizeFigure(figure)),
    )
  );
}

/* The gate ---------------------------------------------------------------- */

export function topicGate(
  sentence: string,
  facts: FactsRegister,
): TopicIssue[] {
  const issues: TopicIssue[] = [];
  const add = (rule: string, reason: string, evidence: string) =>
    issues.push({ rule, reason, evidence });
  const blocked = new Set(facts.blockedIds);

  /* Cole's education and credentials.
   *
   * No credential row in FACTS.md is VERIFIED, so there is nothing for a claim
   * here to trace to. Every sentence on this topic fails, whichever
   * institution it names or declines to name. */
  if (facts.credentialsBlocked) {
    const noun = CREDENTIAL_NOUN.exec(sentence);
    const qualification = CREDENTIAL_DEGREE.exec(sentence);
    const unnamed = UNNAMED_INSTITUTION.exec(sentence);
    const possessive = CREDENTIAL_POSSESSIVE.exec(sentence);
    const verbAndPlace =
      CREDENTIAL_VERB.test(sentence) && INSTITUTION_NOUN.exec(sentence);
    const marker =
      noun ?? qualification ?? unnamed ?? possessive ?? verbAndPlace;
    if (marker) {
      add(
        "topic.credentials",
        "FACTS.md holds no VERIFIED credential row, so no claim about Cole's education or qualifications may appear. Omit it rather than rephrasing it",
        marker[0],
      );
    }
  }

  /* Wright cost.
   *
   * C-001 blocks the tuition figure and the whole award ladder denominated on
   * it, so no Wright cost claim can be verified at any price, in digits or in
   * words or as a range. */
  if (blocked.has("C-001") && /\bwright\b/i.test(sentence)) {
    const cost =
      COST_TOPIC.exec(sentence) ??
      COST_QUALITY.exec(sentence) ??
      AMOUNT_TOPIC.exec(sentence);
    if (cost && !everyFigureSupported(sentence, facts)) {
      add(
        "topic.wright-cost",
        "FACTS.md C-001 blocks Wright tuition and every rung of the ladder denominated on it. There is no verified figure to state",
        excerpt(sentence),
      );
    }
  }

  /* Application dates.
   *
   * C-003 blocks the scholarship schedule and C-006 blocks the Wright dates, so
   * an application deadline has no verified source whether or not the sentence
   * names which programme it means. */
  if (blocked.has("C-003") || blocked.has("C-006")) {
    const application = APPLICATION_WORD.exec(sentence);
    if (application && DATE_CLAIM.test(sentence)) {
      add(
        "topic.application-dates",
        "FACTS.md C-003 and C-006 block the scholarship schedule and the Wright dates. No application deadline may be stated or estimated",
        excerpt(sentence),
      );
    }
  }

  /* Scholarship value and structure.
   *
   * F-002 verifies that the scholarship is merit only with no application fee,
   * and nothing else. C-002 and C-004 block its value and award structure, so a
   * sentence naming an amount fails unless every figure in it is verified. */
  if (blocked.has("C-002") || blocked.has("C-004")) {
    const award =
      /\b(?:scholarships?|awards?|fellowships?|bursar(?:y|ies))\b/i.exec(
        sentence,
      );
    // The student's own award is not ours. "Her award for the debate season"
    // belongs to the prospect and C-002 has nothing to say about it, while
    // "the award" with no owner means the one this register blocks.
    const theirs =
      award !== null &&
      /\b(?:her|his|their|your|my)\s+(?:\w+\s+){0,2}(?:awards?|prizes?)\b/i.test(
        sentence,
      ) &&
      !/\b(?:scholarship|whetstone|fellowship)\b/i.test(sentence);
    const value =
      AMOUNT_TOPIC.exec(sentence) ??
      /\b(?:worth|value|valued|up to|covers?|full|partial|how much|money|life[-\s]changing|substantial|significant|meaningful sum)\b/i.exec(
        sentence,
      ) ??
      /\b(?:goes? to|awarded? to|available to|recipients?|winners?|students?|families?|teams?|places?|spots?|seats?)\b/i.exec(
        sentence,
      );
    if (award && !theirs && value && !everyFigureSupported(sentence, facts)) {
      add(
        "topic.scholarship-terms",
        "FACTS.md C-002 and C-004 block the scholarship value and award structure. F-002 verifies only that it is merit based with no application fee",
        excerpt(sentence),
      );
    }
  }

  /* The published rules.
   *
   * C-005 blocks the draft terms, which label themselves unreviewed by
   * counsel, so a sentence resting on what they explain rests on nothing. */
  if (blocked.has("C-005")) {
    const rules = /\b(?:rules|terms(?: and conditions)?)\b/i.exec(sentence);
    const explains =
      /\b(?:explains?|says?|states?|sets? out|describes?|covers?|confirms?|spell out|spells out)\b/i.exec(
        sentence,
      );
    if (rules && explains) {
      add(
        "topic.draft-terms",
        "FACTS.md C-005 blocks the draft scholarship terms, which are unreviewed by counsel. Nothing may rest on what they say",
        excerpt(sentence),
      );
    }
  }

  /* Any price at all.
   *
   * There is no rate row in FACTS.md. Until the owner adds one, a sentence that
   * prices anything has nothing to trace to. */
  const quality = COST_QUALITY.exec(sentence);
  if (quality && !everyFigureSupported(sentence, facts)) {
    add(
      "topic.price",
      "FACTS.md verifies no rate, so no price may be described in relative terms either",
      excerpt(sentence),
    );
  } else {
    const cost = COST_TOPIC.exec(sentence);
    if (cost) {
      const amount =
        AMOUNT_TOPIC.exec(sentence) ??
        /\b(?:steep|range|ballpark|order of)\b/i.exec(sentence);
      if (amount && !everyFigureSupported(sentence, facts)) {
        add(
          "topic.price",
          "FACTS.md verifies no rate, so no price may be stated, estimated or described as a range",
          excerpt(sentence),
        );
      }
    }
  }

  /* What Cole teaches.
   *
   * F-005 approves exactly four subjects. A sentence offering help with
   * anything else misstates his platform approvals, however softly it is put. */
  const offer = OFFER_VERB.exec(sentence);
  if (offer) {
    const openEnded = OPEN_ENDED_OFFER.exec(sentence);
    if (openEnded && !isRefusal(sentence, openEnded.index, offer.index)) {
      add(
        "topic.subject-offered",
        `FACTS.md F-005 approves exactly ${facts.approvedSubjects.join(", ")}. An offer with no boundary on it includes the subjects F-005 excludes`,
        openEnded[0],
      );
    }
    for (const subject of mentionedSubjects(sentence)) {
      const approved = facts.approvedSubjects.some(
        (candidate) => candidate.toLowerCase() === subject.toLowerCase(),
      );
      if (approved) continue;
      const index = sentence.toLowerCase().indexOf(subject.toLowerCase());
      if (isRefusal(sentence, index, offer.index)) continue;
      add(
        "topic.subject-offered",
        `FACTS.md F-005 approves exactly ${facts.approvedSubjects.join(", ")}. Offering ${subject} misstates what Cole can take`,
        subject,
      );
      break;
    }
  }

  /* A future state is an outcome claim without an outcome noun in it. */
  const attestation = THIRD_PARTY_ATTESTATION.exec(sentence);
  if (attestation && ATTESTED_BENEFIT.test(sentence)) {
    add(
      "topic.outcome-attestation",
      "an outcome other families are said to have had is still an outcome claimed",
      excerpt(sentence),
    );
  }

  const future =
    FUTURE_STATE.exec(sentence) ??
    SATISFACTION_CLAIM.exec(sentence) ??
    EXPECTATION.exec(sentence);
  if (future && !negatedBefore(sentence, future.index)) {
    add(
      "topic.future-state",
      "no promised outcomes, and a described future state is a promise with the noun taken out",
      excerpt(sentence),
    );
  }

  return issues;
}

/**
 * Subjects named in the sentence, longest first so "SAT Reading" is recognised
 * before the bare "Reading" inside it.
 */
export function mentionedSubjects(sentence: string): string[] {
  const found: string[] = [];
  let remaining = sentence;
  for (const subject of [...SUBJECT_NOUNS].sort(
    (left, right) => right.length - left.length,
  )) {
    const pattern = new RegExp(`\\b${subject.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(remaining)) {
      found.push(subject);
      remaining = remaining.replace(pattern, " ");
    }
  }
  return found;
}
