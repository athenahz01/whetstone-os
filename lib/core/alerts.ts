import { Telegraf } from "telegraf";
import type { Lead } from "./types";

interface TelegramClient {
  sendMessage(
    chatId: string,
    text: string,
    options?: { link_preview_options?: { is_disabled: boolean } },
  ): Promise<unknown>;
}

export interface AlertService {
  isEnabled(): boolean;
  notify(lead: Lead, score: number): Promise<void>;
}

export class StubAlertService implements AlertService {
  isEnabled(): boolean {
    return true;
  }
  async notify(): Promise<void> {}
}

export interface TelegramAlertServiceOptions {
  token?: string;
  chatId?: string;
  reviewBaseUrl?: string;
  client?: TelegramClient;
  warn?: (message: string) => void;
}

export class TelegramAlertService implements AlertService {
  private readonly chatId?: string;
  private readonly reviewBaseUrl?: string;
  private readonly client?: TelegramClient;
  private readonly warn: (message: string) => void;
  private warnedDisabled = false;

  constructor(options: TelegramAlertServiceOptions) {
    this.chatId = options.chatId?.trim() || undefined;
    this.reviewBaseUrl = options.reviewBaseUrl?.trim() || undefined;
    this.warn = options.warn ?? console.warn;
    if (options.client) this.client = options.client;
    else if (options.token?.trim()) {
      this.client = new Telegraf(options.token.trim()).telegram;
    }
  }

  isEnabled(): boolean {
    return (
      this.client !== undefined &&
      this.chatId !== undefined &&
      this.reviewBaseUrl !== undefined
    );
  }

  async notify(lead: Lead, score: number): Promise<void> {
    if (!this.client || !this.chatId || !this.reviewBaseUrl) {
      if (!this.warnedDisabled) {
        this.warnedDisabled = true;
        this.warn(
          "Telegram alerts are disabled: token, chat ID, and hosted review URL are required.",
        );
      }
      return;
    }

    const reviewUrl = new URL(this.reviewBaseUrl);
    reviewUrl.searchParams.set("leadId", lead.id);
    await this.client.sendMessage(
      this.chatId,
      [
        `Hot lead, score ${score}`,
        `${lead.subject ?? "New opportunity"}${lead.location ? `, ${lead.location}` : ""}`,
        `Review: ${reviewUrl.toString()}`,
      ].join("\n"),
      { link_preview_options: { is_disabled: true } },
    );
  }
}
