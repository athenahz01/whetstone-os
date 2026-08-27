import { createHash } from "node:crypto";
import type { AgentContext } from "./context";
import type { ClaudeClient } from "./drafting";
import { parseFactsRegister, type FactsRegister } from "./facts";
import { readQualification } from "./qualification";
import { contradictedAbsences, sourceSupplies } from "./source-truth";
import type { Lead } from "./types";
import {
  CHANNEL_WORD_BOUNDS,
  lintFragment,
  voiceLint,
  type OutreachChannel,
  type VoiceLintIssue,
} from "./voice";

export const OUTREACH_VARIANTS = [
  "specific-first",
  "question-led",
  "plan-first",
] as const;

export type OutreachVariant = (typeof OUTREACH_VARIANTS)[number];

/**
 * The draft is structured, not a blob. Every field is either closed vocabulary
 * or verbatim content the lint can check, and there is no free-text label a
 * later step could quietly rewrite.
 */
export interface OutreachDraft {
  leadId: string;
  tutorId: string;
  variant: OutreachVariant;
  channel: OutreachChannel;
  opening: string;
  substance: string;
  plan: string;
  /** The one honest limitation. Required by VOICE.md and by the lint. */
  disqualifier: string;
  /** The single next step, phrased as a question. */
  ask: string;
  /** FACTS.md ids this draft relies on. Empty is valid and common. */
  citations: string[];
  contextHash: string;
}

