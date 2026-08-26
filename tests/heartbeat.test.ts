import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ExceptionAlertService } from "../lib/core/alerts";
import {
  checkPollHeartbeat,
  recordPollHeartbeat,
  WYZANT_POLL_HEARTBEAT,
} from "../lib/core/heartbeat";
import { WHETSTONE_ORG_ID } from "../lib/core/organization";

function clientWithHeartbeat(
  heartbeat: {
    lastRunAt: Date | null;
    staleAlertedAt: Date | null;
    createdAt: Date;
  } | null,
) {
  const upsert = vi.fn(async () => ({}));
  const findUnique = vi.fn(async () => heartbeat);
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const create = vi.fn(async () => ({}));
  const client = {
    pollHeartbeat: { upsert, findUnique, updateMany, create },
  } as unknown as PrismaClient;
  return { client, upsert, findUnique, updateMany, create };
}

function alertService(enabled = true) {
  const notifyException = vi.fn(async () => undefined);
  const service: ExceptionAlertService = {
    isEnabled: () => enabled,
    notifyException,
  };
  return { service, notifyException };
}

describe("scheduled poll heartbeat", () => {
  it("records a successful run and clears the stale-alert latch", async () => {
    const { client, upsert } = clientWithHeartbeat(null);
    const at = new Date("2026-08-26T18:00:00.000Z");
    await recordPollHeartbeat(client, WYZANT_POLL_HEARTBEAT, at);
    expect(upsert).toHaveBeenCalledWith({
      where: {
        orgId_source: {
          orgId: WHETSTONE_ORG_ID,
          source: WYZANT_POLL_HEARTBEAT,
        },
      },
      create: {
        orgId: WHETSTONE_ORG_ID,
        source: WYZANT_POLL_HEARTBEAT,
        lastRunAt: at,
      },
      update: { lastRunAt: at, staleAlertedAt: null },
    });
  });

  it("distinguishes a never-started poll from a quiet successful poll", async () => {
    const missing = clientWithHeartbeat(null);
    const alerts = alertService();
    await expect(
      checkPollHeartbeat(missing.client, alerts.service),
    ).resolves.toEqual({ state: "not-started" });
    expect(missing.create).toHaveBeenCalledWith({
      data: {
        orgId: WHETSTONE_ORG_ID,
        source: WYZANT_POLL_HEARTBEAT,
        lastRunAt: null,
      },
    });

    const fresh = clientWithHeartbeat({
      lastRunAt: new Date("2026-08-26T17:45:00.000Z"),
      staleAlertedAt: null,
      createdAt: new Date("2026-08-26T17:00:00.000Z"),
    });
    await expect(
      checkPollHeartbeat(fresh.client, alerts.service, {
        now: new Date("2026-08-26T18:00:00.000Z"),
        staleAfterMinutes: 45,
      }),
    ).resolves.toEqual({
      state: "fresh",
      lastRunAt: "2026-08-26T17:45:00.000Z",
    });
    expect(alerts.notifyException).not.toHaveBeenCalled();
  });

  it("alerts and latches one stale-heartbeat exception", async () => {
    const { client, updateMany } = clientWithHeartbeat({
      lastRunAt: new Date("2026-08-26T16:00:00.000Z"),
      staleAlertedAt: null,
      createdAt: new Date("2026-08-26T15:00:00.000Z"),
    });
    const alerts = alertService();
    await expect(
      checkPollHeartbeat(client, alerts.service, {
        now: new Date("2026-08-26T18:00:00.000Z"),
        staleAfterMinutes: 45,
      }),
    ).resolves.toMatchObject({ state: "stale-alerted" });
    expect(alerts.notifyException).toHaveBeenCalledWith(
      "Wyzant poll heartbeat is stale",
      expect.stringContaining("GitHub Actions billing"),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orgId: WHETSTONE_ORG_ID,
          source: WYZANT_POLL_HEARTBEAT,
          staleAlertedAt: null,
        }),
      }),
    );
  });

  it("does not latch a stale alert while Telegram is disabled", async () => {
    const { client, updateMany } = clientWithHeartbeat({
      lastRunAt: new Date("2026-08-26T16:00:00.000Z"),
      staleAlertedAt: null,
      createdAt: new Date("2026-08-26T15:00:00.000Z"),
    });
    const alerts = alertService(false);
    await expect(
      checkPollHeartbeat(client, alerts.service, {
        now: new Date("2026-08-26T18:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ state: "stale" });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("alerts when a newly monitored workflow never completes", async () => {
    const { client } = clientWithHeartbeat({
      lastRunAt: null,
      staleAlertedAt: null,
      createdAt: new Date("2026-08-26T16:00:00.000Z"),
    });
    const alerts = alertService();
    await expect(
      checkPollHeartbeat(client, alerts.service, {
        now: new Date("2026-08-26T18:00:00.000Z"),
      }),
    ).resolves.toMatchObject({ state: "stale-alerted" });
    expect(alerts.notifyException).toHaveBeenCalledWith(
      "Wyzant poll heartbeat is stale",
      expect.stringContaining("never completed successfully"),
    );
  });
});
