import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { stableLeadId } from "../core/stable-id";
import type { ChannelAdapter, Lead } from "../core/types";

export interface EmailAdapterOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password?: string;
  accessToken?: string;
  mailbox: string;
  lookbackHours: number;
  maxMessages: number;
  maxBytes: number;
  ownAddress: string;
  keywords: string[];
  tutorId?: string;
}

export class EmailAdapter implements ChannelAdapter {
  readonly name = "email";

  constructor(private readonly options: EmailAdapterOptions) {}

  async poll(): Promise<Lead[]> {
    const client = new ImapFlow({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      auth: {
        user: this.options.user,
        pass: this.options.password,
        accessToken: this.options.accessToken,
      },
      logger: false,
    });

    await client.connect();
    try {
      const lock = await client.getMailboxLock(this.options.mailbox, {
        readOnly: true,
      });
      try {
        const since = new Date(
          Date.now() - this.options.lookbackHours * 60 * 60 * 1000,
        );
        const messages: Array<{
          uid: number;
          internalDate?: Date | string;
          source: Buffer;
        }> = [];
        for await (const message of client.fetch(
          { since },
          {
            uid: true,
            internalDate: true,
            source: { maxLength: this.options.maxBytes },
          },
        )) {
          if (!message.source) continue;
          messages.push({
            uid: message.uid,
            internalDate: message.internalDate,
            source: message.source,
          });
          if (messages.length > this.options.maxMessages) messages.shift();
        }

        const leads = await Promise.all(
          messages.map((message) => this.toLead(message)),
        );
        return leads.filter((lead): lead is Lead => lead !== null);
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  async send(lead: Lead, approvedMessage: string) {
    const url = new URL(
      lead.url.startsWith("mailto:")
        ? lead.url
        : `mailto:${this.options.ownAddress}`,
    );
    url.searchParams.set(
      "subject",
      `Reply draft: ${lead.subject ?? "inquiry"}`,
    );
    url.searchParams.set("body", approvedMessage);
    return { prefillUrl: url.toString() };
  }

  private async toLead(message: {
    uid: number;
    internalDate?: Date | string;
    source: Buffer;
  }): Promise<Lead | null> {
    const parsed = await simpleParser(message.source);
    const subject = parsed.subject?.trim() ?? "";
    const text = (parsed.text ?? "").trim().slice(0, 20_000);
    const searchable = `${subject}\n${text}`.toLowerCase();
    if (
      !this.options.keywords.some((keyword) => searchable.includes(keyword))
    ) {
      return null;
    }
    const nativeId =
      parsed.messageId?.trim() || `${this.options.mailbox}:${message.uid}`;
    const author = parsed.from?.text?.trim() || "Email inquiry";
    const replyAddress =
      parsed.replyTo?.value[0]?.address ||
      parsed.from?.value[0]?.address ||
      this.options.ownAddress;
    const postedAt = new Date(
      parsed.date ?? message.internalDate ?? Date.now(),
    ).toISOString();
    return {
      id: stableLeadId(this.name, nativeId),
      channel: this.name,
      author,
      text,
      subject: subject || undefined,
      url: `mailto:${replyAddress}`,
      postedAt,
      tutorId: this.options.tutorId,
      raw: { messageId: parsed.messageId, uid: message.uid },
    };
  }
}

export function createEmailAdapterFromEnv(): EmailAdapter | null {
  const host = process.env.EMAIL_IMAP_HOST?.trim();
  const user = process.env.EMAIL_IMAP_USER?.trim();
  const ownAddress = process.env.EMAIL_OWN_ADDRESS?.trim();
  const password = process.env.EMAIL_IMAP_PASSWORD?.trim();
  const accessToken = process.env.EMAIL_IMAP_ACCESS_TOKEN?.trim();
  if (!host || !user || !ownAddress || (!password && !accessToken)) return null;

  return new EmailAdapter({
    host,
    port: integer(process.env.EMAIL_IMAP_PORT, 993),
    secure: process.env.EMAIL_IMAP_SECURE !== "false",
    user,
    password,
    accessToken,
    mailbox: process.env.EMAIL_IMAP_MAILBOX?.trim() || "INBOX",
    lookbackHours: integer(process.env.EMAIL_IMAP_LOOKBACK_HOURS, 48),
    maxMessages: integer(process.env.EMAIL_IMAP_MAX_MESSAGES, 50),
    maxBytes: integer(process.env.EMAIL_IMAP_MAX_BYTES, 512_000),
    ownAddress,
    keywords: split(process.env.EMAIL_INQUIRY_KEYWORDS),
    tutorId: process.env.EMAIL_TUTOR_ID?.trim() || undefined,
  });
}

function split(value: string | undefined): string[] {
  return (
    value || "tutor|tutoring|admissions|application|SAT|essay|reading|referral"
  )
    .split("|")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
