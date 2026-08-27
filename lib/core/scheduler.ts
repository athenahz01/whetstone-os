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
import type { QualificationBatch } from "../workflows/s1-qualify";
import { createIngestWorkflow } from "../workflows/s1-ingest";
import { createQualifyWorkflow } from "../workflows/s1-qualify";
import { BatchAdapter } from "../adapters/batch";
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

export interface ProspectingRunResult {
  qualification: GuardedRunResult;
  ingest?: GuardedRunResult;
}

/**
 * Phase 3's two recorded workflows. Qualification owns polling, cross-channel
 * dedupe, and the ICP evidence. Only those enriched leads cross into ingest,
 * so every persisted prospect carries its verdict in `raw.qualification`.
 */
export async function runProspecting(input: {
  adapters: ChannelAdapter[];
  trigger: string;
  alerts?: AlertService;
}): Promise<ProspectingRunResult> {
  const store = new PrismaRunStore(prisma);
  const flags = new PrismaFlagStore(prisma);
  const limits = limitsFromEnv();
  const qualification = await runGuardedWorkflow(
    registerWorkflow(createQualifyWorkflow({ adapters: input.adapters })),
    { store, flags, limits, trigger: input.trigger },
  );
  if (!qualification.started || qualification.run.status !== "succeeded") {
    return { qualification };
  }
  const batch = qualification.run.outputs.get(
    "poll-dedupe-qualify",
  ) as QualificationBatch;
  const ingest = await runIngest({
    adapters: [new BatchAdapter(batch.leads)],
    trigger: `${input.trigger}:qualified`,
    alerts: input.alerts,
  });
  return { qualification, ingest };
}
