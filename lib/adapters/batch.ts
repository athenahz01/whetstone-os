import type { AdapterException, ChannelAdapter, Lead } from "../core/types";

export class BatchAdapter implements ChannelAdapter {
  readonly name = "ingest";

  /**
   * `exceptions` are the ones the poll adapters raised on the GitHub runner.
   * This container carries them so the workflow's existing drain loop records
   * them, rather than a second path being written for the same thing.
   */
  constructor(
    private readonly leads: Lead[],
    private readonly exceptions: AdapterException[] = [],
  ) {}

  async poll(): Promise<Lead[]> {
    return this.leads;
  }

  drainExceptions(): AdapterException[] {
    return [...this.exceptions];
  }

  async send(lead: Lead, approvedMessage: string) {
    void approvedMessage;
    return { prefillUrl: lead.url };
  }
}
