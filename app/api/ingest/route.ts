import { BatchAdapter } from "../../../lib/adapters/batch";
import { prisma } from "../../../lib/core/db";
import {
  recordPollHeartbeat,
  WYZANT_POLL_HEARTBEAT,
} from "../../../lib/core/heartbeat";
import { runIngest } from "../../../lib/core/scheduler";
import type { Lead } from "../../../lib/core/types";
import { secretMatches } from "../../../lib/http/secret";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (
    !secretMatches(
      request.headers.get("x-ingest-secret"),
      process.env.INGEST_SECRET,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isLeadBatch(body)) {
    return Response.json({ error: "Invalid lead batch" }, { status: 400 });
  }
  const guarded = await runIngest({
    adapters: [new BatchAdapter(body.leads)],
    trigger: "github-actions-ingest",
  });
  if (!guarded.started) {
    return Response.json(
      { ok: false, refused: guarded.kind, message: guarded.message },
      { status: 503 },
    );
  }
  if (body.heartbeat) {
    await recordPollHeartbeat(
      prisma,
      WYZANT_POLL_HEARTBEAT,
      new Date(body.heartbeat.ranAt),
    );
  }
  const result = guarded.run.outputs.get("poll-and-ingest") ?? {
    polled: 0,
    inserted: 0,
    deduped: 0,
  };
  return Response.json({
    ok: guarded.run.status === "succeeded",
    runId: guarded.run.runId,
    status: guarded.run.status,
    ...result,
  });
}

interface IngestBatch {
  leads: Lead[];
  heartbeat?: { source: typeof WYZANT_POLL_HEARTBEAT; ranAt: string };
}

function isLeadBatch(value: unknown): value is IngestBatch {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { leads?: unknown; heartbeat?: unknown };
  const leads = candidate.leads;
  if (!Array.isArray(leads) || leads.length > 100) return false;
  const heartbeat = candidate.heartbeat;
  if (
    heartbeat !== undefined &&
    (!heartbeat ||
      typeof heartbeat !== "object" ||
      (heartbeat as { source?: unknown }).source !== WYZANT_POLL_HEARTBEAT ||
      typeof (heartbeat as { ranAt?: unknown }).ranAt !== "string" ||
      Number.isNaN(Date.parse((heartbeat as { ranAt: string }).ranAt)))
  ) {
    return false;
  }
  return leads.every((lead) => {
    if (!lead || typeof lead !== "object") return false;
    const item = lead as Record<string, unknown>;
    return (
      typeof item.id === "string" &&
      /^[a-f0-9]{64}$/.test(item.id) &&
      typeof item.channel === "string" &&
      typeof item.author === "string" &&
      typeof item.text === "string" &&
      item.text.length <= 20_000 &&
      typeof item.url === "string" &&
      isHttpUrl(item.url) &&
      typeof item.postedAt === "string" &&
      !Number.isNaN(Date.parse(item.postedAt))
    );
  });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
