import { describe, expect, it, vi } from "vitest";
import { loadAgentContext } from "../lib/core/context";
import { parseFactsRegister } from "../lib/core/facts";
import {
  buildQaPrompt,
  ClaudeQaReviewer,
  DeterministicOutreachAgent,
  OUTREACH_QA_RULES,
  outreachVoiceGate,
  QA_BLOCK_RULE_INDEXES,
  renderOutreachDraft,
  sourceEcho,
  type OutreachDraft,
} from "../lib/core/outreach";
import type {
  OutreachDraftRepository,
  SavedOutreachDraft,
} from "../lib/core/outreach-store";
import { contradictedAbsences, sourceSupplies } from "../lib/core/source-truth";
import type { Lead } from "../lib/core/types";
import { voiceLint, type VoiceLintInput } from "../lib/core/voice";
import { runWorkflow } from "../lib/core/workflow";
import { createDraftWorkflow } from "../lib/workflows/s3-draft";
import { MemoryRunStore } from "./run-helpers";

const context = await loadAgentContext();
const facts = parseFactsRegister(context.documents["FACTS.md"]);

const DISQUALIFIER =
  "I cannot promise a particular score, and four weeks is a short runway if her baseline is far from her target.";
const ASK =
  "Would a session this week be useful to see where she is losing points?";

function draft(substance?: string): VoiceLintInput {
  const middle =
    substance ??
    "The sets that trip students up are the paired passages, where the questions ask you to hold two arguments side by side.";
  return {
    body: [
      "Thanks for asking about SAT Reading for your daughter before the November test.",
      middle,
      "I would start with two timed passage sets a week, then review only the questions she got wrong. If she is losing points on timing rather than vocabulary, that is the fix.",
      `One thing to be honest about: ${DISQUALIFIER}`,
      ASK,
    ].join("\n\n"),
    channel: "wyzant-inquiry-reply",
    disqualifier: DISQUALIFIER,
    ask: ASK,
    sourceDetails: ["SAT Reading", "November"],
    facts,
  };
}

function rules(substance: string): string[] {
  return voiceLint(draft(substance)).map((issue) => issue.rule);
}

/**
 * The audit's seventeen paraphrase attacks, nine of which walked through the
 * word patterns. Every one of these keeps the claim and drops the token the
 * pattern was keyed on, which is why the topic gate exists.
 */
const AUDIT_ATTACKS: [string, string, string][] = [
  [
    "topic.wright-cost",
    "Wright cost as a euphemism",
    "Wright is not cheap, but the investment is in the four-figure range.",
  ],
  [
    "topic.application-dates",
    "a deadline hedged, with no scholarship token",
    "I believe applications are due around the middle of September.",
  ],
  [
    "topic.scholarship-terms",
    "a scholarship value hedged into words",
    "The award is worth somewhere in the low tens of thousands.",
  ],
  [
    "topic.credentials",
    "Harvard as a city rather than a name",
    "Cole did his undergraduate work in Cambridge, in Massachusetts.",
  ],
  [
    "topic.credentials",
    "Oxford as a description rather than a name",
    "Cole spent two years reading at an ancient English university.",
  ],
  [
    "topic.credentials",
    "a credential naming no institution at all",
    "Cole holds a graduate degree from a top-five programme.",
  ],
  [
    "topic.subject-offered",
    "an unapproved subject softened into an offer",
    "Math is not my main area but I can take a look at it.",
  ],
  [
    "promise.outcome",
    "an outcome hedged into a tendency about others",
    "Students in her position often see meaningful movement by November.",
  ],
  [
    "topic.future-state",
    "an outcome implied as a future state",
    "By November she should be comfortably where she wants to be.",
  ],
];

/**
 * My own, written after the topic gate existed, aimed at where the next
 * auditor would probe it. Eight of these ten went through the first version of
 * the gate.
 */
