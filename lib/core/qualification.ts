import type { AgentContext } from "./context";
import type { Lead, QualificationEvidence, QualificationResult } from "./types";

export interface IcpCriteria {
  approvedWyzantSubjects: string[];
  outOfScopeWyzantSubjects: string[];
  forbiddenSourceChannels: string[];
}

function section(
  markdown: string,
  heading: string,
  nextHeading: string,
): string {
  const start = markdown.indexOf(heading);
  const end = markdown.indexOf(nextHeading, start + heading.length);
  if (start < 0 || end < 0) {
    throw new Error(`ICP.md is missing the ${heading} section boundary.`);
  }
  return markdown.slice(start + heading.length, end);
}

function bullets(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => value.replace(/\s*,\s*unless[\s\S]*$/i, "").trim());
}

export function parseIcpCriteria(markdown: string): IcpCriteria {
  const approved = section(
    markdown,
    "exactly these four:",
    "### Explicitly out of scope",
  );
  const excluded = section(
    markdown,
    "### Explicitly out of scope",
    "### Geography",
  );
  const sources = section(
    markdown,
    "## Allowed source populations",
    "## Wyzant fit",
  );
  const approvedWyzantSubjects = bullets(approved);
  const outOfScopeWyzantSubjects = bullets(excluded).filter(
    (value) => !/^Any subject/i.test(value),
  );
  if (approvedWyzantSubjects.length !== 4) {
    throw new Error(
      "ICP.md must define exactly four approved Wyzant subjects.",
    );
  }
  const forbiddenSentence = sources.match(
    /([A-Za-z]+),\s*([A-Za-z]+),\s*and\s*([A-Za-z]+)\s+are not sources\./i,
  );
  if (!forbiddenSentence) {
    throw new Error("ICP.md must name its prohibited source channels.");
  }
  return {
    approvedWyzantSubjects,
    outOfScopeWyzantSubjects,
    forbiddenSourceChannels: forbiddenSentence
      .slice(1)
      .map((value) => value.toLowerCase()),
  };
}

function evidence(ref: string, observation: string): QualificationEvidence {
  return { ref, observation };
}

function rawRecord(lead: Lead): Record<string, unknown> {
  return lead.raw && typeof lead.raw === "object"
    ? (lead.raw as Record<string, unknown>)
    : {};
}

