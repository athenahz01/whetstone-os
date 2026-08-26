import { Prisma, type PrismaClient } from "@prisma/client";
import { upsertMetricsRollup } from "./metrics-rollup";
import { WHETSTONE_ORG_ID } from "./organization";
import type { Draft, Lead } from "./types";

export interface LeadState {
  score: number;
  alertReservedAt: Date | null;
}

export interface StoredLead {
  lead: Lead;
  score: number;
  draft?: Draft;
}

export interface LeadStore {
  getLeadState(id: string): Promise<LeadState | null>;
  saveLead(input: StoredLead): Promise<void>;
  reserveAlert(id: string, at: Date): Promise<boolean>;
  markAlerted(id: string, at: Date): Promise<void>;
}

export class PrismaLeadStore implements LeadStore {
  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {}

  async getLeadState(id: string): Promise<LeadState | null> {
    return this.client.lead.findFirst({
      where: { id, orgId: this.orgId },
      select: { score: true, alertReservedAt: true },
    });
  }

  async saveLead({ lead, score, draft }: StoredLead): Promise<void> {
    const requestedTutorId = lead.tutorId ?? draft?.tutorId;
    await this.client.$transaction(async (transaction) => {
      const tutor =
        requestedTutorId && requestedTutorId !== "unassigned"
          ? await transaction.tutor.findFirst({
              where: { id: requestedTutorId, orgId: this.orgId },
              select: { id: true, name: true, product: true },
            })
          : null;
      await transaction.lead.create({
        data: {
          id: lead.id,
          orgId: this.orgId,
          channel: lead.channel,
          author: lead.author,
          text: lead.text,
          subject: lead.subject,
          location: lead.location,
          url: lead.url,
          postedAt: new Date(lead.postedAt),
          raw: toJson(lead.raw),
          score,
          tutorId: tutor?.id,
          drafts: draft
            ? {
                create: {
                  orgId: this.orgId,
                  tutorId: draft.tutorId,
                  variant: draft.variant,
                  body: draft.body,
                },
              }
            : undefined,
        },
      });
      if (tutor) {
        await upsertMetricsRollup(transaction, {
          orgId: this.orgId,
          date: new Date(lead.postedAt),
          tutorId: tutor.id,
          tutorName: tutor.name,
          product: tutor.product,
          increment: { opportunities: 1 },
        });
      }
    });
  }

  async reserveAlert(id: string, at: Date): Promise<boolean> {
    const result = await this.client.lead.updateMany({
      where: { id, orgId: this.orgId, alertReservedAt: null },
      data: { alertReservedAt: at },
    });
    return result.count === 1;
  }

  async markAlerted(id: string, at: Date): Promise<void> {
    await this.client.lead.updateMany({
      where: { id, orgId: this.orgId },
      data: { alertedAt: at },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
