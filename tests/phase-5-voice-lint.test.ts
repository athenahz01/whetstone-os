import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseFactsRegister } from "../lib/core/facts";
import { voiceLint, type VoiceLintInput } from "../lib/core/voice";

const facts = parseFactsRegister(
  await readFile(new URL("../docs/FACTS.md", import.meta.url), "utf8"),
);

const DISQUALIFIER =
  "I cannot promise a particular score, and four weeks is a short runway if her baseline is far from her target.";
const ASK =
  "Would a session this week be useful to see where she is losing points?";

/**
 * A legitimate Wyzant reply that lints clean. Every case below changes one
 * thing about it, so a failure names the change rather than the draft.
 */
function draft(substance?: string): VoiceLintInput {
  const middle =
    substance ??
    "The sets that trip students up are the paired passages, where the questions ask you to hold two arguments side by side.";
  const body = [
    "Thanks for asking about SAT Reading for your daughter before the November test.",
    middle,
    "I would start with two timed passage sets a week, then review only the questions she got wrong. If she is losing points on timing rather than vocabulary, that is the fix.",
    `One thing to be honest about: ${DISQUALIFIER}`,
    ASK,
  ].join("\n\n");
  return {
    body,
    channel: "wyzant-inquiry-reply",
    disqualifier: DISQUALIFIER,
    ask: ASK,
    sourceDetails: ["SAT Reading", "November"],
    facts,
  };
}

function rules(input: VoiceLintInput): string[] {
  return voiceLint(input).map((issue) => issue.rule);
}

describe("voiceLint: the draft it is built around", () => {
  it("passes a legitimate Wyzant reply with nothing flagged", () => {
    expect(voiceLint(draft())).toEqual([]);
  });
});

/**
 * One row per ban, using the phrasing a drafting model would actually reach
 * for. Substituted into the substance paragraph so the rest of the draft, and
 * its word count, stay valid.
 */
const MUST_BLOCK: [string, string][] = [
  [
    "positioning.consultation",
    "I offer a free consultation before we begin any work together.",
  ],
  [
    "positioning.ikigai",
    "We start with an ikigai exercise to find what she actually wants.",
  ],
  [
    "positioning.common-app",
    "We would tear down her Common App essay line by line together.",
  ],
  [
    "positioning.capstone",
    "The capstone she builds becomes the centre of her application.",
  ],
  [
    "positioning.first-come-first-served",
    "Places are first come first served, so it is worth deciding soon.",
  ],
  [
    "positioning.youll-get-a-spot",
    "Apply this week and you'll get a spot in the autumn group.",
  ],
  [
    "blocked.wright-tuition",
    "Wright tuition is a separate question from tutoring, and worth raising.",
  ],
  [
    "blocked.scholarship-terms",
    "The scholarship deadline falls before her test date, so plan around it.",
  ],
  [
    "blocked.draft-terms",
    "Per the terms, families may hold their place until decisions are made.",
  ],
  [
    "blocked.wright-dates",
    "Wright applications open shortly and I can flag it when they do.",
  ],
  [
    "blocked.harvard-oxford-credential",
    "Cole, a Harvard graduate, has read a great many of these essays.",
  ],
  [
    "blocked.unapproved-subject",
    "I also tutor SAT Math, so we could cover both sections together.",
  ],
  [
    "promise.outcome",
    "With four weeks of this she will likely see her score improve.",
  ],
  [
    // An outcome noun with a movement verb and no hedge word at all, so only
    // the movement clause can catch it.
    "promise.outcome",
    "Scores improve once the pacing habit improves, in my experience of it.",
  ],
  [
    "reservation.language",
    "I have reserved a seat for her in the Tuesday evening group.",
  ],
  [
    "ban.delve",
    "We would delve into the argument structure of each paired passage.",
  ],
  [
    "ban.its-worth-noting",
    "It's worth noting that the paired passages carry the most weight.",
  ],
  [
    "ban.at-the-end-of-the-day",
    "At the end of the day the paired passages are what decide the section.",
  ],
  [
    "ban.i-wanted-to-reach-out",
    "I wanted to reach out because your message mentioned the timing.",
  ],
  [
    "ban.multifaceted",
    "Reading is a multifaceted skill and the section tests all of it.",
  ],
  ["ban.nuanced", "Her answer choices need a more nuanced reading of tone."],
  [
    "ban.tapestry",
    "The section weaves a tapestry of argument, tone and evidence.",
  ],
  [
    "ban.comprehensive",
    "I would run a comprehensive review of every question type first.",
  ],
  [
    "ban.leverage-buzzword",
    "We can leverage her strength in tone questions across the section.",
  ],
  [
    "ban.i-hope-this-helps",
    "I hope this helps as you decide what to do about the November test.",
  ],
  [
    "ban.thats-what-the-essay-is-for",
    "She should not explain that in the profile, that's what the essay is for.",
  ],
  [
    "ban.happy-to-send",
    "I am happy to send a sample passage set over before we speak.",
  ],
  [
    "ban.bare-superlative",
    "Timed passage work is the best thing she could do this month.",
  ],
  [
    "ban.thats-more-than-most-applicants-have",
    "She already has two strong drafts, that's more than most applicants have.",
  ],
  [
    "ban.thats-good-for-a-sophomore",
    "A first score in that range, that's good for a sophomore.",
  ],
  [
    "ban.thats-impressive-for-your-age",
    "Reading at that level, that's impressive for your age.",
  ],
  [
    "ban.most-students-dont-have-this",
    "She has a real reading habit and most students don't have this.",
  ],
  [
    "ban.the-thing-that-could-derail",
    "Her timing is the thing that could derail this whole profile.",
  ],
  [
    "ban.which-shows",
    "She annotates before answering, which shows she is reading closely.",
  ],
  [
    "ban.which-signals",
    "She rereads the stem first, which signals real care with the question.",
  ],
  [
    "ban.thats-the-kind-of",
    "She checks her own reasoning, that's the kind of habit that holds up.",
  ],
  [
    "voice.comparative-ranking",
    "Her baseline is already stronger than most students I see this year.",
  ],
  [
    "voice.auto-send-implication",
    "I have sent the plan across and it has been approved on our side.",
  ],
  [
    "voice.off-platform",
    "You can text me directly and we can arrange the times that way.",
  ],
  [
    "facts.unsupported-figure",
    "The full programme runs to $4,500 across the whole autumn term.",
  ],
  [
    "facts.unsupported-price",
    "The whole autumn block costs about two thousand, payable up front.",
  ],
  [
    // Tuition without naming Wright, so only the tuition word itself catches it.
    "blocked.wright-tuition",
    "The tuition question is a separate one and not mine to answer here.",
  ],
];

