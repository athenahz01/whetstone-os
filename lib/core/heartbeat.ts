import type { PrismaClient } from "@prisma/client";
import type { ExceptionAlertService } from "./alerts";
import { WHETSTONE_ORG_ID } from "./organization";

export const WYZANT_POLL_HEARTBEAT = "wyzant-github-actions";

export async function recordPollHeartbeat(
  client: PrismaClient,
  source: string,
  lastRunAt: Date,
  orgId = WHETSTONE_ORG_ID,
): Promise<void> {
  await client.pollHeartbeat.upsert({
    where: { orgId_source: { orgId, source } },
    create: { orgId, source, lastRunAt },
    update: { lastRunAt, staleAlertedAt: null },
  });
}

export interface HeartbeatCheck {
  state: "not-started" | "fresh" | "stale" | "stale-alerted";
  lastRunAt?: string;
}

export async function checkPollHeartbeat(
  client: PrismaClient,
  alerts: ExceptionAlertService,
  options: {
    source?: string;
    now?: Date;
    staleAfterMinutes?: number;
    orgId?: string;
  } = {},
): Promise<HeartbeatCheck> {
  const source = options.source ?? WYZANT_POLL_HEARTBEAT;
  const orgId = options.orgId ?? WHETSTONE_ORG_ID;
  const heartbeat = await client.pollHeartbeat.findUnique({
    where: { orgId_source: { orgId, source } },
    select: { lastRunAt: true, staleAlertedAt: true, createdAt: true },
  });
  const now = options.now ?? new Date();
  const staleAfterMinutes = options.staleAfterMinutes ?? 45;
  if (!heartbeat) {
    await client.pollHeartbeat.create({
      data: { orgId, source, lastRunAt: null },
    });
    return { state: "not-started" };
  }
  const staleBefore = new Date(now.getTime() - staleAfterMinutes * 60_000);
  const observedAt = heartbeat.lastRunAt ?? heartbeat.createdAt;
  if (observedAt > staleBefore) {
    if (!heartbeat.lastRunAt) return { state: "not-started" };
    return { state: "fresh", lastRunAt: heartbeat.lastRunAt.toISOString() };
  }
  if (heartbeat.staleAlertedAt) {
    return {
      state: "stale-alerted",
      lastRunAt: heartbeat.lastRunAt?.toISOString(),
    };
  }
  if (!alerts.isEnabled()) {
    await alerts.notifyException(
      "Wyzant poll heartbeat is stale",
      heartbeat.lastRunAt
        ? `No successful poll since ${heartbeat.lastRunAt.toISOString()}.`
        : "The scheduled Wyzant poll has never completed successfully.",
    );
    return { state: "stale", lastRunAt: heartbeat.lastRunAt?.toISOString() };
  }
  await alerts.notifyException(
    "Wyzant poll heartbeat is stale",
    heartbeat.lastRunAt
      ? `No successful poll since ${heartbeat.lastRunAt.toISOString()}. Check GitHub Actions billing, scheduling, and session state.`
      : "The scheduled Wyzant poll has never completed successfully. Check GitHub Actions secrets, billing, and scheduling.",
  );
  await client.pollHeartbeat.updateMany({
    where: {
      orgId,
      source,
      lastRunAt: heartbeat.lastRunAt,
      createdAt: heartbeat.createdAt,
      staleAlertedAt: null,
    },
    data: { staleAlertedAt: now },
  });
  return {
    state: "stale-alerted",
    lastRunAt: heartbeat.lastRunAt?.toISOString(),
  };
}
