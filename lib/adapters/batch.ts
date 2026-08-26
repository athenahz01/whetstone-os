import type { ChannelAdapter, Lead } from "../core/types";

export class BatchAdapter implements ChannelAdapter {
  readonly name = "ingest";

  constructor(private readonly leads: Lead[]) {}

  async poll(): Promise<Lead[]> {
    return this.leads;
  }

  async send(lead: Lead, approvedMessage: string) {
    void approvedMessage;
    return { prefillUrl: lead.url };
  }
}
