import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AlertService } from "../lib/core/alerts";
import { ClaudeDraftService, type ClaudeClient } from "../lib/core/drafting";
import { GrowthEngine } from "../lib/core/engine";
import type { LeadStore, StoredLead } from "../lib/core/lead-store";
import { upsertMetricsRollup, utcDay } from "../lib/core/metrics-rollup";
import { promptVariants, selectPromptVariant } from "../lib/core/prompts";
import { scoreLead } from "../lib/core/scoring";
import type { ChannelAdapter, Lead } from "../lib/core/types";
import { draftService, lead } from "./helpers";

class SequencingStore implements LeadStore {
  readonly records = new Map<string, StoredLead>();
  readonly reserved = new Map<string, Date>();
  readonly events: string[] = [];

  async getLeadState(id: string) {
    const record = this.records.get(id);
    return record
      ? { score: record.score, alertReservedAt: this.reserved.get(id) ?? null }
      : null;
  }

  async saveLead(input: StoredLead) {
    this.events.push("save");
    this.records.set(input.lead.id, input);
  }

  async reserveAlert(id: string, at: Date) {
    if (this.reserved.has(id)) return false;
    this.events.push("reserve");
    this.reserved.set(id, at);
    return true;
  }

  async markAlerted() {
    this.events.push("mark-delivered");
  }
}

function adapterFor(item: Lead): ChannelAdapter {
  return {
    name: "test",
    poll: async () => [item],
    send: async () => ({ prefillUrl: item.url }),
  };
}

describe("salvaged core behavior", () => {
  it("preserves generic scoring, urgency, and the score ceiling", () => {
    expect(
      scoreLead(
        lead({
          priority: undefined,
          subject: undefined,
          location: undefined,
          text: "General note",
        }),
      ),
    ).toBe(26);
    expect(scoreLead(lead({ priority: "high" }))).toBe(100);
    expect(
      scoreLead(
        lead({
          text: "Looking for tutor help with SAT admissions application essay",
        }),
      ),
    ).toBe(100);
  });

  it("keeps three deterministic drafting variants", () => {
    expect(promptVariants).toHaveLength(3);
    expect(selectPromptVariant("stable-lead")).toEqual(
      selectPromptVariant("stable-lead"),
    );
  });

  it("drafts from approved context and stores the tagged result", async () => {
    let request: Parameters<ClaudeClient["messages"]["create"]>[0] | undefined;
    const create: ClaudeClient["messages"]["create"] = async (input) => {
      request = input;
      return { content: [{ type: "text", text: "Specific draft" }] };
    };
    const drafts = new ClaudeDraftService({
      client: { messages: { create } },
      profiles: {
        async getForTutor() {
          return {
            tutorId: "t1",
            tutorName: "Cole",
            product: "Admissions",
            copy: "Profile",
            faq: {},
          };
        },
      },
      context: async () => ({
        hash: "context-hash",
        documents: {} as never,
        promptText: "Approved facts",
      }),
    });
    const result = await drafts.create(lead());
    expect(result.body).toBe("Specific draft");
    expect(promptVariants.map((variant) => variant.id)).toContain(
      result.variant,
    );
    if (!request) throw new Error("Claude request was not captured.");
    expect(request.system).toContain("context-hash");
    expect(request.messages[0].content).toContain("College Counseling");
  });

  it("saves and reserves before alerting and deduplicates the alert", async () => {
    const store = new SequencingStore();
    const alerts: AlertService = {
      isEnabled: () => true,
      notify: vi.fn(async () => {
        store.events.push("notify");
      }),
    };
    const engine = new GrowthEngine({
      adapters: [adapterFor(lead())],
      store,
      drafts: draftService,
      alerts,
    });
    await engine.tick();
    await engine.tick();
    expect(alerts.notify).toHaveBeenCalledOnce();
    expect(store.events).toEqual([
      "save",
      "reserve",
      "notify",
      "mark-delivered",
    ]);
  });

  it("keeps a hot alert pending when notifications are disabled", async () => {
    const store = new SequencingStore();
    const alerts: AlertService = {
      isEnabled: () => false,
      notify: vi.fn(async () => undefined),
    };
    const engine = new GrowthEngine({
      adapters: [adapterFor(lead())],
      store,
      drafts: draftService,
      alerts,
    });
    await engine.tick();
    expect(store.reserved).toHaveLength(0);
    expect(alerts.notify).toHaveBeenCalledOnce();
  });

  it("normalizes UTC days and tenant-scopes metrics upserts", async () => {
    const upsert = vi.fn(async () => ({}));
    const transaction = {
      metricsDaily: { upsert },
    } as unknown as Prisma.TransactionClient;
    await upsertMetricsRollup(transaction, {
      orgId: "00000000-0000-0000-0000-000000000001",
      date: new Date("2026-08-26T19:30:00.000Z"),
      tutorId: "t1",
      tutorName: "Cole",
      product: "Admissions",
      increment: { opportunities: 1 },
    });
    expect(utcDay(new Date("2026-08-26T19:30:00.000Z"))).toEqual(
      new Date("2026-08-26T00:00:00.000Z"),
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId_date_tutorId: {
            orgId: "00000000-0000-0000-0000-000000000001",
            date: new Date("2026-08-26T00:00:00.000Z"),
            tutorId: "t1",
          },
        },
      }),
    );
  });
});
