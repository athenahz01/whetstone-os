import { Prisma, type PrismaClient } from "@prisma/client";
import { WHETSTONE_ORG_ID } from "../core/organization";
import type {
  CrmImportSummary,
  CrmRepository,
  StoredCrmDispute,
  StoredCrmLead,
} from "./import";
import { UnknownCrmDisputeError } from "./import";
import type { CrmField, CrmRejection } from "./merge";

/**
 * The database side of the merge.
 *
 * Every write is an upsert keyed on something derived from the source row, so a
 * second import of the same sheets produces the same table rather than a second
 * copy of it. That is the idempotence the acceptance criteria ask for, and it
 * is a property of the keys rather than of a guard the caller has to remember.
 */
export class PrismaCrmRepository implements CrmRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {}

  async upsertLead(lead: StoredCrmLead): Promise<void> {
    const data = {
      orgId: this.orgId,
      leadRef: lead.leadRef,
      tab: lead.tab,
      values: asJson(lead.values),
      statusRaw: lead.statusRaw,
      statusValue: lead.statusValue,
      statusUnmapped: lead.statusUnmapped,
      referrerSourceRaw: lead.referrerSourceRaw,
      referrerSourceValue: lead.referrerSourceValue,
      referrerSourceUnmapped: lead.referrerSourceUnmapped,
      sources: asJson(lead.sources),
    };
    await this.client.crmLead.upsert({
      where: { identity: lead.identity },
      create: { identity: lead.identity, ...data },
      update: data,
    });
  }

  /**
   * Creates a dispute, and leaves an already-ruled one alone.
   *
   * A re-import must not reopen a question somebody has answered. The update
   * branch refreshes the two values under discussion and never touches the
   * resolution columns.
   */
  async upsertDispute(dispute: StoredCrmDispute): Promise<void> {
    await this.client.crmFieldDispute.upsert({
      where: {
        identity_field: { identity: dispute.identity, field: dispute.field },
      },
      create: {
        orgId: this.orgId,
        identity: dispute.identity,
        field: dispute.field,
        workingValue: dispute.workingValue,
        workingSource: dispute.workingSource,
        alternateValue: dispute.alternateValue,
        alternateSource: dispute.alternateSource,
      },
      update: {
        workingValue: dispute.workingValue,
        workingSource: dispute.workingSource,
        alternateValue: dispute.alternateValue,
        alternateSource: dispute.alternateSource,
      },
    });
  }

  async recordRejection(rejection: CrmRejection): Promise<void> {
    await this.client.crmImportRejection.upsert({
      where: {
        source_tab_rowNumber: {
          source: rejection.source,
          tab: rejection.tab,
          rowNumber: rejection.rowNumber,
        },
      },
      create: { orgId: this.orgId, ...rejection },
      update: { reason: rejection.reason },
    });
  }

  async recordImportRun(summary: CrmImportSummary): Promise<void> {
    await this.client.crmImportRun.create({
      data: { orgId: this.orgId, ...summary },
    });
  }

  /**
   * Applies a ruling: one dispute, one field, one lead.
   *
   * In a transaction, because a resolution recorded without the value reaching
   * the lead would leave the question answered and the record still wrong.
   */
  async resolveDispute(input: {
    identity: string;
    field: CrmField;
    resolvedValue: string;
    resolvedBy: string;
    resolvedAt: Date;
  }): Promise<void> {
    await this.client.$transaction(async (transaction) => {
      const dispute = await transaction.crmFieldDispute.findUnique({
        where: {
          identity_field: { identity: input.identity, field: input.field },
        },
        select: { id: true },
      });
      if (!dispute) {
        throw new UnknownCrmDisputeError(input.identity, input.field);
      }
      const lead = await transaction.crmLead.findUnique({
        where: { identity: input.identity },
        select: { values: true },
      });
      if (!lead) throw new UnknownCrmDisputeError(input.identity, input.field);

      await transaction.crmFieldDispute.update({
        where: { id: dispute.id },
        data: {
          resolvedValue: input.resolvedValue,
          resolvedBy: input.resolvedBy,
          resolvedAt: input.resolvedAt,
        },
      });
      await transaction.crmLead.update({
        where: { identity: input.identity },
        data: {
          values: asJson({
            ...((lead.values as Record<string, string>) ?? {}),
            [input.field]: input.resolvedValue,
          }),
        },
      });
    });
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