export function renderOutreachDraft(draft: OutreachDraft): string {
  return [
    draft.opening,
    draft.substance,
    draft.plan,
    draft.disqualifier,
    draft.ask,
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function selectOutreachVariant(leadId: string): OutreachVariant {
  const digest = createHash("sha256").update(leadId).digest();
  return OUTREACH_VARIANTS[digest[0] % OUTREACH_VARIANTS.length];
}

export interface OutreachAgentInput {
  lead: Lead;
  context: AgentContext;
  channel: OutreachChannel;
  tutorId: string;
}

export interface OutreachAgent {
  create(input: OutreachAgentInput): Promise<OutreachDraft>;
}

export class IneligibleOutreachProspectError extends Error {
  constructor(leadId: string) {
    super(
      `${leadId} is not an icp_pass prospect and cannot enter S3 drafting.`,
    );
    this.name = "IneligibleOutreachProspectError";
  }
}

export class OutreachVoiceGateError extends Error {
  constructor(public readonly issue: VoiceLintIssue) {
    super(`Draft failed voice lint ${issue.rule}: ${issue.reason}.`);
    this.name = "OutreachVoiceGateError";
  }
}

export class OutreachQaGateError extends Error {
  constructor(public readonly failures: string[]) {
    super(`Draft failed model QA: ${failures.join("; ")}.`);
    this.name = "OutreachQaGateError";
  }
}

/* The eleven compressed playbook rules the model QA scores against. --------
 *
 * Each traces to a line in VOICE.md. They are listed here rather than in the
 * prompt string so a test can assert the QA was asked about all of them.
 */
export const OUTREACH_QA_RULES: readonly string[] = [
  "Leads with useful specificity rather than a pitch.",
  "Refers to at least one concrete detail from the source message.",
  "Identifies the real question or anxiety and answers that.",
  "Uses plain, direct language and sounds like a person who knows the work.",
  "Makes one sharp observation rather than touring everything in the record.",
  "Is honest about uncertainty and fills no gap with a plausible-sounding fact.",
  "Avoids hype, canned praise, unsupported claims, dramatic framing and superlatives.",
  "Uses no compliment sandwich.",
  "Is warm, calm and adult-to-adult, and acknowledges the concern without amplifying anxiety.",
  "Offers exactly one low-pressure next step, phrased as a question.",
  "Claims no result, and implies nothing was sent or approved.",
  // The five hard blocks, stated as concepts rather than as tokens. The lint
  // catches the blunt phrasings; paraphrase is exactly what a model reviewer
  // is here for, so it is asked about each block directly.
  "States nothing about Wright tuition, any rung of its award ladder, or its application dates, in figures, in words or as a range. FACTS.md C-001 and C-006 block them.",
  "States nothing about the scholarship's value, deadline, decision schedule or award structure. FACTS.md C-002, C-003 and C-004 block them.",
  "Rests on nothing in the draft scholarship terms, which FACTS.md C-005 blocks because they are unreviewed by counsel.",
  "Makes no claim about Cole's education, degrees, institutions or academic background, named or unnamed. FACTS.md holds no VERIFIED credential row, so there is nothing to paraphrase.",
  "Offers help only with College Counseling, English, Essay Writing and SAT Reading. FACTS.md F-005 approves no others, and not SAT Math or any ACT section.",
] as const;

/** The indexes of the five hard blocks inside OUTREACH_QA_RULES. */
export const QA_BLOCK_RULE_INDEXES = [11, 12, 13, 14, 15] as const;

export interface QaVerdict {
  /** One score per rule, in the order of OUTREACH_QA_RULES. */
  scores: number[];
  failures: string[];
  passed: boolean;
}

export interface QaReviewer {
  review(input: {
    renderedDraft: string;
    factsRegister: string;
  }): Promise<QaVerdict>;
}

/**
 * The QA sees the rendered draft and the FACTS.md register, and nothing else.
 *
 * Specifically it never sees the variant, the citations the drafting step chose
 * for itself, or any of its reasoning. Phase 4 shipped a gate that compared a
 * function's output against a copy of its own output and therefore could not
 * fail; a reviewer handed the drafting step's own conclusions would do the same
 * thing in a more convincing way.
 */
export function buildQaPrompt(input: {
  renderedDraft: string;
  factsRegister: string;
}): { system: string; user: string } {
  return {
    system: [
      "You review one prepared reply before a human sees it. Nothing is sent.",
      "Score each rule from 0 to 2, where 2 is fully met and 0 is clearly broken.",
      "Judge only what is in front of you. Do not infer intent.",
      "Rules:",
      ...OUTREACH_QA_RULES.map((rule, index) => `${index + 1}. ${rule}`),
      'Return JSON: {"scores":[...11 numbers...],"failures":["rule text",...]}',
    ].join("\n"),
    user: [
      "Verified facts register:",
      input.factsRegister,
      "",
      "Draft:",
      input.renderedDraft,
    ].join("\n"),
  };
}

/* Deterministic agent -------------------------------------------------------
 *
 * The fallback and the test substrate. It writes from the prospect's own words
 * only, so it can be exercised end to end with no API key and no network, and
 * so the pipeline has a path that cannot hallucinate. The production voice is
 * the Claude agent below.
 */
export class DeterministicOutreachAgent implements OutreachAgent {
  async create(input: OutreachAgentInput): Promise<OutreachDraft> {
    const qualification = readQualification(input.lead);
    if (qualification?.verdict !== "icp_pass") {
      throw new IneligibleOutreachProspectError(input.lead.id);
    }
    const facts = parseFactsRegister(input.context.documents["FACTS.md"]);
    const variant = selectOutreachVariant(input.lead.id);
    const subject = approvedSubject(input.lead, facts);
    const echo = sourceEcho(input.lead, facts);

    const opening = openingFor(variant, subject, echo);
    const substance = substanceFor(variant, subject);
    const plan = planFor(variant);
    const disqualifier = disqualifierFor(input.lead, subject);
    const ask = askFor(variant);

    const draft: OutreachDraft = {
      leadId: input.lead.id,
      tutorId: input.tutorId,
      variant,
      channel: input.channel,
      opening,
      substance,
      plan,
      disqualifier,
      ask,
      citations: ["F-005"],
      contextHash: input.context.hash,
    };
    return fitToChannel(draft);
  }
}

/**
 * Keeps the draft inside its channel bound whatever the prospect wrote.
 *
 * The echo is the prospect's own sentence and its length is not ours to
 * choose, so a long one must not push a valid draft over the limit. The plan
 * paragraph is the expendable one: the observation, the honest limitation and
 * the ask all carry something the reply cannot do without.
 */
export function fitToChannel(draft: OutreachDraft): OutreachDraft {
  const bounds = CHANNEL_WORD_BOUNDS[draft.channel];
  const count = (candidate: OutreachDraft) =>
    renderOutreachDraft(candidate).split(/\s+/).filter(Boolean).length;
  if (count(draft) <= bounds.max) return draft;
  const trimmed = { ...draft, plan: "" };
  return count(trimmed) >= bounds.min ? trimmed : draft;
}

/** The lead's subject, only if F-005 approves it. */
function approvedSubject(lead: Lead, facts: FactsRegister): string {
  const stated = lead.subject?.trim() ?? "";
  const approved = facts.approvedSubjects.find(
    (subject) => subject.toLowerCase() === stated.toLowerCase(),
  );
  return approved ?? facts.approvedSubjects[0] ?? "this work";
}

/**
 * Order matters. "I am" has to be rewritten before bare "I", or the echo comes
 * back as "you am not sure which schools are realistic".
 */
const PERSON_SWAPS: [RegExp, string][] = [
  [/^i am\b/i, "you are"],
  [/^i'm\b/i, "you are"],
  [/^we are\b/i, "you are"],
  [/^we're\b/i, "you are"],
  [/^i have\b/i, "you have"],
  [/^we have\b/i, "you have"],
  [/^i\b/i, "you"],
  [/^we\b/i, "you"],
  [/^my\b/i, "your"],
  [/^our\b/i, "your"],
];

/** Possessives inside the clause, once it is addressed back to the writer. */
const INNER_SWAPS: [RegExp, string][] = [
  [/\bmy\b/gi, "your"],
  [/\bour\b/gi, "your"],
];

/**
 * One clause the prospect actually wrote, turned around to address them.
 *
 * Echoing the source is what makes a reply specific rather than templated, and
 * VOICE.md requires at least one concrete detail. It is linted first: a parent
 * may write "she needs her score up" without doing anything wrong, but quoting
 * it would put a promised outcome in Cole's mouth.
 */
export function sourceEcho(lead: Lead, facts: FactsRegister): string {
  const clauses = lead.text
    .split(/[.,;!?]|\bbefore\b|\bafter\b|\band\b|\bbut\b|\bbecause\b|\bso\b/i)
    .map((clause) => clause.trim())
    .filter((clause) => {
      const length = clause.split(/\s+/).filter(Boolean).length;
      return length >= 5 && length <= 16;
    });

  for (const clause of clauses) {
    const swapped = PERSON_SWAPS.reduce(
      (text, [pattern, replacement]) =>
        pattern.test(text) ? text.replace(pattern, replacement) : text,
      clause,
    );
    const addressed = INNER_SWAPS.reduce(
      (text, [pattern, replacement]) => text.replace(pattern, replacement),
      swapped,
    );
    if (lintFragment(addressed, facts).length === 0) {
      return addressed.charAt(0).toLowerCase() + addressed.slice(1);
    }
  }
  return lead.subject?.trim() ?? "";
}

function openingFor(
  variant: OutreachVariant,
  subject: string,
  echo: string,
): string {
  if (variant === "question-led") {
    return `Thanks for the note about ${subject}. You wrote this: ${echo}. So that I do not guess: is this mostly a question of practice, or of how the work is being approached?`;
  }
  if (variant === "plan-first") {
    return `Thanks for the note about ${subject}. Here is what I would do first, starting from what you described: ${echo}.`;
  }
  return `Thanks for the note about ${subject}. The detail that stood out was this: ${echo}.`;
}

function substanceFor(variant: OutreachVariant, subject: string): string {
  if (variant === "question-led") {
    return `The answer changes what the first session should be. One version is mostly practice and pacing. The other means slowing down to look at how the work is being put together, which is a different use of the hour.`;
  }
  if (variant === "plan-first") {
    return `A diagnostic session first, on a real piece of work rather than a description of it. Then one thing to change, rather than a list of everything in ${subject} that could be better.`;
  }
  return `Before suggesting anything I would want to see the actual work rather than a description of it. What looks like one problem from the outside is often a different one on the page.`;
}

function planFor(variant: OutreachVariant): string {
  if (variant === "plan-first") {
    return `After that we would know whether this is something regular sessions help with, or something she can sort out without me. I would rather find that out early than bill you for it.`;
  }
  if (variant === "question-led") {
    return `Either way I would want to see a real example before recommending anything, rather than working from a description of it.`;
  }
  return `So the first session would be diagnostic: we look at one real example together and I tell you plainly what I see. If it is not something I can help with, I will say so.`;
}

/**
 * Derived from the source message, not from a structured field.
 *
 * A limitation may only assert an absence the message actually has. The
 * prospect who wrote "before the November test" supplied the timing, and a
 * draft telling them otherwise reads as though nobody opened their message.
 */
function disqualifierFor(lead: Lead, subject: string): string {
  const supplies = sourceSupplies(lead);
  if (!supplies.timing) {
    return `One thing to be straight about: you have not said when the test is, and I cannot promise a particular result without knowing how much runway there is.`;
  }
  if (!supplies.format) {
    return `One thing to be straight about: you have not said whether you want this online or in person, and that changes what I would suggest.`;
  }
  return `One thing to be straight about: I cannot promise a particular result, and ${subject} rewards steady weeks rather than a sprint at the end.`;
}

function askFor(variant: OutreachVariant): string {
  if (variant === "question-led") {
    return `Would it help to look at one real example together before planning anything?`;
  }
  if (variant === "plan-first") {
    return `Shall I put that first month into a short plan you can look over?`;
  }
  return `Would a session this week be useful to look at one example and find out?`;
}

/* Voice gate ---------------------------------------------------------------- */

export interface OutreachGateResult {
  issues: VoiceLintIssue[];
  rendered: string;
}

export interface OutreachGateInput {
  draft: OutreachDraft;
  facts: FactsRegister;
  lead: Lead;
}

/**
 * Deterministic first, model second. The model is never asked to judge
 * something a regex settles, and a draft that fails the lint never reaches it.
 */
export function outreachVoiceGate(
  draft: OutreachDraft,
  facts: FactsRegister,
  sourceDetails: string[],
  lead?: Lead,
): OutreachGateResult {
  const rendered = renderOutreachDraft(draft);
  const issues = voiceLint({
    body: rendered,
    channel: draft.channel,
    disqualifier: draft.disqualifier,
    ask: draft.ask,
    sourceDetails,
    facts,
  });
  // voiceLint reads the draft. Only this can read the message behind it, so a
  // claim of absence gets checked against what the prospect actually wrote.
  if (lead) {
    for (const issue of contradictedAbsences(rendered, lead)) {
      issues.push({
        rule: issue.rule,
        reason: issue.reason,
        evidence: issue.evidence,
      });
    }
  }
  return { rendered, issues };
}

/* Production agents ---------------------------------------------------------
 *
 * Both send no `temperature` field. Regression lock 1: Sonnet 5 returns
 * 400 deprecated when it is present.
 */

const DEFAULT_MODEL = "claude-sonnet-5";

export interface ClaudeOutreachOptions {
  client: ClaudeClient;
  model?: string;
}

function textOf(message: { content: Array<{ type: string; text?: string }> }) {
  return message.content
    .filter(
      (block): block is { type: string; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("The model returned no JSON object.");
  }
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

function requiredString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`The model omitted the required field "${key}".`);
  }
  return value.trim();
}

export function buildOutreachPrompt(input: {
  lead: Lead;
  context: AgentContext;
  variant: OutreachVariant;
  channel: OutreachChannel;
}): { system: string; user: string } {
  const bounds = CHANNEL_WORD_BOUNDS[input.channel];
  return {
    system: [
      "You prepare one reply for a human to review. Nothing is sent.",
      `Prompt context hash: ${input.context.hash}`,
      "The documents below are authoritative. Never state a BLOCKED fact, never",
      "paraphrase around one, and never omit a qualifier and ship the rest.",
      input.context.promptText,
      `Variant direction: ${VARIANT_DIRECTION[input.variant]}`,
      `The rendered reply runs ${bounds.min} to ${bounds.max} words.`,
      'Return JSON only: {"opening":"","substance":"","plan":"","disqualifier":"","ask":"","citations":[]}',
      "The disqualifier states one honest limitation. The ask is a question.",
      "citations lists the FACTS.md ids you relied on, and may be empty.",
    ].join("\n\n"),
    user: [
      `Subject: ${input.lead.subject ?? "Not provided"}`,
      `Location: ${input.lead.location ?? "Not provided"}`,
      `Channel: ${input.lead.channel}`,
      `What they wrote: ${input.lead.text}`,
      "Refer to at least one concrete detail from what they wrote.",
    ].join("\n"),
  };
}

const VARIANT_DIRECTION: Record<OutreachVariant, string> = {
  "specific-first":
    "Open with one concrete detail from the inquiry, then make one connection to the work.",
  "question-led":
    "Open with one genuinely useful question grounded in the inquiry, then say what each answer would change.",
  "plan-first":
    "Open with a practical first step for this exact situation, then offer help without pressure.",
};

export class ClaudeOutreachAgent implements OutreachAgent {
  constructor(private readonly options: ClaudeOutreachOptions) {}

  async create(input: OutreachAgentInput): Promise<OutreachDraft> {
    const qualification = readQualification(input.lead);
    if (qualification?.verdict !== "icp_pass") {
      throw new IneligibleOutreachProspectError(input.lead.id);
    }
    const variant = selectOutreachVariant(input.lead.id);
    const prompt = buildOutreachPrompt({
      lead: input.lead,
      context: input.context,
      variant,
      channel: input.channel,
    });
    const message = await this.options.client.messages.create({
      model: this.options.model ?? DEFAULT_MODEL,
      max_tokens: 900,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
    const parsed = parseJsonObject(textOf(message));
    const citations = Array.isArray(parsed.citations)
      ? parsed.citations.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    return fitToChannel({
      leadId: input.lead.id,
      tutorId: input.tutorId,
      variant,
      channel: input.channel,
      opening: requiredString(parsed, "opening"),
      substance: requiredString(parsed, "substance"),
      plan: typeof parsed.plan === "string" ? parsed.plan.trim() : "",
      disqualifier: requiredString(parsed, "disqualifier"),
      ask: requiredString(parsed, "ask"),
      citations,
      contextHash: input.context.hash,
    });
  }
}

export class ClaudeQaReviewer implements QaReviewer {
  constructor(private readonly options: ClaudeOutreachOptions) {}

  async review(input: {
    renderedDraft: string;
    factsRegister: string;
  }): Promise<QaVerdict> {
    const prompt = buildQaPrompt(input);
    const message = await this.options.client.messages.create({
      model: this.options.model ?? DEFAULT_MODEL,
      max_tokens: 700,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
    const parsed = parseJsonObject(textOf(message));
    const scores = Array.isArray(parsed.scores)
      ? parsed.scores.map((value) => Number(value))
      : [];
    const failures = Array.isArray(parsed.failures)
      ? parsed.failures.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    if (scores.length !== OUTREACH_QA_RULES.length) {
      throw new Error(
        `The reviewer returned ${scores.length} scores for ${OUTREACH_QA_RULES.length} rules.`,
      );
    }
    return {
      scores,
      failures,
      // A zero on any rule is a failure. The rules are not weighted against
      // each other, because a draft that breaks one of them is not rescued by
      // doing well on the other ten.
      passed: failures.length === 0 && scores.every((score) => score > 0),
    };
  }
}
