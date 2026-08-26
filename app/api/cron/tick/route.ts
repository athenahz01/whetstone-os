import { createScheduledAdapters } from "../../../../lib/adapters";
import { createGrowthEngine } from "../../../../lib/core/runtime";
import { secretMatches } from "../../../../lib/http/secret";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!secretMatches(token, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const adapters = createScheduledAdapters();
  if (adapters.length === 0) {
    return Response.json({ ok: true, polled: 0, inserted: 0, deduped: 0 });
  }
  const result = await createGrowthEngine(adapters).tick();
  return Response.json({ ok: true, ...result });
}