describe("voiceLint: must block", () => {
  for (const [rule, substance] of MUST_BLOCK) {
    it(`blocks ${rule}: ${substance}`, () => {
      const found = rules(draft(substance));
      expect(found, substance).toContain(rule);
      // The case must fail for its own reason, not because the substitution
      // pushed the draft out of its word bound.
      expect(found, substance).not.toContain("length.out-of-bounds");
    });
  }

  it("gives every case a distinct phrasing, and some rules more than one", () => {
    const phrasings = new Set(MUST_BLOCK.map(([, substance]) => substance));
    expect(phrasings.size, "two rows share a phrasing").toBe(MUST_BLOCK.length);
    // A rule reached by more than one route needs a case per route, which is
    // why the rule ids are not unique here. blocked.wright-tuition has three.
    const covered = new Set(MUST_BLOCK.map(([rule]) => rule));
    expect(covered.size).toBeGreaterThanOrEqual(38);
  });
});

/**
 * Legitimate copy that sits next to a ban. A lint that eats these bounces every
 * draft, which is the same failure as letting a ban through.
 */
const MUST_PASS: [string, string][] = [
  [
    "comprehension is not comprehensive",
    "Her reading comprehension is steady, so the gap is pace rather than understanding.",
  ],
  [
    "financial leverage is not the buzzword",
    "Financial leverage is not something we advise on, so I will stay off that ground.",
  ],
  [
    "a superlative with a stated basis",
    "Based on the timings you described, the best use of this month is paired passages.",
  ],
  [
    "one link is allowed",
    "The passage sets I use are listed at https://example.org/sat-reading for reference.",
  ],
  [
    "a hyphen is not an em dash",
    "We would work on paired-passage timing, which is the low-hanging piece here.",
  ],
  [
    "reserved time is not a held seat",
    "I have reserved time on Tuesday evenings this month if that suits her.",
  ],
  [
    "an honest non-promise about a score",
    "No one can promise a score, and I would rather say that plainly up front.",
  ],
  [
    "declining an unapproved subject",
    "I do not tutor SAT Math, so I would not be the right person for that half.",
  ],
  [
    "a verified figure",
    "The one prize figure I can state is the $5,000 Wright demo day award.",
  ],
  [
    "nuance is not nuanced",
    "There is some nuance in how the tone questions are worded each year.",
  ],
  [
    "a session is the approved word for the offer",
    "A session with the founders is a different thing from ordinary tutoring.",
  ],
  [
    "selecting is the approved framing",
    "We are selecting a small number of families, so I will be straight with you.",
  ],
  [
    "the scholarship named without its value or dates",
    "The scholarship is merit only, and I am not the person who decides it.",
  ],
  [
    "an approved subject offered plainly",
    "I tutor SAT Reading and Essay Writing, which is where I would be useful.",
  ],
];

describe("voiceLint: must pass", () => {
  for (const [name, substance] of MUST_PASS) {
    it(`allows ${name}: ${substance}`, () => {
      expect(voiceLint(draft(substance)), substance).toEqual([]);
    });
  }
});