const NEW_ATTACKS: [string, string, string][] = [
  [
    "topic.wright-cost",
    "a Wright cost with no cost noun in the sentence",
    "What Wright runs to is a conversation for another day entirely.",
  ],
  [
    "topic.scholarship-terms",
    "a scholarship value in colloquial terms",
    "The scholarship is life changing money for the family that wins it.",
  ],
  [
    "topic.credentials",
    "a credential as a quality rather than a place",
    "Cole has the academic pedigree you would want behind this work.",
  ],
  [
    "topic.credentials",
    "a credential as a possession",
    "Cole's academic background is not in any doubt whatsoever here.",
  ],
  [
    "topic.credentials",
    "taught at a place rather than studied at one",
    "Cole taught at a well known university before he began this work.",
  ],
  [
    "topic.subject-offered",
    "an unapproved subject offered casually",
    "I could certainly have a go at the algebra with her if that helps.",
  ],
  [
    "topic.future-state",
    "an outcome asserted about other families",
    "Families in your position are usually delighted by the spring term.",
  ],
  [
    "topic.price",
    "a price stated as a market position",
    "We are not the cheapest option in the city, but the hour is used well.",
  ],
  [
    "topic.application-dates",
    "a deadline as a metaphor",
    "It is worth applying before the window shuts at the end of the month.",
  ],
  [
    "blocked.wright-dates",
    "a Wright date as a cohort start",
    "The Wright cohort starts in the new year, so there is time to prepare.",
  ],
  [
    // The other route into topic.price: a cost noun with a spelled-out amount,
    // rather than a qualitative claim with no figure at all.
    "topic.price",
    "a price as a cost noun with a spelled-out amount",
    "The hourly rate comes to a little over two hundred for the whole block.",
  ],
  [
    "topic.price",
    "a price with no cost noun, only an idiom",
    "The block of sessions works out to about two thousand across the term.",
  ],
];

/**
 * The second audit round. Every one falls inside a topic that already existed,
 * so each extends that topic's own detection rather than adding a word list
 * beside it.
 */
const ROUND_TWO_ATTACKS: [string, string, string][] = [
  [
    "topic.scholarship-terms",
    "the Whetstone award structure with no value word",
    "The Whetstone award goes to two students.",
  ],
  [
    "topic.price",
    "a price introduced by the verb invest",
    "Families invest around three hundred a session.",
  ],
  [
    "topic.credentials",
    "an institution referred to without being named",
    "I have been doing this since my own days at a very selective college.",
  ],
  [
    "topic.subject-offered",
    "an offer with no boundary, which includes what F-005 excludes",
    "Whatever section she is weakest in, we can work on it together.",
  ],
  [
    "topic.outcome-attestation",
    "an outcome attested by other families",
    "Most families tell me the difference shows up within a month.",
  ],
  [
    "topic.future-state",
    "an outcome set as an expectation",
    "You can expect the pacing to click well before the test itself.",
  ],
  [
    "topic.price",
    "a spend stated as a range with no figure",
    "Most families spend a few hundred over a term of weekly work.",
  ],
  [
    "topic.draft-terms",
    "a claim resting on what the published rules explain",
    "The published rules explain how places are confirmed each year.",
  ],
  [
    // A qualification with no famous name, no ranking and no institution, so
    // only the degree clause can catch it.
    "topic.credentials",
    "a degree named as a subject rather than a place",
    "Cole earned his degree in classics before he began teaching this work.",
  ],
];

describe("topic gate: paraphrase must block", () => {
  for (const [rule, name, substance] of [
    ...AUDIT_ATTACKS,
    ...NEW_ATTACKS,
    ...ROUND_TWO_ATTACKS,
  ]) {
    it(`blocks ${rule} via ${name}`, () => {
      const found = rules(substance);
      expect(found, substance).toContain(rule);
      expect(found, substance).not.toContain("length.out-of-bounds");
    });
  }

  it("covers every hard block with at least one paraphrase attack", () => {
    const covered = new Set(
      [...AUDIT_ATTACKS, ...NEW_ATTACKS, ...ROUND_TWO_ATTACKS].map(
        ([rule]) => rule,
      ),
    );
    for (const rule of [
      "topic.outcome-attestation",
      "topic.draft-terms",
      "topic.credentials",
      "topic.wright-cost",
      "topic.scholarship-terms",
      "topic.application-dates",
      "topic.subject-offered",
      "topic.price",
      "topic.future-state",
    ]) {
      expect(covered, rule).toContain(rule);
    }
  });
});

