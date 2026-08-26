import type { PrismaClient } from "@prisma/client";
import { TelegramAlertService, type AlertService } from "./alerts";
import { prisma } from "./db";
import { ClaudeDraftService, PrismaDraftProfileRepository } from "./drafting";
import { GrowthEngine } from "./engine";
import { PrismaLeadStore } from "./lead-store";
import type { ChannelAdapter } from "./types";

export function createGrowthEngine(
  adapters: ChannelAdapter[],
  client: PrismaClient = prisma,
  alerts: AlertService = createTelegramAlertsFromEnv(),
): GrowthEngine {
  return new GrowthEngine({
    adapters,
    store: new PrismaLeadStore(client),
    drafts: new ClaudeDraftService({
      profiles: new PrismaDraftProfileRepository(client),
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL,
      defaultTutorId: process.env.DEFAULT_TUTOR_ID,
    }),
    alerts,
    hotLeadThreshold: positiveInteger(process.env.HOT_LEAD_SCORE_THRESHOLD, 70),
  });
}

export function createTelegramAlertsFromEnv(): TelegramAlertService {
  return new TelegramAlertService({
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    reviewBaseUrl:
      process.env.TELEGRAM_REVIEW_BASE_URL ||
      (process.env.NEXT_PUBLIC_SITE_URL
        ? `${process.env.NEXT_PUBLIC_SITE_URL}/today`
        : undefined),
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