/**
 * The phrasings a model actually reaches for when told to avoid a blocked
 * subject: hedged, partial and paraphrased rather than quoted. Eight of these
 * thirteen went straight through the first version of this lint.
 */
const ATTACKS: [string, string, string][] = [
  [
    "blocked.wright-tuition",
    "Wright tuition spelled out rather than written as a figure",
    "The Wright programme costs five and a half thousand for the term.",
  ],
  [
    "blocked.wright-tuition",
    "Wright cost with no cost word at all",
    "Wright runs about fifty five hundred, which is separate from tutoring.",
  ],
  [
    "blocked.wright-tuition",
    "Wright cost as a fee rather than tuition",
    "The Wright fee is worth asking about separately from this.",
  ],
  [
    "blocked.scholarship-terms",
    "scholarship timing as a closing date",
    "The scholarship closes at the end of next month, so it is worth moving.",
  ],
  [
    "blocked.scholarship-terms",
    "scholarship timing as an opening date",
    "The scholarship opens soon and she would be a strong candidate for it.",
  ],
  [
    "blocked.scholarship-terms",
    "scholarship value without a figure",
    "The scholarship is worth a substantial amount toward her first year.",
  ],
  [
    "blocked.harvard-oxford-credential",
    "the credential as a league rather than a name",
    "Cole is an Ivy League graduate who has read many of these essays.",
  ],
  [
    "blocked.credential-claim",
    "the credential as a city rather than a name",
    "Cole studied at Cambridge, Massachusetts before he began teaching.",
  ],
  [
    "blocked.credential-claim",
    "a different institution entirely, still unverified",
    "Cole holds a degree from Princeton and has taught for a decade.",
  ],
  [
    "blocked.harvard-oxford-credential",
    "the credential as an adjective",
    "Cole brings an Oxford-trained eye to argument structure in essays.",
  ],
  [
    "promise.outcome",
    "an outcome hedged as a tendency",
    "Students who do this work tend to see their scores move by November.",
  ],
  [
    "promise.probability",
    "a probability offered as a personal estimate",
    "I would put her chances of hitting that target fairly high, honestly.",
  ],
  [
    "blocked.unapproved-subject",
    "an unapproved test offered as help rather than as tutoring",
    "I can also help with the ACT if that is the better test for her.",
  ],
];

describe("voiceLint: hedged, partial and paraphrased attacks", () => {
  for (const [rule, name, substance] of ATTACKS) {
    it(`blocks ${rule} via ${name}`, () => {
      expect(rules(draft(substance)), substance).toContain(rule);
    });
  }
});

describe("voiceLint: the near misses each ban is drawn against", () => {
  it("blocks two links while allowing one", () => {
    expect(
      rules(
        draft(
          "See https://example.org/one and https://example.org/two for the sets.",
        ),
      ),
    ).toContain("format.link-count");
  });

  it("blocks an em dash and an en dash separately", () => {
    expect(
      rules(draft("Her pace is the issue — not her understanding.")),
    ).toContain("format.em-dash");
    expect(
      rules(draft("Her pace is the issue – not her understanding.")),
    ).toContain("format.en-dash");
  });

  it("blocks a draft under and over its channel bound", () => {
    const short = draft();
    expect(
      rules({ ...short, body: `Short. ${DISQUALIFIER} ${ASK}` }),
    ).toContain("length.out-of-bounds");
    const long = draft();
    expect(
      rules({
        ...long,
        body: `${long.body} ${"more words to run long. ".repeat(20)}`,
      }),
    ).toContain("length.out-of-bounds");
  });

  it("blocks a missing disqualifier, and one declared but absent from the body", () => {
    expect(rules({ ...draft(), disqualifier: "  " })).toContain(
      "structure.missing-disqualifier",
    );
    expect(
      rules({ ...draft(), disqualifier: "A limitation nobody wrote down." }),
    ).toContain("structure.missing-disqualifier");
  });

  it("blocks an ask that is not a question even when it is in the body", () => {
    const statement = "Let me know if you want to book a session.";
    const base = draft();
    expect(
      rules({
        ...base,
        ask: statement,
        body: base.body.replace(ASK, statement),
      }),
    ).toContain("structure.ask-not-a-question");
  });

  it("blocks an ask that is a question but absent from the body", () => {
    expect(
      rules({ ...draft(), ask: "Shall we start on Tuesday instead?" }),
    ).toContain("structure.ask-not-a-question");
  });

  it("blocks a draft that refers to no detail from the source message", () => {
    expect(
      rules({
        ...draft(),
        sourceDetails: ["a detail the draft never mentions"],
      }),
    ).toContain("structure.missing-source-detail");
  });

  it("blocks a credential claimed twice while allowing it once", () => {
    expect(
      rules(
        draft(
          "I have taught this section for years, and I have taught the paired sets in particular.",
        ),
      ),
    ).toContain("credential.repeated");
    expect(
      voiceLint(
        draft("I have taught this section for years and know the traps."),
      ),
    ).toEqual([]);
  });
});