/**
 * The must-pass table is as binding as the must-block table. A topic gate that
 * fails safe on everything is the Phase 4 failure wearing a different hat.
 */
const MUST_PASS: [string, string][] = [
  [
    "comprehensiveness survives comprehensive",
    "The comprehensiveness of her notes is not the problem here at all.",
  ],
  [
    "experience is not an institutional credential",
    "I have taught this section for years and know where the traps are.",
  ],
  [
    "an hour with the founders, with no amount attached",
    "An hour with the founders is a different conversation from ordinary tutoring.",
  ],
  [
    "the application named without a date claim",
    "We would look at how the application gets read, not at the form itself.",
  ],
  [
    "a guarantee that is refused rather than given",
    "I cannot guarantee anything about the outcome, and I would rather say so.",
  ],
  [
    "a verified award figure",
    "The demo day award is $5,000 to one winning team, which is public.",
  ],
  [
    "the prospect's own schools question, not a credential",
    "You are not sure which schools are realistic, and that is a fair question.",
  ],
  [
    "two approved subjects offered together",
    "We work on English and Essay Writing, which are two of the four I take.",
  ],
  [
    "an outcome noun that is negated",
    "Progress is not something I can predict, so I will not try to.",
  ],
  [
    "a hedge word with no outcome behind it",
    "The passages often reward slowing down before the first question.",
  ],
  [
    "a session, which is the approved word for the offer",
    "A session with the founders is a different thing from ordinary tutoring.",
  ],
  [
    "reading comprehension work, which is not a subject claim",
    "We would work on reading comprehension under timed conditions each week.",
  ],
  [
    "declining an unapproved subject honestly",
    "I do not tutor Math, so I would not be the right person for that half.",
  ],
  [
    "an approved subject offered plainly",
    "I do offer College Counseling, which is one of my four approved subjects.",
  ],
  [
    "the prospect's English described, not offered as a credential",
    "Her English is strong, so I would not spend the hour there at all.",
  ],
  [
    // The comprehension and comprehensive family again, on a word that comes
    // up constantly in copy about uncertainty.
    "a degree of guesswork is not a degree",
    "There is a degree of guesswork until I see the actual work she has done.",
  ],
  [
    "an hour invested, with no amount attached",
    "It is worth investing an hour a week rather than a marathon at the end.",
  ],
  [
    "an award that belongs to the student, not the scholarship",
    "Her award for the debate season is worth mentioning in the essay itself.",
  ],
  [
    "scheduling that survives the dates topic",
    "Are you free Tuesday, or would later in the week suit you better?",
  ],
  [
    "a plan across terms, with no price in it",
    "Across two terms we would move from timing to inference and back again.",
  ],
  [
    // F-007 was added to the register by the owner on 2026-08-27, so the rate
    // is now a VERIFIED claim and the price topic must let it through.
    "the rate F-007 verifies",
    "My rate is $400 per hour in person and $295 per hour online for this.",
  ],
  [
    "the free 30 minutes F-007 verifies, named rather than called a consultation",
    "The first 30 minutes are free so you can see whether it is worth it.",
  ],
];

/**
 * An honest refusal names plainly what Cole does not do. VOICE.md asks for it,
 * and a lint that blocks it teaches the agent to stay vague about scope, which
 * is the opposite of the goal. Six shapes, all of which must pass.
 */
const REFUSALS: string[] = [
  "I do not tutor SAT Math, so I would not be the right person for that half.",
  "Chemistry is outside what I do, so I would point you elsewhere entirely.",
  "SAT Math is not something I take on, so I would say that up front.",
  "I would not be the right person for the maths section of that test.",
  "That is outside my four approved subjects on here, so I will be plain.",
  "I only work on reading and writing, not the quantitative side of it.",
];

describe("topic gate: an honest refusal must pass", () => {
  for (const refusal of REFUSALS) {
    it(`allows the refusal: ${refusal}`, () => {
      expect(voiceLint(draft(refusal)), refusal).toEqual([]);
    });
  }

  it("still blocks the subject when an adversative turns the sentence round", () => {
    expect(
      rules("Math is not my main area but I can take a look at it for her."),
    ).toContain("topic.subject-offered");
  });
});

