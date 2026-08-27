import { Prisma, type PrismaClient } from "@prisma/client";
import { WHETSTONE_ORG_ID } from "./organization";
import type { ApprovalDecision, RunStore } from "./run-store";
import { renderResearchBrief, type ResearchBrief } from "./research";

export interface SavedResearchBrief {
  id: string;
  runId: string;
  brief: ResearchBrief;
}

export interface ResearchBriefRepository {
  save(runId: string, brief: ResearchBrief): Promise<SavedResearchBrief>;
}

export class PrismaResearchBriefRepository implements ResearchBriefRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {}

  async save(runId: string, brief: ResearchBrief): Promise<SavedResearchBrief> {
    const saved = await this.client.researchBrief.create({
      data: {
        orgId: this.orgId,
        runId,
        leadId: brief.leadId,
        whyFit: asJson(brief.whyFit),
        hooks: asJson(brief.hooks),
        disqualifier: asJson(brief.disqualifier),
        unknowns: asJson(brief.unknowns),
        confidence: brief.confidence,
        evidence: asJson(brief.evidence),
        exclusions: asJson(brief.exclusions),
      },
      select: { id: true },
    });
    return { id: saved.id, runId, brief };
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeArtifact(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/[\t ]+/g, " ");
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function normalizedEditDistance(
  generatedArtifact: string,
  reviewedArtifact: string,
): number {
  const generated = normalizeArtifact(generatedArtifact);
  const reviewed = normalizeArtifact(reviewedArtifact);
  const denominator = Math.max(generated.length, reviewed.length);
  return denominator === 0 ? 0 : levenshtein(generated, reviewed) / denominator;
}

export interface ReviewResearchBriefInput {
  runId: string;
  brief: ResearchBrief;
  reviewedArtifact: string;
  approvedBy: string;
  decision: ApprovalDecision;
  requiredNewResearch: boolean;
}

export async function reviewResearchBrief(
  store: RunStore,
  input: ReviewResearchBriefInput,
): Promise<number> {
  if (!input.approvedBy.trim()) {
    throw new Error("A research brief review requires a named human reviewer.");
  }
  const editDistance = normalizedEditDistance(
    renderResearchBrief(input.brief),
    input.reviewedArtifact,
  );
  await store.recordApproval({
    runId: input.runId,
    level: "YELLOW",
    artifactKind: "research-brief",
    approvedBy: input.approvedBy,
    decision: input.decision,
    editDistance,
    requiredNewResearch: input.requiredNewResearch,
  });
  return editDistance;
}
