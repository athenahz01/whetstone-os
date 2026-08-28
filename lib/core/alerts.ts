import { createTransport } from "nodemailer";
import type { Lead } from "./types";

/**
 * Every alert subject carries this prefix so a Gmail filter can match it and
 * raise a phone notification. Email is a weaker alert than push, so the filter
 * is load bearing and the prefix is part of the contract.
 */
export const ALERT_SUBJECT_PREFIX = "[Whetstone] ";

/**
 * The outgoing envelope. There is deliberately no reply-to, cc or bcc field:
 * the operator address is the only destination this system can ever mail, and
 * a lead address must never reach the transport. See G1.
 */
export interface AlertEnvelope {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface AlertTransport {
  sendMail(message: AlertEnvelope): Promise<unknown>;
}

export interface AlertService {
  isEnabled(): boolean;
  notify(lead: Lead, score: number): Promise<void>;
}

export interface ExceptionAlertService {
  isEnabled(): boolean;
  notifyException(title: string, detail: string): Promise<void>;
}

/**
 * The daily check-in message.
 *
 * Its own method rather than a reuse of `notifyException`, because a day's
 * stall list is not an exception and prefixing it as one would train the
 * recipient to read a routine message as a fault. It takes no recipient, for
 * the same reason nothing else here does: the operator inbox is the only
 * address this system can reach, and this message names minors.
 */
export interface DigestAlertService {
  isEnabled(): boolean;
  notifyDigest(subject: string, body: string): Promise<void>;
}

export class StubAlertService implements AlertService {
  isEnabled(): boolean {
    return true;
  }
  async notify(): Promise<void> {}
}

interface EmailAlertConfig {
  transport: AlertTransport;
  from: string;
  to: string;
  reviewBaseUrl: string;
}

export interface EmailAlertServiceOptions {
  host?: string;
  port?: string | number;
  secure?: string | boolean;
  user?: string;
  password?: string;
  from?: string;
  /** The operator inbox. Never a lead, never a parameter on notify(). */
  to?: string;
  reviewBaseUrl?: string;
  transport?: AlertTransport;
  warn?: (message: string) => void;
}

export class EmailAlertService
  implements AlertService, ExceptionAlertService, DigestAlertService
{
  private readonly from?: string;
  private readonly to?: string;
  private readonly reviewBaseUrl?: string;
  private readonly transport?: AlertTransport;
  private readonly warn: (message: string) => void;
  private warnedDisabled = false;

  constructor(options: EmailAlertServiceOptions) {
    this.from = options.from?.trim() || undefined;
    this.to = options.to?.trim() || undefined;
    this.reviewBaseUrl = options.reviewBaseUrl?.trim() || undefined;
    this.warn = options.warn ?? console.warn;
    if (options.transport) this.transport = options.transport;
    else this.transport = createSmtpTransport(options);
  }

  isEnabled(): boolean {
    return (
      this.transport !== undefined &&
      this.from !== undefined &&
      this.to !== undefined &&
      this.reviewBaseUrl !== undefined
    );
  }

  async notify(lead: Lead, score: number): Promise<void> {
    const ready = this.readyConfig();
    if (!ready) return;

    const descriptor = [lead.subject ?? "New opportunity", lead.location]
      .filter(Boolean)
      .join(", ");
    const reviewUrl = new URL(ready.reviewBaseUrl);
    reviewUrl.searchParams.set("leadId", lead.id);
    await this.send(ready, `Hot lead ${score} - ${descriptor}`, [
      `Score: ${score}`,
      `Subject: ${lead.subject ?? "New opportunity"}`,
      `Location: ${lead.location ?? "Not stated"}`,
      `Channel: ${lead.channel}`,
      `Review: ${reviewUrl.toString()}`,
    ]);
  }

  async notifyException(title: string, detail: string): Promise<void> {
    const ready = this.readyConfig();
    if (!ready) return;

    await this.send(ready, `Exception - ${title}`, [
      detail,
      `Review: ${ready.reviewBaseUrl}`,
    ]);
  }

  async notifyDigest(subject: string, body: string): Promise<void> {
    const ready = this.readyConfig();
    if (!ready) return;

    // No review link appended. The message's own reply codes are the action,
    // and a link would push the recipient to a web app the phase exists to
    // make unnecessary.
    await this.send(ready, subject, [body]);
  }

  /**
   * A transport failure can never propagate. `engine.ts` does not guard the
   * alert call, so an SMTP timeout escaping here would kill the whole tick.
   */
  private async send(
    config: EmailAlertConfig,
    subject: string,
    lines: string[],
  ): Promise<void> {
    try {
      await config.transport.sendMail({
        from: config.from,
        to: config.to,
        subject: `${ALERT_SUBJECT_PREFIX}${subject}`,
        text: lines.join("\n"),
      });
    } catch (error) {
      console.error("[alerts:send-failed]", {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  private readyConfig(): EmailAlertConfig | null {
    const { transport, from, to, reviewBaseUrl } = this;
    if (transport && from && to && reviewBaseUrl) {
      return { transport, from, to, reviewBaseUrl };
    }
    if (!this.warnedDisabled) {
      this.warnedDisabled = true;
      this.warn(
        "Alert email is disabled: SMTP host, user, password, sender, ALERT_EMAIL_TO, and hosted review URL are required.",
      );
    }
    return null;
  }
}

function createSmtpTransport(
  options: EmailAlertServiceOptions,
): AlertTransport | undefined {
  const host = options.host?.trim();
  const user = options.user?.trim();
  const password = options.password?.trim();
  if (!host || !user || !password) return undefined;
  const port = Number(options.port);
  return createTransport({
    host,
    port: Number.isInteger(port) && port > 0 ? port : 465,
    secure:
      options.secure === undefined ? true : `${options.secure}` !== "false",
    auth: { user, pass: password },
  });
}