describe("topic gate: legitimate copy must pass", () => {
  for (const [name, substance] of MUST_PASS) {
    it(`allows ${name}: ${substance}`, () => {
      expect(voiceLint(draft(substance)), substance).toEqual([]);
    });
  }
});

/* The disqualifier must be true to the source ----------------------------- */

function leadWith(text: string, overrides: Partial<Lead> = {}): Lead {
  return {
    id: "qualified-prospect",
    channel: "wyzant",
    author: "Prospect",
    subject: "SAT Reading",
    text,
    url: "https://www.wyzant.com/tutor/jobs/qualified-prospect",
    postedAt: "2026-08-27T12:00:00.000Z",
    raw: {
      qualification: {
        verdict: "icp_pass",
        rationale: "The request satisfies the written ICP screen.",
        evidence: [{ ref: "ICP.md", observation: "Approved subject." }],
        confidence: 0.94,
        contextHash: context.hash,
      },
    },
    ...overrides,
  };
}

describe("the disqualifier is true to the source message", () => {
  it("reads each field from the prose, not only from a structured column", () => {
    const supplied = leadWith(
      "My daughter is a junior and keeps running out of time before the November test. We would prefer online sessions and a short call first.",
    );
    expect(sourceSupplies(supplied)).toEqual({
      timing: true,
      subject: true,
      grade: true,
      format: true,
      nextStep: true,
    });

    // The structured column is the other route in, and it has to work when the
    // prose says nothing.
    const columnOnly = leadWith("She needs help with reading.", {
      raw: { deadline: "2026-11-01" },
    });
    expect(sourceSupplies(columnOnly).timing).toBe(true);

    const bare = leadWith("She needs help with reading.", {
      subject: undefined,
    });
    expect(sourceSupplies(bare)).toMatchObject({
      timing: false,
      grade: false,
      format: false,
    });
  });

  it("does not claim the timing is missing when the message states it", async () => {
    const lead = leadWith(
      "My daughter keeps running out of time on the reading section before the November test.",
    );
    const built = await new DeterministicOutreachAgent().create({
      lead,
      context,
      channel: "wyzant-inquiry-reply",
      tutorId: "tutor-admissions",
    });
    expect(built.disqualifier).not.toContain("you have not said when");
    expect(
      outreachVoiceGate(built, facts, [sourceEcho(lead, facts)], lead).issues,
    ).toEqual([]);
  });

  it("still names a genuinely absent field", async () => {
    const lead = leadWith("She needs help with the reading section.");
    const built = await new DeterministicOutreachAgent().create({
      lead,
      context,
      channel: "wyzant-inquiry-reply",
      tutorId: "tutor-admissions",
    });
    expect(built.disqualifier).toContain("you have not said when");
  });

  it("refuses any draft claiming an absence the source contradicts", () => {
    const cases: [string, string][] = [
      [
        "timing",
        "you have not said when the test is, so I cannot judge the runway",
      ],
      [
        "grade",
        "I do not know what grade she is in, which changes the approach",
      ],
      ["format", "you have not said whether you want this online or in person"],
      [
        "subject",
        "you have not told me which subject this is about, which I would need",
      ],
    ];
    const lead = leadWith(
      "My daughter is a junior and keeps running out of time before the November test. We would prefer online sessions.",
    );
    for (const [field, claim] of cases) {
      const found = contradictedAbsences(
        `One thing to be straight: ${claim}.`,
        lead,
      );
      expect(
        found.map((issue) => issue.field),
        claim,
      ).toContain(field);
    }
  });

  it("surfaces a contradicted absence through the gate, not only in isolation", async () => {
    const lead = leadWith(
      "My daughter keeps running out of time on the reading section before the November test.",
    );
    const built = await new DeterministicOutreachAgent().create({
      lead,
      context,
      channel: "wyzant-inquiry-reply",
      tutorId: "tutor-admissions",
    });
    const contradicting = {
      ...built,
      plan: "",
      disqualifier:
        "One thing to be straight about: you have not said when the test is, so I cannot judge the runway.",
    };
    const gate = outreachVoiceGate(
      contradicting,
      facts,
      [sourceEcho(lead, facts)],
      lead,
    );
    expect(gate.issues.map((issue) => issue.rule)).toContain(
      "source.contradicted-absence",
    );
  });

  it("allows the same claim when the source really is silent", () => {
    const lead = leadWith("She needs help with the reading section.");
    expect(
      contradictedAbsences(
        "One thing to be straight: you have not said when the test is.",
        lead,
      ),
    ).toEqual([]);
  });
});

