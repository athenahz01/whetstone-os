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

export interface ExceptionAlertService {
  isEnabled(): boolean;
  notifyException(title: string, detail: string): Promise<void>;
}

export class StubAlertService implements AlertService {
  isEnabled(): boolean {
    return true;
  }
  async notify(): Promise<void> {}
}

interface TelegramAlertConfig {
  client: TelegramClient;
  chatId: string;
  reviewBaseUrl: string;
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
    const ready = this.readyConfig();
    if (!ready) return;
    const { client, chatId, reviewBaseUrl } = ready;

    const reviewUrl = new URL(reviewBaseUrl);
    reviewUrl.searchParams.set("leadId", lead.id);
    await client.sendMessage(
      chatId,
      [
        `Hot lead, score ${score}`,
        `${lead.subject ?? "New opportunity"}${lead.location ? `, ${lead.location}` : ""}`,
        `Review: ${reviewUrl.toString()}`,
      ].join("\n"),
      { link_preview_options: { is_disabled: true } },
    );
  }

  async notifyException(title: string, detail: string): Promise<void> {
    const ready = this.readyConfig();
    if (!ready) return;
    const { client, chatId, reviewBaseUrl } = ready;

    await client.sendMessage(
      chatId,
      [title, detail, `Review: ${reviewBaseUrl}`].join("\n"),
      { link_preview_options: { is_disabled: true } },
    );
  }

  private readyConfig(): TelegramAlertConfig | null {
    const { client, chatId, reviewBaseUrl } = this;
    if (client && chatId && reviewBaseUrl) {
      return { client, chatId, reviewBaseUrl };
    }
    if (!this.warnedDisabled) {
      this.warnedDisabled = true;
      this.warn(
        "Telegram alerts are disabled: token, chat ID, and hosted review URL are required.",
      );
    }
    return null;
  }
}
