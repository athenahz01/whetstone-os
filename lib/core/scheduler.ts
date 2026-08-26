import { prisma } from "./db";
import {
  limitsFromEnv,
  PrismaFlagStore,
  runGuardedWorkflow,
  type GuardedRunResult,
} from "./governor";
import { PrismaRunStore } from "./run-store";
import { createGrowthEngine } from "./runtime";
import type { AlertService } from "./alerts";
import type { ChannelAdapter } from "./types";
import { createIngestWorkflow } from "../workflows/s1-ingest";
import { registerWorkflow } from "./registry";

/**
 * The single entry point for scheduled ingestion. Both the Vercel cron tick and
 * the GitHub Actions ingest POST come through here, so every attempt writes a
 * `runs` row and none of them can slip past the kill switch or the caps.
 */
export async function runIngest(input: {
  adapters: ChannelAdapter[];
  trigger: string;
  alerts?: AlertService;
}): Promise<GuardedRunResult> {
  const workflow = registerWorkflow(
    createIngestWorkflow({
      adapters: input.adapters,
      createEngine: createGrowthEngine,
      client: prisma,
      alerts: input.alerts,
    }),
  );
  return runGuardedWorkflow(workflow, {
    store: new PrismaRunStore(prisma),
    flags: new PrismaFlagStore(prisma),
    limits: limitsFromEnv(),
    trigger: input.trigger,
  });
}
