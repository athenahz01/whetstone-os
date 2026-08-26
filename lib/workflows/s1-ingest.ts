import type { PrismaClient } from "@prisma/client";
import type { AlertService } from "../core/alerts";
import type { GrowthEngine, TickResult } from "../core/engine";
import type { ChannelAdapter, Lead } from "../core/types";
import type { StepContext, Workflow } from "../core/workflow";

export const S1_INGEST_ID = "S1.ingest";

export interface IngestWorkflowOptions {
  adapters: ChannelAdapter[];
  /**
   * Injected rather than imported so a test can drive the workflow without a
   * database. Production passes `createGrowthEngine`.
   */
  createEngine: (
    adapters: ChannelAdapter[],
    client?: PrismaClient,
    alerts?: AlertService,
  ) => Pick<GrowthEngine, "tick">;
  client?: PrismaClient;
  alerts?: AlertService;
}

/**
 * `tick()` as a workflow, not a second orchestrator beside one.
 *
 * This matters for KPI #4. Adapter polling is the most failure-prone thing the
 * system does. If it ran outside the workflow layer, every one of those
 * failures would be invisible to the attempted-runs denominator and the success
 * rate would look excellent precisely because the failures were never counted.
 *
 * Per-adapter isolation still belongs to `engine.ts`, which is byte-frozen: a
 * failing poll cannot kill the tick. What this adds is visibility. Each adapter
 * is wrapped so its failure writes an `exceptions` row on the way past, then
 * rethrows into the engine's own isolation, unchanged.
 */
export function createIngestWorkflow(options: IngestWorkflowOptions): Workflow {
  return {
    id: S1_INGEST_ID,
    goal: "Poll every configured channel, persist new leads, and alert on hot ones.",
    approvalLevel: "GREEN",
    owner: "Athena Huo",
    inputs: [
      {
        doc: "ICP.md",
        why: "Scoring reads the approved subjects and grade range.",
      },
    ],
    tools: [
      {
        name: "channel-adapters",
        access: "read",
        why: "Read-only polling of the operator's own accounts.",
      },
      { name: "table:leads", access: "write", why: "Persist deduped leads." },
      {
        name: "table:drafts",
        access: "write",
        why: "Store the prepared reply for a hot lead.",
      },
      {
        name: "table:metrics_daily",
        access: "write",
        why: "Roll up opportunity counts.",
      },
      {
        name: "alert-email",
        access: "write",
        why: "Notify the operator inbox. Never a prospect.",
      },
    ],
    outputs: [
      { kind: "lead", destination: "table:leads" },
      { kind: "hot-lead-alert", destination: "operator inbox" },
    ],
    steps: [
      {
        id: "poll-and-ingest",
        async run(context: StepContext): Promise<TickResult> {
          const watched = options.adapters.map((adapter) =>
            watchAdapter(adapter, context),
          );
          const engine = options.createEngine(
            watched,
            options.client,
            options.alerts,
          );
          const result = await engine.tick();
          context.measure("s1.leads_polled", result.polled, "leads");
          context.measure("s1.leads_inserted", result.inserted, "leads");
          return result;
        },
      },
    ],
    qaGates: [
      {
        id: "tick-result-shape",
        describe: "The tick returned counts, not a partial or absent result.",
        check({ outputs }) {
          const result = outputs.get("poll-and-ingest") as
            TickResult | undefined;
          return (
            !!result &&
            Number.isInteger(result.polled) &&
            Number.isInteger(result.inserted) &&
            Number.isInteger(result.deduped)
          );
        },
      },
    ],
    handoff: {
      to: "Athena Huo",
      state: "new leads persisted, hot ones alerted, awaiting review",
    },
    escalation: [
      {
        when: "an adapter poll fails",
        who: "Athena Huo",
        how: "exceptions row, and the stale-heartbeat alert if polling stops entirely",
      },
    ],
    measures: [
      { kpi: "s1.leads_polled", unit: "leads" },
      { kpi: "s1.leads_inserted", unit: "leads" },
    ],
    baseline: { taskId: "H-02", minutes: 5 },
  };
}

/**
 * Records the failure, then rethrows so `engine.ts` applies its own isolation
 * unchanged. G5: the adapter name and the error type only, never a lead body.
 */
function watchAdapter(
  adapter: ChannelAdapter,
  context: StepContext,
): ChannelAdapter {
  return {
    name: adapter.name,
    async poll(): Promise<Lead[]> {
      try {
        return await adapter.poll();
      } catch (error) {
        await context.recordException({
          kind: "AdapterPollFailed",
          severity: "warning",
          message: `${adapter.name}: ${error instanceof Error ? error.name : "UnknownError"}`,
        });
        throw error;
      }
    },
    send(lead, approvedMessage) {
      return adapter.send(lead, approvedMessage);
    },
  };
}
