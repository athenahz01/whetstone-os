import { createHash } from "node:crypto";
import type { AgentContext } from "./context";
import { readQualification } from "./qualification";
import type { Lead } from "./types";

export type ResearchEvidenceKind =
  "prospect-supplied" | "icp" | "public-web" | "research-log";

export interface PublicSourcePage {
  url: string;
  title: string;
  content: string;
  access: "public";
  acquisition: "direct-public-page";
}

export interface ResearchEvidence {
  id: string;
  kind: ResearchEvidenceKind;
  sourceUrl: string;
  title: string;
  excerpt: string;
  fact: string;
}

export interface CitedClaim {
  id: string;
  text: string;
  evidenceIds: string[];
}

export const WHY_FIT_LABEL = "Fit evidence";
export const DISQUALIFIER_LABEL = "Disqualifier";

export const RESEARCH_HOOK_LABELS = {
  "prospect-request": "Prospect request:",
  "subject-match": "Subject match:",
  "public-context": "Public context:",
  location: "Location:",
  channel: "Source channel:",
} as const;

export type ResearchHookKind = keyof typeof RESEARCH_HOOK_LABELS;

export interface ResearchHook {
  kind: ResearchHookKind;
  claim: CitedClaim;
}

export interface ResearchBrief {
  leadId: string;
  whyFit: {
    claims: CitedClaim[];
  };
  hooks: [ResearchHook, ResearchHook, ResearchHook];
  disqualifier: {
    basis: CitedClaim;
  };
  unknowns: CitedClaim[];
  confidence: number;
  evidence: ResearchEvidence[];
  exclusions: ResearchExclusion[];
  contextHash: string;
}

export interface ResearchExclusion {
  sourceRef: string;
  reason:
    | "minor-personal-data"
    | "not-public"
    | "enrichment-vendor"
    | "unsupported-source";
}

export interface ResearchSourceProvider {
  fetchPublicSources(lead: Lead): Promise<PublicSourcePage[]>;
}

export interface ResearchAgent {
  create(input: {
    lead: Lead;
    context: AgentContext;
    publicSources: PublicSourcePage[];
    exclusions: ResearchExclusion[];
  }): Promise<ResearchBrief>;
}

export interface CitationGateIssue {
  claimId: string;
  reason: string;
}

export type ResearchBriefTrust = Pick<
  ResearchBrief,
  | "leadId"
  | "contextHash"
  | "evidence"
  | "exclusions"
  | "hooks"
  | "confidence"
  | "whyFit"
  | "disqualifier"
  | "unknowns"
>;

const ENRICHMENT_HOSTS = new Set([
  "apollo.io",
  "clearbit.com",
  "peopledatalabs.com",
  "rocketreach.co",
  "zoominfo.com",
]);

