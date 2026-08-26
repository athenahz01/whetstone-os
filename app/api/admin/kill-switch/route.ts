import { prisma } from "../../../../lib/core/db";
import {
  KILL_SWITCH_KEY,
  PrismaFlagStore,
} from "../../../../lib/core/governor";
import { secretMatches } from "../../../../lib/http/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The global kill switch, as a route rather than a button.
 *
 * Phase 7 owns `/today` and will put a control on it. Phase 2 must not depend
 * on a surface that does not exist yet, so this route plus the `system_flags`
 * row is the whole mechanism. The scheduler reads the flag on every tick, so
 * stopping the system needs no deploy and no terminal.
 */
function authorized(request: Request): boolean {
  return secretMatches(
    request.headers.get("x-admin-secret"),
    process.env.ADMIN_SECRET,
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const flags = new PrismaFlagStore(prisma);
  return Response.json({ engaged: await flags.isEnabled(KILL_SWITCH_KEY) });
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const engaged = (body as { engaged?: unknown } | null)?.engaged;
  if (typeof engaged !== "boolean") {
    return Response.json(
      { error: "Body must be { engaged: boolean }" },
      { status: 400 },
    );
  }
  const note = (body as { note?: unknown }).note;
  const flags = new PrismaFlagStore(prisma);
  await flags.setEnabled(
    KILL_SWITCH_KEY,
    engaged,
    "admin-route",
    typeof note === "string" ? note.slice(0, 500) : undefined,
  );
  return Response.json({ engaged });
}
