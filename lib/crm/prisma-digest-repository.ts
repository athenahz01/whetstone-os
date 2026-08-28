import { Prisma, type PrismaClient } from "@prisma/client";
import { WHETSTONE_ORG_ID } from "../core/organization";
import type {
  DigestActionRepository,
  LeadActionRecord,
  SnoozeRecord,
} from "./digest-actions";
import { PrismaTouchRepository } from "./prisma-touch-repository";
import type { TouchRecord } from "./touches";

export class DisputedStageError extends Error {
  constructor(identity: string) {
    super(
      `Refusing to change the stage on ${identity}: the two files disagree about it and nobody has ruled.`,
    );
    this.name = "DisputedStageError";
  }
}

/**
 * The database side of a reply.
 *
 * Every write is keyed so that answering the same message twice is one row.
 * That matters more here than anywhere else in the phase: a reply arrives from
 * a person on a phone, and a person on a phone taps twice.
 */
export class PrismaDigestRepository implements DigestActionRepository {
  private readonly touchRepository: PrismaTouchRepository;

  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {
    this.touchRepository = new PrismaTouchRepository(client, orgId);
  }

  async recordAction(action: LeadActionRecord): Promise<void> {
    await this.client.crmLeadAction.upsert({
      where: {
        identity_action_digestDate: {
          identity: action.identity,
          action: action.action,
          digestDate: action.digestDate,
        },
      },
      create: { orgId: this.orgId, ...action },
      // The first answer stands. A second tap does not restamp who decided or
      // when, which is what makes the audit row worth having.
      update: {},
    });
  }

  async recordSnooze(snooze: SnoozeRecord): Promise<void> {
    await this.client.crmSnooze.upsert({
      where: {
        identity_until: { identity: snooze.identity, until: snooze.until },
      },
      create: { orgId: this.orgId, ...snooze },
      update: {},
    });
  }

  /**
   * Marks a lead lost, in one transaction with a re-read of the stage.
   *
   * The stage is checked here and not only at the clock, because a reply can
   * arrive long after the message was built and the dispute may have appeared
   * in between. Acting on one of two disagreeing values is choosing between
   * them, which is the thing 7.5a refuses to do on a human's behalf.
   */
  async markLost(input: {
    identity: string;
    actor: string;
    actedAt: Date;
  }): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      const disputed = await transaction.crmFieldDispute.findUnique({
        where: {
          identity_field: { identity: input.identity, field: "status" },
        },
        select: { resolvedAt: true },
      });
      if (disputed && disputed.resolvedAt === null) {
        throw new DisputedStageError(input.identity);
      }
      const lead = await transaction.crmLead.findUnique({
        where: { identity: input.identity },
        select: { values: true },
      });
      if (!lead) throw new DisputedStageError(input.identity);

      await transaction.crmLead.update({
        where: { identity: input.identity },
        data: {
          values: {
            ...((lead.values as Record<string, string>) ?? {}),
            status: "Lost",
          } as Prisma.InputJsonValue,
          statusRaw: "Lost",
          statusValue: "Lost",
          statusUnmapped: false,
        },
      });
    });
  }

  async upsertTouch(touch: TouchRecord): Promise<void> {
    await this.touchRepository.upsertTouch(touch);
  }
}