const PUBLIC_PERSONAL_DATA_SIGNALS = [
  /\b(?:age|aged)\s+(?:[1-9]|1[0-7])\b/i,
  /\b(?:[1-9]|1[0-7])(?:[- ]years?[- ]old|\s+years?\s+old)\b/i,
  /\b(?:she|he|they)(?:['’]s|\s+is)\s+(?:[1-9]|1[0-7])\b/i,
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*(?:,|is)\s*(?:[1-9]|1[0-7])\b/,
  /\bturning\s+(?:[1-9]|1[0-7])\b/i,
  /\b(?:born|date of birth|dob)\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd)\b/i,
];

const PUBLIC_MINOR_CONTEXT_SIGNALS = [
  ...PUBLIC_PERSONAL_DATA_SIGNALS,
  /\b(?:[1-9]|1[0-2])(?:st|nd|rd|th)?\s+grade\b/i,
  /\b(?:freshman|sophomore|junior|senior)\b/i,
  /\bclass\s+of\s+20\d{2}\b/i,
  /\b(?:attends|enrolled\s+at|student\s+at)\b/i,
  /\b20\d{2}\s*[-/]\s*(?:20)?\d{2}\s+(?:school|academic)\s+year\b/i,
];

function normalized(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function id(prefix: string, value: string): string {
  return `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

function hostnameMatches(hostname: string, blocked: string): boolean {
  return hostname === blocked || hostname.endsWith(`.${blocked}`);
}

function sourceExclusionReason(
  page: PublicSourcePage,
): ResearchExclusion["reason"] | null {
  let parsed: URL;
  try {
    parsed = new URL(page.url);
  } catch {
    return "unsupported-source";
  }
  if (
    page.access !== "public" ||
    page.acquisition !== "direct-public-page" ||
    parsed.protocol !== "https:"
  ) {
    return "not-public";
  }
  if (
    [...ENRICHMENT_HOSTS].some((blocked) =>
      hostnameMatches(parsed.hostname.toLowerCase(), blocked),
    )
  ) {
    return "enrichment-vendor";
  }
  return null;
}

function splitPublicSentences(content: string): string[] {
  return content
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map(normalized)
    .filter(Boolean);
}

export function publicSentenceHasMinorPersonalData(sentence: string): boolean {
  return PUBLIC_MINOR_CONTEXT_SIGNALS.some((pattern) => pattern.test(sentence));
}

export function scopePublicSources(pages: PublicSourcePage[]): {
  allowed: PublicSourcePage[];
  exclusions: ResearchExclusion[];
} {
  const allowed: PublicSourcePage[] = [];
  const exclusions: ResearchExclusion[] = [];
  for (const page of pages) {
    const reason = sourceExclusionReason(page);
    if (reason) {
      exclusions.push({ sourceRef: id("source", page.url), reason });
      continue;
    }
    if (
      publicSentenceHasMinorPersonalData(page.title) ||
      PUBLIC_PERSONAL_DATA_SIGNALS.some((pattern) =>
        pattern.test(`${page.title}\n${page.content}`),
      )
    ) {
      exclusions.push({
        sourceRef: id("source", page.url),
        reason: "minor-personal-data",
      });
      continue;
    }
    const sentences = splitPublicSentences(page.content);
    const safeSentences = sentences.filter(
      (sentence) => !publicSentenceHasMinorPersonalData(sentence),
    );
    if (safeSentences.length !== sentences.length) {
      exclusions.push({
        sourceRef: id("source", page.url),
        reason: "minor-personal-data",
      });
    }
    if (safeSentences.length > 0) {
      allowed.push({ ...page, content: safeSentences.join(" ") });
    }
  }
  return { allowed, exclusions };
}

function rawRecord(lead: Lead): Record<string, unknown> {
  return lead.raw && typeof lead.raw === "object"
    ? (lead.raw as Record<string, unknown>)
    : {};
}

function evidence(
  kind: ResearchEvidenceKind,
  sourceUrl: string,
  title: string,
  excerpt: string,
  fact: string,
): ResearchEvidence {
  return {
    id: id("evidence", `${kind}|${sourceUrl}|${fact}`),
    kind,
    sourceUrl,
    title,
    excerpt: normalized(excerpt),
    fact: normalized(fact),
  };
}

function prospectEvidence(lead: Lead): ResearchEvidence[] {
  const raw = rawRecord(lead);
  const lines = [
    `Subject: ${lead.subject?.trim() || "Not provided"}`,
    `Request: ${lead.text.trim() || "Not provided"}`,
    `Channel: ${lead.channel}`,
    `Location: ${lead.location?.trim() || "Not provided"}`,
    `Deadline: ${typeof raw.deadline === "string" && raw.deadline.trim() ? raw.deadline.trim() : "Not provided"}`,
    `Preferred next step: ${typeof raw.preferredNextStep === "string" && raw.preferredNextStep.trim() ? raw.preferredNextStep.trim() : "Not provided"}`,
  ];
  const excerpt = lines.join("\n");
  return lines.map((fact) =>
    evidence(
      "prospect-supplied",
      lead.url,
      "Prospect-supplied source record",
      excerpt,
      fact,
    ),
  );
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function icpSection(markdown: string, ref: string): string {
  const anchor = ref.split("#")[1] ?? "";
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => {
    const match = line.match(/^(#{2,6})\s+(.+?)\s*$/);
    return match ? slug(match[2]) === anchor : false;
  });
  if (start < 0) throw new Error(`ICP.md is missing cited section ${ref}.`);
  const level = lines[start].match(/^#+/)?.[0].length ?? 2;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#+)\s+/);
    if (heading && heading[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

function markdownBlocks(section: string): string[] {
  const blocks: string[] = [];
  let current = "";
  const flush = () => {
    if (current) blocks.push(current);
    current = "";
  };
  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("#")) {
      flush();
      continue;
    }
    const item = line.match(/^(?:-|\*|\d+\.)\s+(.+)$/)?.[1];
    if (item) {
      flush();
      current = item;
      continue;
    }
    current = current ? `${current} ${line}` : line;
  }
  flush();
  return blocks;
}

export function selectIcpFact(section: string, lead: Lead): string {
  const candidates = markdownBlocks(section);
  const subject = lead.subject?.toLowerCase();
  const subjectMatch = subject
    ? candidates.find((line) => line.toLowerCase().includes(subject))
    : undefined;
  const criterion = candidates.find(
    (line) =>
      /\b(?:subject|source|consent|partner|grade)\b/i.test(line) &&
      line.length >= 20,
  );
  const selected = subjectMatch ?? criterion ?? candidates[0];
  if (!selected) throw new Error("The cited ICP section has no usable fact.");
  if (!/[.!?;:]$/.test(selected)) {
    throw new Error(
      "The selected ICP fact is not a complete bullet or sentence.",
    );
  }
  return selected;
}

function icpEvidence(lead: Lead, context: AgentContext): ResearchEvidence {
  const qualification = readQualification(lead);
  if (!qualification || qualification.verdict !== "icp_pass") {
    throw new IneligibleResearchProspectError(lead.id);
  }
  const ref =
    qualification.evidence.find((item) => item.ref.startsWith("ICP.md#"))
      ?.ref ?? "ICP.md#wyzant-screen";
  const section = icpSection(context.documents["ICP.md"], ref);
  const fact = selectIcpFact(section, lead);
  return evidence(
    "icp",
    `repo://docs/${ref}`,
    "Ideal Customer Profile",
    section,
    fact,
  );
}

function relevanceTokens(lead: Lead): Set<string> {
  const ignored = new Set([
    "grade",
    "help",
    "prospect",
    "student",
    "that",
    "this",
    "wants",
    "with",
  ]);
  return new Set(
    `${lead.subject ?? ""} ${lead.text}`
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length >= 4 && !ignored.has(token)) ?? [],
  );
}