/* The five hard blocks reach the model QA --------------------------------- */

class MemoryOutreachRepository implements OutreachDraftRepository {
  readonly saved: SavedOutreachDraft[] = [];
  async save(runId: string, draft: OutreachDraft): Promise<SavedOutreachDraft> {
    const record = { id: `draft-${this.saved.length + 1}`, runId, draft };
    this.saved.push(record);
    return record;
  }
}

describe("the five hard blocks are in the model QA, not only in the lint", () => {
  it("states each block as a rule naming its register row", () => {
    const blocks = QA_BLOCK_RULE_INDEXES.map(
      (index) => OUTREACH_QA_RULES[index],
    );
    expect(blocks).toHaveLength(5);
    expect(blocks[0]).toMatch(/Wright tuition[\s\S]*C-001/);
    expect(blocks[1]).toMatch(/scholarship[\s\S]*C-002, C-003 and C-004/);
    expect(blocks[2]).toMatch(/C-005/);
    expect(blocks[3]).toMatch(/no VERIFIED credential row/);
    expect(blocks[4]).toMatch(/F-005/);
  });

  it("puts every attack in front of the reviewer, with all five blocks", () => {
    for (const [, name, substance] of [...AUDIT_ATTACKS, ...NEW_ATTACKS]) {
      const prompt = buildQaPrompt({
        renderedDraft: draft(substance).body,
        factsRegister: context.documents["FACTS.md"],
      });
      const whole = `${prompt.system}\n${prompt.user}`;
      // The reviewer can only judge paraphrase it can actually see.
      expect(whole, name).toContain(substance);
      for (const index of QA_BLOCK_RULE_INDEXES) {
        expect(whole, name).toContain(OUTREACH_QA_RULES[index]);
      }
    }
  });

  it("fails a draft on a block rule alone, with the lint passing", async () => {
    for (const index of QA_BLOCK_RULE_INDEXES) {
      const scores = OUTREACH_QA_RULES.map(() => 2);
      scores[index] = 0;
      const repository = new MemoryOutreachRepository();
      const store = new MemoryRunStore();
      const lead = leadWith(
        "My daughter keeps running out of time on the reading section before the November test.",
      );
      const result = await runWorkflow(
        createDraftWorkflow({
          lead,
          repository,
          loadContext: async () => context,
          qa: {
            review: async () => ({
              scores,
              failures: [OUTREACH_QA_RULES[index]],
              passed: false,
            }),
          },
        }),
        { store, trigger: "qa-block-probe" },
      );

      expect(result.status, OUTREACH_QA_RULES[index]).toBe("failed");
      expect(repository.saved, OUTREACH_QA_RULES[index]).toEqual([]);
      expect(store.exceptions.map((item) => item.message).join("\n")).toContain(
        OUTREACH_QA_RULES[index],
      );
    }
  });

  it("scores every rule, so a reviewer cannot skip the blocks", async () => {
    const short = OUTREACH_QA_RULES.slice(0, 11).map(() => 2);
    const client = {
      messages: {
        create: vi.fn(async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({ scores: short, failures: [] }),
            },
          ],
        })),
      },
    };
    await expect(
      new ClaudeQaReviewer({ client }).review({
        renderedDraft: renderOutreachDraft(
          await new DeterministicOutreachAgent().create({
            lead: leadWith("She needs help with the reading section."),
            context,
            channel: "wyzant-inquiry-reply",
            tutorId: "tutor-admissions",
          }),
        ),
        factsRegister: context.documents["FACTS.md"],
      }),
    ).rejects.toThrow(/11 scores for 16 rules/);
  });
});
