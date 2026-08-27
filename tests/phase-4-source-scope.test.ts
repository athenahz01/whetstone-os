import { describe, expect, it } from "vitest";
import {
  publicSentenceRejection,
  scopePublicSources,
  type PublicSourcePage,
  type ResearchExclusion,
} from "../lib/core/research";
import type { Lead } from "../lib/core/types";
import { runWorkflow } from "../lib/core/workflow";
import { createResearchWorkflow } from "../lib/workflows/s2-research";
import type {
  ResearchBriefRepository,
  SavedResearchBrief,
} from "../lib/core/research-store";
import type { ResearchBrief } from "../lib/core/research";
import { MemoryRunStore } from "./run-helpers";

/**
 * A filter that excludes everything is not a fix. Both tables are binding: the
 * eleven minor-data phrasings must never reach a brief, and the seven ordinary
 * organization pages must arrive intact with nothing logged against them.
 */
function page(url: string, content: string, title = "Public page") {
  return {
    url,
    title,
    content,
    access: "public",
    acquisition: "direct-public-page",
  } satisfies PublicSourcePage;
}

const MUST_EXCLUDE: [string, ResearchExclusion["reason"]][] = [
  [
    "Jordan Lee is age 16 and attends North Example School.",
    "minor-personal-data",
  ],
  [
    "Jordan Lee is 16 years old and attends North Example School.",
    "minor-personal-data",
  ],
  [
    "Emma is 15 and her mom can be reached at emma.mom@example.test.",
    "minor-personal-data",
  ],
  [
    "Jordan is in 10th grade at North Example School and his cell is 555-0100.",
    "minor-personal-data",
  ],
  [
    "Jordan is a sophomore at North Example High. Email jordan@example.test.",
    "minor-personal-data",
  ],
  [
    "My daughter Emma attends North Example School; reach her at emma@example.test.",
    "minor-personal-data",
  ],
  [
    "Priya, a junior at Example High School, lives at 12 Oak Street.",
    "minor-personal-data",
  ],
  [
    "Jordan Lee, born March 2010, attends North Example School.",
    "minor-personal-data",
  ],
  // No age, grade or enrollment language, so a minor is not established. The
  // honest reason is a home address attached to a named person.
  [
    "Home address 12 Oak Street belongs to the student Jordan Lee.",
    "personal-contact-data",
  ],
  [
    "Jordan turns 17 next month and attends North Example School.",
    "minor-personal-data",
  ],
  [
    "Jordan is turning 17 next month at North Example School.",
    "minor-personal-data",
  ],
];

const MUST_PASS = [
  "The public library offers a weekly test preparation study room. Sessions run each Saturday morning during the fall term.",
  "The fall workshop emphasizes evidence-based reading strategies. Small groups focus on passage analysis.",
  "The Example Learning Center runs an SAT Reading intensive each fall. For details contact info@example.org.",
  "The published fall calendar lists study sessions on Saturday, 9 a.m. in the east wing.",
  "The reading program was born out of a 2019 pilot and now serves the whole district.",
  "Our senior instructors design each SAT Reading plan around diagnostic results.",
  "The Example Learning Center offers SAT Reading tutoring. Call 555-867-5309 to enroll.",
];

describe("public source scope: minor data is excluded", () => {
  for (const [content, reason] of MUST_EXCLUDE) {
    it(`excludes as ${reason}: ${content}`, () => {
      const scoped = scopePublicSources([
        page(`https://school.example/${encodeURIComponent(content)}`, content),
      ]);
      expect(scoped.allowed, content).toEqual([]);
      expect(
        scoped.exclusions.map((item) => item.reason),
        content,
      ).toContain(reason);
    });
  }
});

describe("public source scope: ordinary pages survive intact", () => {
  for (const content of MUST_PASS) {
    it(`keeps whole and logs nothing: ${content}`, () => {
      const source = page(
        `https://org.example/${encodeURIComponent(content)}`,
        content,
      );
      const scoped = scopePublicSources([source]);
      expect(scoped.exclusions, content).toEqual([]);
      expect(scoped.allowed, content).toEqual([source]);
      expect(scoped.allowed[0].content, content).toBe(content);
    });
  }

  it("hands back an untouched page exactly as fetched, not resplit and rejoined", () => {
    // Line breaks and double spaces survive only if the page object is passed
    // through. Rejoining sentences would quietly rewrite a page nothing was
    // wrong with.
    const content = [
      "The fall workshop meets weekly.",
      "Small  groups focus on passage analysis.",
    ].join("\n");
    const source = page("https://org.example/multiline", content);
    const scoped = scopePublicSources([source]);
    expect(scoped.exclusions).toEqual([]);
    expect(scoped.allowed[0].content).toBe(content);
  });

  it("never rejects a contact detail that has no person attached to it", () => {
    expect(
      publicSentenceRejection("For details contact info@example.org."),
    ).toBeNull();
    expect(publicSentenceRejection("Call 555-867-5309 to enroll.")).toBeNull();
    expect(
      publicSentenceRejection("The office is at 12 Oak Street."),
    ).toBeNull();
  });

  it("still rejects the same contact detail once a person is attached", () => {
    expect(
      publicSentenceRejection("Reach Priya Raman at info@example.org."),
    ).toBe("personal-contact-data");
    expect(publicSentenceRejection("Her cell is 555-867-5309.")).toBe(
      "personal-contact-data",
    );
    expect(publicSentenceRejection("Email jordan@example.test.")).toBe(
      "personal-contact-data",
    );
  });
});

