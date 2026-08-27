import { Prisma, type PrismaClient } from "@prisma/client";
import { WHETSTONE_ORG_ID } from "./organization";
import { renderOutreachDraft, type OutreachDraft } from "./outreach";
import { normalizedEditDistance } from "./research-store";
import type { ApprovalDecision, RunStore } from "./run-store";
import type { Lead } from "./types";

export interface SavedOutreachDraft {
  id: string;
  runId: string;
  draft: OutreachDraft;
}

export interface OutreachDraftRepository {
  /**
   * Persists the draft and marks its prospect as having reached
   * ready-for-human-approval, which is what KPI #5 counts. One write, so a
   * saved draft and an uncounted prospect cannot come apart.
   */
  save(runId: string, draft: OutreachDraft): Promise<SavedOutreachDraft>;
}

export class PrismaOutreachDraftRepository implements OutreachDraftRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {}

  async save(runId: string, draft: OutreachDraft): Promise<SavedOutreachDraft> {
    const saved = await this.client.$transaction(async (transaction) => {
      const row = await transaction.outreachDraft.create({
        data: {
          orgId: this.orgId,
          runId,
          leadId: draft.leadId,
          tutorId: draft.tutorId,
          variant: draft.variant,
          channel: draft.channel,
          opening: draft.opening,
          substance: draft.substance,
          plan: draft.plan,
          disqualifier: draft.disqualifier,
          ask: draft.ask,
          citations: asJson(draft.citations),
          contextHash: draft.contextHash,
          renderedBody: renderOutreachDraft(draft),
        },
        select: { id: true },
      });
      await transaction.lead.updateMany({
        where: { id: draft.leadId, orgId: this.orgId, icpPassReadyAt: null },
        data: { icpPassReadyAt: new Date() },
      });
      return row;
    });
    return { id: saved.id, runId, draft };
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export interface ReviewOutreachDraftInput {
  runId: string;
  draft: OutreachDraft;
  /** What the human actually approved, after any edits. */
  reviewedArtifact: string;
  approvedBy: string;
  decision: ApprovalDecision;
  /** Set by the reviewer when the edit sent them back to a source. */
  requiredNewResearch: boolean;
}

/**
 * Records the human decision. Every approval carries an edit distance, computed
 * by the formula frozen in docs/BASELINES.md, so KPI #3 reads real numbers
 * rather than a recomputation done a friendlier way at report time.
 *
 * The threshold itself lives in `lib/core/kpi.ts` and is not applied here. This
 * function stores the measurement; the KPI applies the definition.
 */
export async function reviewOutreachDraft(
  store: RunStore,
  input: ReviewOutreachDraftInput,
): Promise<number> {
  if (!input.approvedBy.trim()) {
    throw new Error("An outreach review requires a named human reviewer.");
  }
  const editDistance = normalizedEditDistance(
    renderOutreachDraft(input.draft),
    input.reviewedArtifact,
  );
  await store.recordApproval({
    runId: input.runId,
    level: "YELLOW",
    artifactKind: "outreach-draft",
    approvedBy: input.approvedBy,
    decision: input.decision,
    editDistance,
    requiredNewResearch: input.requiredNewResearch,
  });
  return editDistance;
}

export class OutreachNotApprovedError extends Error {
  constructor(runId: string) {
    super(
      `Run ${runId} has no human approval row, so no compose box may be opened.`,
    );
    this.name = "OutreachNotApprovedError";
  }
}

export interface PrefillAdapter {
  name: string;
  send(lead: Lead, approvedMessage: string): Promise<{ prefillUrl?: string }>;
}

/**
 * G1, at the only point in this phase that touches the outside.
 *
 * This prepares a compose box. It does not submit one, and there is no
 * parameter, flag or branch here that would. The capability is absent rather
 * than disabled. It also refuses to run at all without a human approval row, so
 * an unreviewed draft cannot reach a prefill either.
 *
 * `sent_by` is not written here and never will be. A human presses send in
 * Wyzant's own interface and Phase 6 records that they did.
 */
export async function prepareApprovedPrefill(
  store: RunStore,
  input: {
    runId: string;
    lead: Lead;
    adapter: PrefillAdapter;
    approvedMessage: string;
  },
): Promise<{ prefillUrl?: string; approvedBy: string }> {
  const approval = await store.findGrantingApproval(input.runId);
  if (!approval || !approval.approvedBy.trim()) {
    throw new OutreachNotApprovedError(input.runId);
  }
  const result = await input.adapter.send(input.lead, input.approvedMessage);
  return { prefillUrl: result.prefillUrl, approvedBy: approval.approvedBy };
}