function firstPublicFact(
  page: PublicSourcePage,
  tokens: ReadonlySet<string>,
): string | undefined {
  const candidates = page.content
    .split(/(?<=[.!?])\s+|\r?\n+/)
    .map(normalized)
    .filter((value) => value.length >= 20 && value.length <= 320);
  return candidates.find((candidate) => {
    if (publicSentenceHasMinorPersonalData(candidate)) return false;
    const words = new Set(candidate.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    return [...tokens].some((token) => words.has(token));
  });
}

function publicEvidence(
  pages: PublicSourcePage[],
  lead: Lead,
): ResearchEvidence[] {
  const tokens = relevanceTokens(lead);
  return pages.flatMap((page) => {
    const fact = firstPublicFact(page, tokens);
    return fact
      ? [evidence("public-web", page.url, page.title, page.content, fact)]
      : [];
  });
}

function claim(claimId: string, item: ResearchEvidence): CitedClaim {
  return { id: claimId, text: item.fact, evidenceIds: [item.id] };
}

function evidenceByPrefix(
  items: ResearchEvidence[],
  prefix: string,
): ResearchEvidence {
  const found = items.find((item) => item.fact.startsWith(prefix));
  if (!found) throw new Error(`Research evidence is missing ${prefix}.`);
  return found;
}

function hookKindForEvidence(item: ResearchEvidence): ResearchHookKind {
  if (item.kind === "public-web") return "public-context";
  if (item.fact.startsWith("Request:")) return "prospect-request";
  if (item.fact.startsWith("Subject:")) return "subject-match";
  if (item.fact.startsWith("Location:")) return "location";
  return "channel";
}

function unknownClaims(
  prospect: ResearchEvidence[],
  publicCount: number,
): { claims: CitedClaim[]; evidence: ResearchEvidence[] } {
  const supportingEvidence: ResearchEvidence[] = [];
  const addProspectGap = (prefix: string, claimId: string) => {
    const item = evidenceByPrefix(prospect, prefix);
    if (!item.fact.endsWith("Not provided")) return null;
    return claim(claimId, item);
  };
  const claims = [
    addProspectGap("Deadline:", "unknown-deadline"),
    addProspectGap("Location:", "unknown-location"),
    addProspectGap("Preferred next step:", "unknown-next-step"),
  ].filter((item): item is CitedClaim => Boolean(item));
  if (publicCount === 0) {
    const sourceCount = evidence(
      "research-log",
      "research://public-source-scope",
      "Research source-scope log",
      "Relevant public research facts recorded: 0",
      "Relevant public research facts recorded: 0",
    );
    supportingEvidence.push(sourceCount);
    claims.push(claim("unknown-public-context", sourceCount));
  }
  const freshness = evidence(
    "research-log",
    "research://freshness-boundary",
    "Research freshness boundary",
    "Information changes after this research run: Not verified",
    "Information changes after this research run: Not verified",
  );
  supportingEvidence.push(freshness);
  claims.push(claim("unknown-future-changes", freshness));
  return { claims, evidence: supportingEvidence };
}

function fitRiskEvidence(
  lead: Lead,
  prospect: ResearchEvidence[],
  publicCount: number,
): ResearchEvidence {
  const subject = lead.subject?.trim() || "this prospect";
  const deadline = evidenceByPrefix(prospect, "Deadline:");
  const location = evidenceByPrefix(prospect, "Location:");
  const nextStep = evidenceByPrefix(prospect, "Preferred next step:");
  let basis: string;
  let fact: string;
  if (deadline.fact.endsWith("Not provided")) {
    basis = deadline.fact;
    fact = `Fit risk for ${subject}: timing cannot be evaluated because the deadline was not provided.`;
  } else if (location.fact.endsWith("Not provided")) {
    basis = location.fact;
    fact = `Fit risk for ${subject}: meeting-format fit cannot be evaluated because location was not provided.`;
  } else if (nextStep.fact.endsWith("Not provided")) {
    basis = nextStep.fact;
    fact = `Fit risk for ${subject}: the desired next step was not provided.`;
  } else if (publicCount === 0) {
    basis = "Relevant public research facts recorded: 0";
    fact = `Fit risk for ${subject}: no relevant public context corroborates the supplied record.`;
  } else {
    basis = "Scoped fit-risk review: complete";
    fact = `Fit risk for ${subject}: none identified in the scoped evidence.`;
  }
  return evidence(
    "research-log",
    `research://fit-risk/${encodeURIComponent(lead.id)}`,
    "Deterministic fit-risk review",
    `${basis}\n${fact}`,
    fact,
  );
}

function confidenceFor(
  publicCount: number,
  qualificationConfidence: number,
): number {
  if (publicCount === 0) return 0.3;
  if (publicCount === 1) return 0.5;
  if (publicCount === 2) return 0.65;
  return Math.min(0.85, qualificationConfidence);
}

export class DeterministicResearchAgent implements ResearchAgent {
  async create(input: {
    lead: Lead;
    context: AgentContext;
    publicSources: PublicSourcePage[];
    exclusions: ResearchExclusion[];
  }): Promise<ResearchBrief> {
    const qualification = readQualification(input.lead);
    if (!qualification || qualification.verdict !== "icp_pass") {
      throw new IneligibleResearchProspectError(input.lead.id);
    }

    const prospect = prospectEvidence(input.lead);
    const icp = icpEvidence(input.lead, input.context);
    const publicItems = publicEvidence(input.publicSources, input.lead);
    const unknowns = unknownClaims(prospect, publicItems.length);
    const fitRisk = fitRiskEvidence(input.lead, prospect, publicItems.length);
    const allEvidence = [
      ...prospect,
      icp,
      ...publicItems,
      ...unknowns.evidence,
      fitRisk,
    ];
    const subject = evidenceByPrefix(prospect, "Subject:");
    const request = evidenceByPrefix(prospect, "Request:");
    const channel = evidenceByPrefix(prospect, "Channel:");
    const location = evidenceByPrefix(prospect, "Location:");
    const hookItems = [
      request,
      subject,
      ...publicItems,
      location,
      channel,
    ].slice(0, 3);
    if (hookItems.length !== 3) {
      throw new Error("Research could not assemble three source-backed hooks.");
    }
    const hooks = hookItems.map((item, index) => ({
      kind: hookKindForEvidence(item),
      claim: claim(`hook-${index + 1}`, item),
    })) as [ResearchHook, ResearchHook, ResearchHook];

    return {
      leadId: input.lead.id,
      whyFit: {
        claims: [claim("fit-prospect", subject), claim("fit-icp", icp)],
      },
      hooks,
      disqualifier: {
        basis: claim("disqualifier-basis", fitRisk),
      },
      unknowns: unknowns.claims,
      confidence: confidenceFor(publicItems.length, qualification.confidence),
      evidence: allEvidence,
      exclusions: input.exclusions,
      contextHash: input.context.hash,
    };
  }
}

function allClaims(brief: ResearchBrief): CitedClaim[] {
  return [
    ...brief.whyFit.claims,
    ...brief.hooks.map((hook) => hook.claim),
    brief.disqualifier.basis,
    ...brief.unknowns,
  ];
}

function evidenceFingerprint(item: ResearchEvidence): string {
  return JSON.stringify([
    item.id,
    item.kind,
    item.sourceUrl,
    item.title,
    normalized(item.excerpt),
    normalized(item.fact),
  ]);
}

function claimFingerprint(item: CitedClaim): string {
  return JSON.stringify([
    item.id,
    normalized(item.text),
    [...item.evidenceIds].sort(),
  ]);
}

export function citationGateIssues(
  brief: ResearchBrief,
  trust?: ResearchBriefTrust,
): CitationGateIssue[] {
  const issues: CitationGateIssue[] = [];
  if (Object.hasOwn(brief.whyFit, "label")) {
    issues.push({
      claimId: "brief.whyFit.label",
      reason: "free-text why-fit labels are forbidden",
    });
  }
  if (Object.hasOwn(brief.disqualifier, "label")) {
    issues.push({
      claimId: "brief.disqualifier.label",
      reason: "free-text disqualifier labels are forbidden",
    });
  }
  brief.hooks.forEach((hook, index) => {
    const number = index + 1;
    if (Object.hasOwn(hook, "angle")) {
      issues.push({
        claimId: `hook-${number}.angle`,
        reason: "free-text hook angles are forbidden",
      });
    }
    if (!Object.hasOwn(RESEARCH_HOOK_LABELS, hook.kind)) {
      issues.push({
        claimId: `hook-${number}.kind`,
        reason: "hook kind is outside the closed vocabulary",
      });
    }
  });
  if (trust) {
    if (brief.leadId !== trust.leadId) {
      issues.push({
        claimId: "brief.leadId",
        reason: "brief lead does not match the scoped prospect",
      });
    }
    if (brief.contextHash !== trust.contextHash) {
      issues.push({
        claimId: "brief.contextHash",
        reason: "brief context does not match the loaded ICP context",
      });
    }
    if (JSON.stringify(brief.exclusions) !== JSON.stringify(trust.exclusions)) {
      issues.push({
        claimId: "brief.exclusions",
        reason: "source exclusions do not match the scoped source registry",
      });
    }
    if (brief.confidence !== trust.confidence) {
      issues.push({
        claimId: "brief.confidence",
        reason: "confidence does not match the scoped evidence calculation",
      });
    }
    brief.hooks.forEach((hook, index) => {
      if (hook.kind !== trust.hooks[index]?.kind) {
        issues.push({
          claimId: `hook-${index + 1}.kind`,
          reason: "hook kind does not match the scoped evidence",
        });
      }
      const trustedClaim = trust.hooks[index]?.claim;
      if (
        !trustedClaim ||
        claimFingerprint(hook.claim) !== claimFingerprint(trustedClaim)
      ) {
        issues.push({
          claimId: `hook-${index + 1}.claim`,
          reason: "hook claim does not match the scoped evidence role",
        });
      }
    });
    if (
      JSON.stringify(brief.whyFit.claims.map(claimFingerprint)) !==
      JSON.stringify(trust.whyFit.claims.map(claimFingerprint))
    ) {
      issues.push({
        claimId: "brief.whyFit.claims",
        reason: "why-fit claims do not match the scoped ICP evidence",
      });
    }
    if (
      claimFingerprint(brief.disqualifier.basis) !==
      claimFingerprint(trust.disqualifier.basis)
    ) {
      issues.push({
        claimId: "brief.disqualifier.basis",
        reason: "disqualifier does not match the deterministic fit-risk review",
      });
    }
    if (
      JSON.stringify(brief.unknowns.map(claimFingerprint)) !==
      JSON.stringify(trust.unknowns.map(claimFingerprint))
    ) {
      issues.push({
        claimId: "brief.unknowns",
        reason: "unknowns do not match the scoped evidence gaps",
      });
    }
  }
  if (brief.hooks.length !== 3) {
    issues.push({
      claimId: "brief.hooks",
      reason: "exactly three hooks are required",
    });
  }
  if (brief.unknowns.length === 0) {
    issues.push({
      claimId: "brief.unknowns",
      reason: "at least one unknown is required",
    });
  }
  if (brief.confidence < 0 || brief.confidence > 1) {
    issues.push({
      claimId: "brief.confidence",
      reason: "confidence must be from 0 to 1",
    });
  }

  const evidenceById = new Map<string, ResearchEvidence>();
  const trustedById = trust
    ? new Map(trust.evidence.map((item) => [item.id, item]))
    : undefined;
  for (const item of brief.evidence) {
    if (evidenceById.has(item.id)) {
      issues.push({ claimId: item.id, reason: "evidence id is duplicated" });
      continue;
    }
    evidenceById.set(item.id, item);
    if (trustedById) {
      const trusted = trustedById.get(item.id);
      if (
        !trusted ||
        evidenceFingerprint(trusted) !== evidenceFingerprint(item)
      ) {
        issues.push({
          claimId: item.id,
          reason: "evidence was not produced from the scoped source registry",
        });
      }
    }
    if (!normalized(item.excerpt).includes(normalized(item.fact))) {
      issues.push({
        claimId: item.id,
        reason: "recorded excerpt does not contain its fact",
      });
    }
    if (item.kind === "public-web") {
      const reason =
        sourceExclusionReason({
          url: item.sourceUrl,
          title: item.title,
          content: item.excerpt,
          access: "public",
          acquisition: "direct-public-page",
        }) ??
        (publicSentenceHasMinorPersonalData(item.excerpt)
          ? "minor-personal-data"
          : null);
      if (reason) {
        issues.push({
          claimId: item.id,
          reason: `public evidence violates source scope: ${reason}`,
        });
      }
    }
  }

  for (const item of allClaims(brief)) {
    if (item.evidenceIds.length === 0) {
      issues.push({ claimId: item.id, reason: "claim has no citation" });
      continue;
    }
    const cited = item.evidenceIds
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter((value): value is ResearchEvidence => Boolean(value));
    if (cited.length !== item.evidenceIds.length) {
      issues.push({
        claimId: item.id,
        reason: "claim cites evidence not recorded in evidence[]",
      });
      continue;
    }
    if (
      !cited.every(
        (source) => normalized(source.fact) === normalized(item.text),
      )
    ) {
      issues.push({
        claimId: item.id,
        reason: "every citation must textually support the claim",
      });
    }
  }
  issues.push(...renderTraceabilityIssues(brief, renderResearchBrief(brief)));
  return issues;
}

function hookLabel(kind: ResearchHookKind): string {
  return Object.hasOwn(RESEARCH_HOOK_LABELS, kind)
    ? RESEARCH_HOOK_LABELS[kind]
    : "Unsupported hook:";
}

function citedEvidence(brief: ResearchBrief): ResearchEvidence[] {
  const citedIds = new Set(
    allClaims(brief).flatMap((item) => item.evidenceIds),
  );
  return brief.evidence.filter((item) => citedIds.has(item.id));
}

export function renderResearchBrief(brief: ResearchBrief): string {
  const lines = [
    `Why fit: ${WHY_FIT_LABEL}`,
    ...brief.whyFit.claims.map(
      (item) => `- ${item.text} [${item.evidenceIds.join(", ")}]`,
    ),
    "Hooks:",
    ...brief.hooks.map(
      (hook, index) =>
        `${index + 1}. ${hookLabel(hook.kind)} ${hook.claim.text} [${hook.claim.evidenceIds.join(", ")}]`,
    ),
    `Disqualifier: ${DISQUALIFIER_LABEL}`,
    `- ${brief.disqualifier.basis.text} [${brief.disqualifier.basis.evidenceIds.join(", ")}]`,
    "Unknowns:",
    ...brief.unknowns.map(
      (unknown) => `- ${unknown.text} [${unknown.evidenceIds.join(", ")}]`,
    ),
    `Confidence: ${brief.confidence.toFixed(2)}`,
    "Sources:",
    ...citedEvidence(brief).map(
      (item) =>
        `- [${item.id}] ${item.title}: ${item.sourceUrl}\n  Evidence: ${item.fact}`,
    ),
  ];
  return lines.join("\n");
}

export function renderTraceabilityIssues(
  brief: ResearchBrief,
  rendered: string,
): CitationGateIssue[] {
  const expected = [
    `Why fit: ${WHY_FIT_LABEL}`,
    ...brief.whyFit.claims.map(
      (item) => `- ${item.text} [${item.evidenceIds.join(", ")}]`,
    ),
    "Hooks:",
    ...brief.hooks.map(
      (hook, index) =>
        `${index + 1}. ${hookLabel(hook.kind)} ${hook.claim.text} [${hook.claim.evidenceIds.join(", ")}]`,
    ),
    `Disqualifier: ${DISQUALIFIER_LABEL}`,
    `- ${brief.disqualifier.basis.text} [${brief.disqualifier.basis.evidenceIds.join(", ")}]`,
    "Unknowns:",
    ...brief.unknowns.map(
      (unknown) => `- ${unknown.text} [${unknown.evidenceIds.join(", ")}]`,
    ),
    `Confidence: ${brief.confidence.toFixed(2)}`,
    "Sources:",
    ...citedEvidence(brief).flatMap((item) => [
      `- [${item.id}] ${item.title}: ${item.sourceUrl}`,
      `  Evidence: ${item.fact}`,
    ]),
  ];
  const actual = rendered.split("\n");
  const issues: CitationGateIssue[] = [];
  const length = Math.max(expected.length, actual.length);
  for (let index = 0; index < length; index += 1) {
    if (actual[index] !== expected[index]) {
      issues.push({
        claimId: `rendered.traceability.line-${index + 1}`,
        reason:
          "rendered text is not traceable to a cited claim or constant vocabulary",
      });
    }
  }
  return issues;
}

export class IneligibleResearchProspectError extends Error {
  constructor(leadId: string) {
    super(
      `${leadId} is not an icp_pass prospect and cannot enter S2 research.`,
    );
    this.name = "IneligibleResearchProspectError";
  }
}

export class ResearchBriefGateError extends Error {
  constructor(public readonly issue: CitationGateIssue) {
    super(`Claim ${issue.claimId} failed citation QA: ${issue.reason}.`);
    this.name = "ResearchBriefGateError";
  }
}