function hasPhrase(value: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped.replace(/\s+/g, "\\s+")}\\b`, "i").test(
    value,
  );
}

function gradeFrom(lead: Lead): number | undefined {
  const raw = rawRecord(lead);
  if (typeof raw.grade === "number") return raw.grade;
  const text = `${lead.subject ?? ""} ${lead.text}`;
  if (/\bsenior\b/i.test(text)) return 12;
  const match = text.match(
    /\b(?:grade\s*(5|6|7|8|9|10|11|12)|(5|6|7|8|9|10|11|12)(?:th|st|nd|rd)?\s*(?:grade|grader))\b/i,
  );
  return match ? Number(match[1] ?? match[2]) : undefined;
}

function isTooLate(lead: Lead, grade: number | undefined): boolean {
  if (grade !== 12) return false;
  const deadline = rawRecord(lead).deadline;
  if (typeof deadline !== "string") return false;
  const time = Date.parse(deadline);
  const posted = Date.parse(lead.postedAt);
  return (
    Number.isFinite(time) &&
    Number.isFinite(posted) &&
    time - posted <= 21 * 86_400_000
  );
}

function result(
  verdict: QualificationResult["verdict"],
  rationale: string,
  evidenceItems: QualificationEvidence[],
  confidence: number,
  contextHash: string,
): QualificationResult {
  return {
    verdict,
    rationale,
    evidence: evidenceItems,
    confidence,
    contextHash,
  };
}

export function qualify(
  lead: Lead,
  criteria: IcpCriteria,
  contextHash: string,
): QualificationResult {
  const source = evidence(
    "ICP.md#allowed-source-populations",
    `Normalized source is ${lead.channel}.`,
  );
  if (criteria.forbiddenSourceChannels.includes(lead.channel.toLowerCase())) {
    return result(
      "out_of_scope",
      "The source channel is permanently excluded from this system.",
      [
        source,
        evidence(
          "ICP.md#allowed-source-populations",
          `${lead.channel} is named as a prohibited source.`,
        ),
      ],
      0.99,
      contextHash,
    );
  }
  const permittedChannels = [
    "wyzant",
    "wyzant-messages",
    "reengagement",
    "referrals",
    "counselors",
  ];
  if (!permittedChannels.includes(lead.channel.toLowerCase())) {
    return result(
      "needs_human_review",
      "The source does not prove that the prospect belongs to an allowed population.",
      [
        source,
        evidence(
          "ICP.md#allowed-source-populations",
          "No permitted source-population proof was attached.",
        ),
      ],
      0.5,
      contextHash,
    );
  }
  const grade = gradeFrom(lead);
  if (grade !== undefined && grade >= 5 && grade <= 7) {
    return result(
      "out_of_scope",
      "The student is in the nurture-only grade range.",
      [
        source,
        evidence(
          "ICP.md#grade-range-and-stage-rules",
          `Grade ${grade} triggers too_early.`,
        ),
      ],
      0.99,
      contextHash,
    );
  }
  if (isTooLate(lead, grade)) {
    return result(
      "icp_fail",
      "A grade 12 deadline is within the three-week disqualifier window.",
      [
        source,
        evidence(
          "ICP.md#grade-range-and-stage-rules",
          "The supplied deadline is 21 days or less after the inquiry.",
        ),
      ],
      0.98,
      contextHash,
    );
  }

  if (lead.channel === "counselors" || lead.channel === "referrals") {
    const professional = rawRecord(lead).professionalAdult === true;
    if (professional) {
      return result(
        "icp_pass",
        "The record is a public professional referral partner.",
        [
          source,
          evidence(
            "ICP.md#referral-partner-fit",
            "The adapter verified an adult acting professionally and a public contact source.",
          ),
        ],
        0.96,
        contextHash,
      );
    }
  }

  const searchable = `${lead.subject ?? ""} ${lead.text}`;
  const excluded = criteria.outOfScopeWyzantSubjects.filter((subject) =>
    hasPhrase(searchable, subject),
  );
  const approved = criteria.approvedWyzantSubjects.filter(
    (subject) =>
      hasPhrase(searchable, subject) &&
      !excluded.some((excludedSubject) =>
        excludedSubject.toLowerCase().includes(subject.toLowerCase()),
      ),
  );
  if (approved.length > 0 && excluded.length > 0) {
    return result(
      "needs_human_review",
      "The request mixes approved and out-of-scope subjects.",
      [
        source,
        evidence(
          "ICP.md#explicitly-out-of-scope",
          `Matched approved: ${approved.join(", ")}; excluded: ${excluded.join(", ")}.`,
        ),
      ],
      0.99,
      contextHash,
    );
  }
  if (excluded.length > 0) {
    return result(
      "out_of_scope",
      "The request is for a Wyzant subject Cole is not approved to take.",
      [
        source,
        evidence(
          "ICP.md#explicitly-out-of-scope",
          `Matched: ${excluded.join(", ")}.`,
        ),
      ],
      0.99,
      contextHash,
    );
  }
  if (approved.length === 0) {
    return result(
      lead.subject?.trim() ? "out_of_scope" : "needs_human_review",
      lead.subject?.trim()
        ? "The stated subject is not in the approved list."
        : "The subject is missing, so fit cannot be decided safely.",
      [
        source,
        evidence(
          "ICP.md#wyzant-fit",
          lead.subject?.trim()
            ? `No approved subject matched ${lead.subject.trim()}.`
            : "No subject was supplied.",
        ),
      ],
      lead.subject?.trim() ? 0.95 : 0.55,
      contextHash,
    );
  }
  if (grade === undefined || lead.text.trim().length < 20) {
    return result(
      "needs_human_review",
      "The approved subject matched, but grade or useful inquiry context is missing.",
      [
        source,
        evidence(
          "ICP.md#wyzant-screen",
          `Matched ${approved.join(", ")}; grade known: ${grade !== undefined}; sufficient context: ${lead.text.trim().length >= 20}.`,
        ),
      ],
      0.65,
      contextHash,
    );
  }
  if (grade < 8 || grade > 12) {
    return result(
      "out_of_scope",
      "The student is outside the served grade range.",
      [
        source,
        evidence(
          "ICP.md#grade-range-and-stage-rules",
          `Grade ${grade} is outside grades 8 through 12.`,
        ),
      ],
      0.99,
      contextHash,
    );
  }
  return result(
    "icp_pass",
    "The source, subject, grade, and context satisfy the written ICP screen.",
    [
      source,
      evidence(
        "ICP.md#wyzant-screen",
        `Matched ${approved.join(", ")} for grade ${grade} with usable inquiry context.`,
      ),
    ],
    0.96,
    contextHash,
  );
}

export function qualifyLead(lead: Lead, context: AgentContext): Lead {
  const qualification = qualify(
    lead,
    parseIcpCriteria(context.documents["ICP.md"]),
    context.hash,
  );
  return {
    ...lead,
    raw: { ...rawRecord(lead), qualification },
  };
}

export function readQualification(lead: Lead): QualificationResult | undefined {
  const value = rawRecord(lead).qualification;
  if (!value || typeof value !== "object") return undefined;
  return value as QualificationResult;
}
