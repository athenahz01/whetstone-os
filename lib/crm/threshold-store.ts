import type { PrismaClient } from "@prisma/client";
import { WHETSTONE_ORG_ID } from "../core/organization";
import type { ThresholdAdjustment } from "./thresholds";

/**
 * Recording a threshold that has moved away from its stage default.
 *
 * Section 7 forbids a silent tuning, so the widening is a row before it is a
 * behaviour. `recordAdjustment` and `clearAdjustment` are the whole surface:
 * one says a lead's clock has been slowed and why, the other says the reason
 * has lapsed.
 *
 * Nothing is deleted. A widening that is later cleared leaves a row carrying
 * `clearedAt`, so "we stopped nagging this lead for two months" stays
 * answerable afterwards.
 */
export interface ThresholdRepository {
  recordAdjustment(adjustment: ThresholdAdjustment): Promise<void>;
  /** Marks any live override for these leads as lapsed. */
  clearAdjustments(identities: string[], clearedAt: Date): Promise<void>;
}

export class PrismaThresholdRepository implements ThresholdRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {}

  async recordAdjustment(adjustment: ThresholdAdjustment): Promise<void> {
    const data = {
      orgId: this.orgId,
      leadRef: adjustment.leadRef,
      baseDays: adjustment.baseDays,
      adjustedDays: adjustment.adjustedDays,
      reason: adjustment.reason,
      assertedRunLength: adjustment.assertedRunLength,
      // Re-widening a lead whose run has grown is the same override, not a new
      // one, and it is live again.
      clearedAt: null,
    };
    await this.client.crmThresholdOverride.upsert({
      where: {
        identity_stage: {
          identity: adjustment.identity,
          stage: adjustment.stage,
        },
      },
      create: {
        identity: adjustment.identity,
        stage: adjustment.stage,
        ...data,
      },
      update: data,
    });
  }

  async clearAdjustments(identities: string[], clearedAt: Date): Promise<void> {
    if (identities.length === 0) return;
    await this.client.crmThresholdOverride.updateMany({
      where: { identity: { in: identities }, clearedAt: null },
      data: { clearedAt },
    });
  }
}
