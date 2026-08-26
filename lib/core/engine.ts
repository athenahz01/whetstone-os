import type { AlertService } from "./alerts";
import { DraftingUnavailableError, type DraftService } from "./drafting";
import type { LeadStore } from "./lead-store";
import { scoreLead } from "./scoring";
import type { ChannelAdapter } from "./types";

export interface TickResult {
  polled: number;
  inserted: number;
  deduped: number;
}

interface EngineDependencies {
  adapters: ChannelAdapter[];
  store: LeadStore;
  drafts: DraftService;
  alerts: AlertService;
  hotLeadThreshold?: number;
}

export class GrowthEngine {
  constructor(private readonly dependencies: EngineDependencies) {}

  async tick(): Promise<TickResult> {
    const result: TickResult = {
      polled: 0,
      inserted: 0,
      deduped: 0,
    };

    for (const adapter of this.dependencies.adapters) {
      let leads: Awaited<ReturnType<ChannelAdapter["poll"]>>;
      try {
        leads = await adapter.poll();
      } catch (error) {
        console.error("[engine:adapter-poll-failed]", {
          adapter: adapter.name,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        continue;
      }
      result.polled += leads.length;

      for (const lead of leads) {
        const existing = await this.dependencies.store.getLeadState(lead.id);
        if (existing) {
          result.deduped += 1;
          await this.alertIfNeeded(
            lead,
            existing.score,
            existing.alertReservedAt,
          );
          continue;
        }

        const score = scoreLead(lead);
        let draft;

        if (score >= (this.dependencies.hotLeadThreshold ?? 70)) {
          try {
            draft = await this.dependencies.drafts.create(lead);
          } catch (error) {
            if (error instanceof DraftingUnavailableError) {
              console.warn("[drafting:disabled]", { reason: error.message });
            } else {
              throw error;
            }
          }
        }

        await this.dependencies.store.saveLead({ lead, score, draft });
        await this.alertIfNeeded(lead, score, null);
        result.inserted += 1;
      }
    }

    return result;
  }

  private async alertIfNeeded(
    lead: Parameters<AlertService["notify"]>[0],
    score: number,
    alertReservedAt: Date | null,
  ): Promise<void> {
    if (score < (this.dependencies.hotLeadThreshold ?? 70) || alertReservedAt) {
      return;
    }

    if (!this.dependencies.alerts.isEnabled()) {
      await this.dependencies.alerts.notify(lead, score);
      return;
    }

    const reserved = await this.dependencies.store.reserveAlert(
      lead.id,
      new Date(),
    );
    if (!reserved) return;

    await this.dependencies.alerts.notify(lead, score);
    await this.dependencies.store.markAlerted(lead.id, new Date());
  }
}
