import type { Prisma } from "@prisma/client";

export interface MetricsIncrement {
  opportunities?: number;
  replies?: number;
  callsBooked?: number;
  conversions?: number;
  responseTimeTotalMinutes?: number;
  respondedLeadCount?: number;
  revenueCents?: number;
}

export interface MetricsRollupInput {
  orgId: string;
  date: Date;
  tutorId: string;
  tutorName: string;
  product: string;
  increment: MetricsIncrement;
}

export function utcDay(date: Date): Date {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

export async function upsertMetricsRollup(
  transaction: Prisma.TransactionClient,
  input: MetricsRollupInput,
): Promise<void> {
  const date = utcDay(input.date);
  const increment = {
    opportunities: input.increment.opportunities ?? 0,
    replies: input.increment.replies ?? 0,
    callsBooked: input.increment.callsBooked ?? 0,
    conversions: input.increment.conversions ?? 0,
    responseTimeTotalMinutes: input.increment.responseTimeTotalMinutes ?? 0,
    respondedLeadCount: input.increment.respondedLeadCount ?? 0,
    revenueCents: input.increment.revenueCents ?? 0,
  };

  await transaction.metricsDaily.upsert({
    where: {
      orgId_date_tutorId: {
        orgId: input.orgId,
        date,
        tutorId: input.tutorId,
      },
    },
    create: {
      orgId: input.orgId,
      date,
      tutorId: input.tutorId,
      tutorName: input.tutorName,
      product: input.product,
      ...increment,
      source: "live",
    },
    update: {
      tutorName: input.tutorName,
      product: input.product,
      opportunities: { increment: increment.opportunities },
      replies: { increment: increment.replies },
      callsBooked: { increment: increment.callsBooked },
      conversions: { increment: increment.conversions },
      responseTimeTotalMinutes: {
        increment: increment.responseTimeTotalMinutes,
      },
      respondedLeadCount: { increment: increment.respondedLeadCount },
      revenueCents: { increment: increment.revenueCents },
    },
  });
}
