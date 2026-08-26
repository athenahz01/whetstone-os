import { createScheduledAdapters } from "../../../../lib/adapters";
import { prisma } from "../../../../lib/core/db";
import { checkPollHeartbeat } from "../../../../lib/core/heartbeat";
import {
  createGrowthEngine,
  createAlertsFromEnv,
} from "../../../../lib/core/runtime";
import { secretMatches } from "../../../../lib/http/secret";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!secretMatches(token, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const alerts = createAlertsFromEnv();
  const heartbeat = await checkPollHeartbeat(prisma, alerts, {
    staleAfterMinutes: positiveInteger(
      process.env.WYZANT_HEARTBEAT_STALE_MINUTES,
      45,
    ),
  });
  const adapters = createScheduledAdapters();
  if (adapters.length === 0) {
    return Response.json({
      ok: true,
      polled: 0,
      inserted: 0,
      deduped: 0,
      heartbeat,
    });
  }
  const result = await createGrowthEngine(adapters, prisma, alerts).tick();
  return Response.json({ ok: true, ...result, heartbeat });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
