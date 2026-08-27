import type { Lead } from "./types";

/**
 * What the prospect actually told us.
 *
 * The audit found a lint-clean draft telling a parent "you have not said when
 * the test is" when their message said "before the November test", in the same
 * sentence the draft had lifted its opening hook from. The disqualifier is the
 * one field whose whole job is to earn trust, and a claim of absence about a
 * detail the reader supplied does the opposite.
 *
 * voiceLint cannot see this: it reads the draft, not the message behind it.
 * So this reads both, and the gate below refuses a draft that asserts an
 * absence the source contradicts.
 */
export interface SourceSupplies {
  timing: boolean;
  subject: boolean;
  grade: boolean;
  format: boolean;
  nextStep: boolean;
}

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december";

const TIMING = new RegExp(
  String.raw`\b(?:${MONTHS}|deadline|due date|next (?:week|month|term)|this (?:week|month|term|spring|autumn|fall|summer|winter)|in the (?:spring|autumn|fall|summer|winter)|before the \w+ (?:test|exam|sitting)|\d{1,2}[/-]\d{1,2}|\bby \w+ \d{1,2}\b)\b`,
  "i",
);

const GRADE =
  /\b(?:grade\s*\d{1,2}|\d{1,2}(?:st|nd|rd|th)\s+grade|freshman|sophomore|junior|senior|year\s*\d{1,2}|rising \w+)\b/i;

const FORMAT =
  /\b(?:online|in[-\s]person|remote|remotely|over zoom|on zoom|at our (?:home|house)|in my home|virtual)\b/i;

const NEXT_STEP =
  /\b(?:call|meet|meeting|session|talk|chat|intro|consult|speak)\b/i;

function text(lead: Lead): string {
  return `${lead.text ?? ""} ${lead.subject ?? ""} ${lead.location ?? ""}`;
}

function raw(lead: Lead): Record<string, unknown> {
  return lead.raw && typeof lead.raw === "object"
    ? (lead.raw as Record<string, unknown>)
    : {};
}

function stated(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null && value !== "";
}

export function sourceSupplies(lead: Lead): SourceSupplies {
  const record = raw(lead);
  const body = text(lead);
  return {
    timing: stated(record.deadline) || TIMING.test(body),
    subject: stated(lead.subject) || stated(record.subject),
    grade: stated(record.grade) || GRADE.test(body),
    format: stated(record.format) || stated(lead.location) || FORMAT.test(body),
    nextStep: stated(record.nextStep) || NEXT_STEP.test(body),
  };
}

/** Ways a draft can assert that the prospect left something out. */
const ABSENCE_CLAIMS: [keyof SourceSupplies, RegExp][] = [
  [
    "timing",
    /\b(?:you have not said|you did not say|you have not mentioned|I do not know|without knowing|you have not told me)\b[^.]{0,40}\b(?:when|date|deadline|timing|test is|how long)\b/i,
  ],
  [
    "subject",
    /\b(?:you have not said|you did not say|I do not know|without knowing)\b[^.]{0,40}\b(?:which subject|what subject|what area)\b/i,
  ],
  [
    "grade",
    /\b(?:you have not said|you did not say|I do not know|without knowing)\b[^.]{0,40}\b(?:what (?:grade|year)|which (?:grade|year)|how old)\b/i,
  ],
  [
    "format",
    /\b(?:you have not said|you did not say|I do not know|without knowing)\b[^.]{0,40}\b(?:online or in person|in person or online|where you|which format)\b/i,
  ],
  [
    "nextStep",
    /\b(?:you have not said|you did not say|I do not know|without knowing)\b[^.]{0,40}\b(?:what you would like|what next step|how you would like)\b/i,
  ],
];

export interface SourceTruthIssue {
  rule: string;
  reason: string;
  evidence: string;
  field: keyof SourceSupplies;
}

/**
 * Refuses a draft that claims the prospect left out something they supplied.
 *
 * This is a correctness check against the input, not a voice check, which is
 * why it lives here rather than in voice.ts. It applies to any agent: the
 * deterministic one produced the defect, and a model will produce it too.
 */
export function contradictedAbsences(
  body: string,
  lead: Lead,
): SourceTruthIssue[] {
  const supplies = sourceSupplies(lead);
  const issues: SourceTruthIssue[] = [];
  for (const [field, pattern] of ABSENCE_CLAIMS) {
    const match = pattern.exec(body);
    if (match && supplies[field]) {
      issues.push({
        rule: "source.contradicted-absence",
        reason: `the draft says the ${field} was not supplied, and the source message supplies it`,
        evidence: match[0],
        field,
      });
    }
  }
  return issues;
}