/**
 * Each rule below is the only thing standing between its sentence and a brief.
 * The table cases above overlap several rules at once, so a clause could be
 * deleted without any of them noticing. These isolate one clause each.
 */
describe("each minor-identifying clause carries a case of its own", () => {
  const CLAUSE_CASES: [string, string][] = [
    ["age under 18", "Jordan Lee is age 16 and loves reading."],
    ["a stated class year", "Jordan Lee is class of 2031."],
    ["enrollment language", "Jordan Lee attends North Example School."],
    ["a school year", "The 2026-27 school year roster is posted."],
    [
      "a class year in a school context with no name beside it",
      "A sophomore at North Example High School reviews passages.",
    ],
  ];

  for (const [clause, sentence] of CLAUSE_CASES) {
    it(`rejects on ${clause}: ${sentence}`, () => {
      expect(publicSentenceRejection(sentence), sentence).toBe(
        "minor-personal-data",
      );
    });
  }

  it("drops the whole page when the title itself names a minor", () => {
    const scoped = scopePublicSources([
      page(
        "https://school.example/profile",
        "The fall workshop emphasizes evidence-based reading strategies.",
        "Jordan Lee, 16 years old",
      ),
    ]);
    expect(scoped.allowed).toEqual([]);
    expect(scoped.exclusions).toEqual([
      expect.objectContaining({ reason: "minor-personal-data" }),
    ]);
  });
});

class MemoryResearchBriefRepository implements ResearchBriefRepository {
  readonly saved: SavedResearchBrief[] = [];

  async save(runId: string, brief: ResearchBrief): Promise<SavedResearchBrief> {
    const saved = { id: `brief-${this.saved.length + 1}`, runId, brief };
    this.saved.push(saved);
    return saved;
  }
}

function qualifiedLead(): Lead {
  return {
    id: "qualified-prospect",
    channel: "wyzant",
    author: "Prospect",
    subject: "SAT Reading",
    location: "Manhattan",
    text: "Grade 11 student wants a focused SAT Reading plan this fall before the November deadline.",
    url: "https://www.wyzant.com/tutor/jobs/qualified-prospect",
    postedAt: "2026-08-26T12:00:00.000Z",
    raw: {
      grade: 11,
      deadline: "2026-11-01",
      nextStep: "a 20 minute intro call",
      qualification: {
        verdict: "icp_pass",
        rationale: "The request satisfies the written ICP screen.",
        evidence: [
          {
            ref: "ICP.md#wyzant-screen",
            observation: "The approved subject, grade, and context matched.",
          },
        ],
        confidence: 0.96,
        contextHash: "fixture-context",
      },
    },
  };
}

describe("organization pages reach the brief, end to end", () => {
  /**
   * The regression this guards is not a crash. Before the split, all three of
   * these pages were dropped and the brief then stated, in its own voice and
   * with a citation, that no public context corroborated the record. A brief
   * that reports a false research finding is worse than one that fails.
   */
  it("keeps public context that exists rather than reporting none", async () => {
    const pages = [
      page(
        "https://library.example/reading-room",
        "The public library offers a weekly SAT Reading study room. For details contact info@example.org.",
        "Library reading room",
      ),
      page(
        "https://center.example/sat-reading",
        "The Example Learning Center offers SAT Reading tutoring. Call 555-867-5309 to enroll.",
        "SAT Reading tutoring",
      ),
      page(
        "https://calendar.example/fall",
        "The published fall SAT Reading calendar lists study sessions on Saturday, 9 a.m. in the east wing.",
        "Fall calendar",
      ),
    ];
    const store = new MemoryRunStore();
    store.approve("run-1", { artifactKind: "research-source-access" });
    const repository = new MemoryResearchBriefRepository();

    const result = await runWorkflow(
      createResearchWorkflow({
        lead: qualifiedLead(),
        sources: { fetchPublicSources: async () => pages },
        repository,
      }),
      { store, trigger: "organization-page-regression" },
    );

    expect(result.status).toBe("succeeded");
    const brief = repository.saved[0].brief;

    expect(brief.exclusions).toEqual([]);
    expect(brief.hooks.map((hook) => hook.kind)).toContain("public-context");
    expect(brief.confidence).toBeGreaterThan(0.3);
    expect(brief.disqualifier.basis.text).not.toContain(
      "no relevant public context corroborates",
    );
    expect(
      brief.evidence.filter((item) => item.kind === "public-web").length,
    ).toBeGreaterThanOrEqual(1);
  });
});
