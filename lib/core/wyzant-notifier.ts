import type { LeadStore } from "./lead-store";
import type { Lead } from "./types";
import {
  wyzantAlertDecision,
  type WyzantAlertRule,
  type WyzantSuppressionReason,
} from "./wyzant-alert";
import { describeRate, type WyzantRate } from "./wyzant-rate";

/**
 * Emailing Athena about a Wyzant job.
 *
 * This runs beside the engine rather than inside it. `engine.ts` is byte-for-
 * byte locked and must contain no channel-specific branch, and its alert is
 * gated on score - which is exactly what the owner asked to stop. So the rule
 * lives here, in the channel's own layer, and the engine is untouched.
 *
 * Leads arriving from the runner have already passed the adapter's relevance
 * filter: one of Cole's four approved subjects plus the configured lesson-type
 * and location scoping. Relevance is not re-litigated here.
 */

export interface WyzantAlertNotifier {
  isEnabled(): boolean;
  /**
   * Sends one job to the operator inbox.
   *
   * No recipient argument, and it must never gain one. G1 restated for a
   * component that can send mail: this is a path to Athena, never to a family.
   */
  notifyWyzantJob(job: {
    subject: string;
    location: string;
    rate: string;
    postedAt: string;
    url: string;
  }): Promise<void>;
}

export interface WyzantAlertOutcome {
  leadId: string;
  rate: WyzantRate;
  sent: boolean;
  /** Present when the rule refused it. */
  reason?: WyzantSuppressionReason;
  /** Present when it was already emailed on an earlier poll. */
  alreadyAlerted?: boolean;
}

export interface WyzantAlertRunResult {
  outcomes: WyzantAlertOutcome[];
  considered: number;
  sent: number;
  suppressed: number;
  duplicates: number;
  /** Considered, and the notifier is not configured to send anything. */
  undeliverable: number;
  /** Every lead considered left in exactly one of the four outcomes. */
  balanced: boolean;
}

function rateOf(lead: Lead): string | undefined {
  const raw = lead.raw;
  if (!raw || typeof raw !== "object") return undefined;
  const value = (raw as { recommendedRate?: unknown }).recommendedRate;
  return typeof value === "string" ? value : undefined;
}

/**
 * Decides and sends.
 *
 * Reservation before the send, so two polls racing cannot both email the same
 * job, and so a job already emailed on an earlier run is skipped rather than
 * sent twice. That is the same reserve-then-send the engine uses, borrowed
 * rather than reinvented.
 *
 * A suppressed job leaves with its reason. A job that vanishes with no row is
 * the defect this project has found in every phase.
 */
export async function runWyzantAlerts(input: {
  leads: Lead[];
  rule: WyzantAlertRule;
  notifier: WyzantAlertNotifier;
  store: Pick<LeadStore, "reserveAlert" | "markAlerted">;
  now: Date;
  channel?: string;
}): Promise<WyzantAlertRunResult> {
  const channel = input.channel ?? "wyzant";
  const outcomes: WyzantAlertOutcome[] = [];

  for (const lead of input.leads) {
    if (lead.channel !== channel) continue;

    const decision = wyzantAlertDecision(rateOf(lead), input.rule);
    if (!decision.send) {
      outcomes.push({
        leadId: lead.id,
        rate: decision.rate,
        sent: false,
        reason: decision.reason,
      });
      continue;
    }

    if (!input.notifier.isEnabled()) {
      outcomes.push({ leadId: lead.id, rate: decision.rate, sent: false });
      continue;
    }

    const reserved = await input.store.reserveAlert(lead.id, input.now);
    if (!reserved) {
      outcomes.push({
        leadId: lead.id,
        rate: decision.rate,
        sent: false,
        alreadyAlerted: true,
      });
      continue;
    }

    // The email may name the subject, the rate, the age and the link, because
    // it goes to Athena alone. It carries no learner name and no job body: she
    // opens the board to read those, and the alert is not a copy of the board.
    await input.notifier.notifyWyzantJob({
      subject: lead.subject ?? "Wyzant job",
      location: lead.location ?? "not stated",
      rate: describeRate(decision.rate),
      postedAt: lead.postedAt,
      url: lead.url,
    });
    await input.store.markAlerted(lead.id, input.now);
    outcomes.push({ leadId: lead.id, rate: decision.rate, sent: true });
  }

  const sent = outcomes.filter((outcome) => outcome.sent).length;
  const suppressed = outcomes.filter((outcome) => outcome.reason).length;
  const duplicates = outcomes.filter(
    (outcome) => outcome.alreadyAlerted,
  ).length;
  // A job the notifier could not send because it is not configured. Its own
  // category: not refused by the rule, not a repeat, and not delivered.
  const undeliverable = outcomes.filter(
    (outcome) => !outcome.sent && !outcome.reason && !outcome.alreadyAlerted,
  ).length;
  return {
    outcomes,
    considered: outcomes.length,
    sent,
    suppressed,
    duplicates,
    undeliverable,
    // Every job considered left in exactly one of the four. Written against
    // the four counts rather than against the list it was derived from, or it
    // would be an assertion that a number equals itself.
    balanced:
      sent + suppressed + duplicates + undeliverable === outcomes.length,
  };
}

/**
 * What may be written to a log.
 *
 * Counts and lead references. No learner name, no subject, no job text and no
 * URL - a Wyzant job URL identifies the posting and, through it, the family.
 */
export function wyzantAlertLogLine(result: WyzantAlertRunResult): string {
  return [
    `considered=${result.considered}`,
    `sent=${result.sent}`,
    `suppressed=${result.suppressed}`,
    `duplicates=${result.duplicates}`,
    `undeliverable=${result.undeliverable}`,
    `rates=${result.outcomes.map((outcome) => outcome.rate.kind).join("|")}`,
  ].join(" ");
}
