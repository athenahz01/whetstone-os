import type { PrismaClient } from "@prisma/client";
import { WHETSTONE_ORG_ID } from "../core/organization";
import type { TouchRepository, TouchScanRecord } from "./touch-store";
import type { TouchRecord, UnmatchedTouch } from "./touches";

/**
 * The database side of touch detection.
 *
 * A touch is written as an upsert on `(identity, basis, sourceRef)`, so a scan
 * that reads the same window twice writes the same rows twice and the table is
 * unchanged. The update branch is deliberately narrow: re-reading a message
 * cannot rewrite when it happened or who asserted it, because the only thing
 * that could legitimately have changed is a calendar event moving between
 * scheduled and occurred.
 */
export class PrismaTouchRepository implements TouchRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {}

  async upsertTouch(touch: TouchRecord): Promise<void> {
    await this.client.crmTouch.upsert({
      where: {
        identity_basis_sourceRef: {
          identity: touch.identity,
          basis: touch.basis,
          sourceRef: touch.sourceRef,
        },
      },
      create: { orgId: this.orgId, ...touch },
      // A booked call that has since happened is the one legitimate change.
      update: { state: touch.state, occurredAt: touch.occurredAt },
    });
  }

  /**
   * Records a candidate that matched nothing.
   *
   * Kept rather than discarded, and keyed on the scan that saw it, so a day
   * with fifty unmatched messages and a day with none are visibly different
   * afterwards.
   */
  async recordUnmatched(
    unmatched: UnmatchedTouch & { scannedAt: Date },
  ): Promise<void> {
    await this.client.crmTouchUnmatched.upsert({
      where: {
        basis_sourceRef_scannedAt: {
          basis: unmatched.basis,
          sourceRef: unmatched.sourceRef,
          scannedAt: unmatched.scannedAt,
        },
      },
      create: { orgId: this.orgId, ...unmatched },
      update: { candidateLeads: unmatched.candidateLeads },
    });
  }

  /** Always a create. Every attempt is its own row, including the failures. */
  async recordScan(scan: TouchScanRecord): Promise<void> {
    await this.client.crmTouchScan.create({
      data: { orgId: this.orgId, ...scan },
    });
  }
}
