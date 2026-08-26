import type { DraftService } from "../lib/core/drafting";
import type { LeadState, LeadStore } from "../lib/core/lead-store";
import type { Draft, Lead } from "../lib/core/types";

export function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "a".repeat(64),
    channel: "test",
    author: "Prospective learner",
    text: "Looking for an admissions tutor for an essay.",
    subject: "College Counseling",
    location: "Online",
    url: "https://example.test/opportunity/1",
    postedAt: "2026-08-26T12:00:00.000Z",
    priority: "high",
    ...overrides,
  };
}

export class MemoryLeadStore implements LeadStore {
  readonly entries = new Map<string, LeadState>();

  async getLeadState(id: string) {
    return this.entries.get(id) ?? null;
  }

  async saveLead({
    lead: item,
    score,
  }: {
    lead: Lead;
    score: number;
    draft?: Draft;
  }) {
    if (this.entries.has(item.id)) return;
    this.entries.set(item.id, { score, alertReservedAt: null });
  }

  async reserveAlert(id: string, at: Date) {
    const value = this.entries.get(id);
    if (!value || value.alertReservedAt) return false;
    this.entries.set(id, { ...value, alertReservedAt: at });
    return true;
  }

  async markAlerted() {}
}

export const draftService: DraftService = {
  async create(item) {
    return {
      leadId: item.id,
      tutorId: "tutor-admissions",
      variant: "test",
      body: "Human-reviewed draft.",
    };
  },
};
