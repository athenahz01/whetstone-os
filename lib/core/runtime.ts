import type { PrismaClient } from "@prisma/client";
import { EmailAlertService, type AlertService } from "./alerts";
import { prisma } from "./db";
import { ClaudeDraftService, PrismaDraftProfileRepository } from "./drafting";
import { GrowthEngine } from "./engine";
import { PrismaLeadStore } from "./lead-store";
import type { ChannelAdapter } from "./types";

export function createGrowthEngine(
  adapters: ChannelAdapter[],
  client: PrismaClient = prisma,
  alerts: AlertService = createAlertsFromEnv(),
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

export function createAlertsFromEnv(): EmailAlertService {
  return new EmailAlertService({
    host: process.env.ALERT_SMTP_HOST,
    port: process.env.ALERT_SMTP_PORT,
    secure: process.env.ALERT_SMTP_SECURE,
    user: process.env.ALERT_SMTP_USER,
    password: process.env.ALERT_SMTP_PASSWORD,
    from: process.env.ALERT_EMAIL_FROM,
    to: process.env.ALERT_EMAIL_TO,
    reviewBaseUrl: process.env.NEXT_PUBLIC_SITE_URL
      ? `${process.env.NEXT_PUBLIC_SITE_URL}/today`
      : undefined,
  });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
