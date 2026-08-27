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

export interface ResearchHook {
  angle: string;
  claim: CitedClaim;
}

export interface ResearchBrief {
  leadId: string;
  whyFit: {
    label: string;
    claims: CitedClaim[];
  };
  hooks: [ResearchHook, ResearchHook, ResearchHook];
  disqualifier: {
    label: string;
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
  "leadId" | "contextHash" | "evidence" | "exclusions"
>;

const ENRICHMENT_HOSTS = new Set([
  "apollo.io",
  "clearbit.com",
  "peopledatalabs.com",
  "rocketreach.co",
  "zoominfo.com",
]);

const MINOR_PERSONAL_DETAIL = [
  /\b(?:age|aged)\s+(?:[1-9]|1[0-7])\b/i,
  /\b(?:[1-9]|1[0-7])[- ]year[- ]old\b/i,
  /\b(?:minor|child|student)\b[\s\S]{0,80}\b(?:home address|phone|email|attends|school)\b/i,
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

function exclusionReason(
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
  if (MINOR_PERSONAL_DETAIL.some((pattern) => pattern.test(page.content))) {
    return "minor-personal-data";
  }
  return null;
}

export function scopePublicSources(pages: PublicSourcePage[]): {
  allowed: PublicSourcePage[];
  exclusions: ResearchExclusion[];
} {
  const allowed: PublicSourcePage[] = [];
  const exclusions: ResearchExclusion[] = [];
  for (const page of pages) {
    const reason = exclusionReason(page);
    if (reason) {
      exclusions.push({ sourceRef: id("source", page.url), reason });
    } else {
      allowed.push(page);
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

function selectIcpFact(section: string, lead: Lead): string {
  const candidates = section
    .split("\n")
    .map((line) => line.trim().replace(/^-\s+/, ""))
    .filter((line) => line && !line.startsWith("#"));
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
    const allEvidence = [
      ...prospect,
      icp,
      ...publicItems,
      ...unknowns.evidence,
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
      angle: `Use source-backed detail ${index + 1} to make the review concrete.`,
      claim: claim(`hook-${index + 1}`, item),
    })) as [ResearchHook, ResearchHook, ResearchHook];

    const disqualifierBasis = unknowns.claims[0];
    if (!disqualifierBasis) {
      throw new Error("Research brief must preserve one honest fit risk.");
    }

    return {
      leadId: input.lead.id,
      whyFit: {
        label: "Fit evidence",
        claims: [claim("fit-prospect", subject), claim("fit-icp", icp)],
      },
      hooks,
      disqualifier: {
        label: "Disqualifying uncertainty",
        basis: {
          ...disqualifierBasis,
          id: "disqualifier-basis",
        },
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

export function citationGateIssues(
  brief: ResearchBrief,
  trust?: ResearchBriefTrust,
): CitationGateIssue[] {
  const issues: CitationGateIssue[] = [];
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
      const reason = exclusionReason({
        url: item.sourceUrl,
        title: item.title,
        content: item.excerpt,
        access: "public",
        acquisition: "direct-public-page",
      });
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
  return issues;
}

export function renderResearchBrief(brief: ResearchBrief): string {
  const lines = [
    `Why fit: ${brief.whyFit.label}`,
    ...brief.whyFit.claims.map(
      (item) => `- ${item.text} [${item.evidenceIds.join(", ")}]`,
    ),
    "Hooks:",
    ...brief.hooks.map(
      (hook, index) =>
        `${index + 1}. ${hook.angle} ${hook.claim.text} [${hook.claim.evidenceIds.join(", ")}]`,
    ),
    `Disqualifier: ${brief.disqualifier.label}`,
    `- ${brief.disqualifier.basis.text} [${brief.disqualifier.basis.evidenceIds.join(", ")}]`,
    "Unknowns:",
    ...brief.unknowns.map(
      (unknown) => `- ${unknown.text} [${unknown.evidenceIds.join(", ")}]`,
    ),
    `Confidence: ${brief.confidence.toFixed(2)}`,
    "Sources:",
    ...brief.evidence.map(
      (item) =>
        `- [${item.id}] ${item.title}: ${item.sourceUrl}\n  Evidence: ${item.fact}`,
    ),
  ];
  return lines.join("\n");
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
