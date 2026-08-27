import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "playwright";
import { stableLeadId } from "../core/stable-id";
import type { ChannelAdapter, Lead } from "../core/types";
import {
  officialWyzantUrl,
  resolveWyzantStorageState,
  WyzantAuthenticationError,
} from "./wyzant";

export const DEFAULT_WYZANT_MESSAGES_URL =
  "https://highered.wyzant.com/tutor/messaging";

export interface WyzantMessageSnapshot {
  threadId: string;
  messageId: string;
  author: string;
  text: string;
  threadUrl: string;
  postedAt: string;
  unread: boolean;
  direction: "inbound" | "outbound";
}

interface InboxReaderInput {
  storageState: BrowserContextOptions["storageState"];
  inboxUrl: string;
  headless: boolean;
  browserFactory?: () => Promise<Browser>;
}

type InboxReader = (
  input: InboxReaderInput,
) => Promise<WyzantMessageSnapshot[]>;

export interface WyzantMessagesAdapterOptions {
  storageState: BrowserContextOptions["storageState"];
  inboxUrl?: string;
  tutorId?: string;
  headless?: boolean;
  browserFactory?: () => Promise<Browser>;
  readInbox?: InboxReader;
}

export function assertAuthenticatedWyzantMessagesUrl(value: string): void {
  const url = officialWyzantUrl(value);
  if (url.pathname.startsWith("/login")) {
    throw new WyzantAuthenticationError(
      "The operator-owned Wyzant session is expired.",
    );
  }
  if (!url.pathname.startsWith("/tutor/messaging")) {
    throw new WyzantAuthenticationError(
      "Wyzant did not remain on the authenticated tutor Messages inbox.",
    );
  }
}

export function normalizeWyzantMessage(
  snapshot: WyzantMessageSnapshot,
  tutorId?: string,
): Lead {
  if (snapshot.direction !== "inbound") {
    throw new Error("Only inbound Wyzant messages can become leads.");
  }
  const threadUrl = officialWyzantUrl(snapshot.threadUrl);
  if (!threadUrl.pathname.startsWith("/tutor/messaging/conversation/")) {
    throw new Error("Wyzant message is missing an official conversation URL.");
  }
  const threadId = snapshot.threadId.trim();
  const messageId = snapshot.messageId.trim();
  const text = snapshot.text.trim();
  const postedAt = Date.parse(snapshot.postedAt);
  if (!threadId || !messageId || !text || !Number.isFinite(postedAt)) {
    throw new Error("Wyzant message is missing a required normalized field.");
  }
  return {
    id: stableLeadId("wyzant-messages", `${threadId}:${messageId}`),
    channel: "wyzant-messages",
    author: snapshot.author.trim() || "Wyzant learner",
    text,
    subject: "New Wyzant student reply",
    url: threadUrl.toString(),
    postedAt: new Date(postedAt).toISOString(),
    tutorId,
    priority: "high",
    raw: {
      threadId,
      messageId,
      unread: snapshot.unread,
      source: "operator-owned-wyzant-messages-inbox",
    },
  };
}

export function selectInboundWyzantMessages(
  snapshots: readonly WyzantMessageSnapshot[],
): WyzantMessageSnapshot[] {
  return snapshots.filter((snapshot) => snapshot.direction === "inbound");
}

export async function readOperatorWyzantMessagesInbox(
  input: InboxReaderInput,
): Promise<WyzantMessageSnapshot[]> {
  assertAuthenticatedWyzantMessagesUrl(input.inboxUrl);
  const browser = await (input.browserFactory
    ? input.browserFactory()
    : chromium.launch({ headless: input.headless }));
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({
      storageState: input.storageState,
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    await page.goto(input.inboxUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    assertAuthenticatedWyzantMessagesUrl(page.url());
    if ((await page.locator('input[type="password"]').count()) > 0) {
      throw new WyzantAuthenticationError(
        "Wyzant displayed a sign-in form instead of the Messages inbox.",
      );
    }
    await page
      .locator("#messaging-app .inbox-main")
      .waitFor({ state: "attached", timeout: 20_000 });
    return extractMessages(page);
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

async function extractMessages(page: Page): Promise<WyzantMessageSnapshot[]> {
  return page.evaluate(async () => {
    interface MessageData {
      author?: string | number;
      sid?: string;
      text?: string;
      timestamp?: string;
      dateUpdated?: string;
    }
    interface ThreadData {
      sid?: string;
      attributes?: {
        lastMessageBody?: string;
        lastMessageDate?: string;
        threadId?: string | number;
      };
      _internalState?: {
        lastMessage?: { index?: number; dateCreated?: Date | string };
      };
      _messagesList?: {
        get(index: number): Promise<{ data?: MessageData }>;
      };
    }
    interface SummaryData {
      userId?: string | number;
      isUnread?: boolean;
      displayName?: string;
      thread?: ThreadData;
    }

    const results: WyzantMessageSnapshot[] = [];
    const summaries = Array.from(
      document.querySelectorAll<HTMLElement>(".conversation-summary-wrap"),
    );
    for (const summary of summaries) {
      const component = (summary as HTMLElement & { __vue__?: SummaryData })
        .__vue__;
      const thread = component?.thread;
      const index = thread?._internalState?.lastMessage?.index;
      if (!component || !thread || typeof index !== "number") continue;
      let message: MessageData | undefined;
      try {
        message = (await thread._messagesList?.get(index))?.data;
      } catch {
        continue;
      }
      const threadId = String(
        thread.sid ?? thread.attributes?.threadId ?? "",
      ).trim();
      const messageId = String(message?.sid ?? `${threadId}:${index}`).trim();
      const body = document.createElement("div");
      body.innerHTML = String(
        message?.text ?? thread.attributes?.lastMessageBody ?? "",
      );
      const text = (body.textContent ?? "").replace(/\s+/g, " ").trim();
      const postedAt = String(
        message?.timestamp ??
          message?.dateUpdated ??
          thread.attributes?.lastMessageDate ??
          thread._internalState?.lastMessage?.dateCreated ??
          "",
      );
      if (!threadId || !messageId || !text || !postedAt) continue;
      results.push({
        threadId,
        messageId,
        author:
          summary.querySelector<HTMLElement>(".username")?.innerText.trim() ||
          component.displayName?.trim() ||
          "Wyzant learner",
        text,
        threadUrl: new URL(
          `/tutor/messaging/conversation/${encodeURIComponent(threadId)}`,
          window.location.origin,
        ).toString(),
        postedAt,
        unread: Boolean(component.isUnread),
        direction:
          String(message?.author ?? "") === String(component.userId ?? "")
            ? "outbound"
            : "inbound",
      });
    }
    return results;
  });
}

export class WyzantMessagesAdapter implements ChannelAdapter {
  readonly name = "wyzant-messages";
  private readonly readInbox: InboxReader;

  constructor(private readonly options: WyzantMessagesAdapterOptions) {
    assertAuthenticatedWyzantMessagesUrl(
      options.inboxUrl ?? DEFAULT_WYZANT_MESSAGES_URL,
    );
    this.readInbox = options.readInbox ?? readOperatorWyzantMessagesInbox;
  }

  async poll(): Promise<Lead[]> {
    const snapshots = await this.readInbox({
      storageState: this.options.storageState,
      inboxUrl: this.options.inboxUrl ?? DEFAULT_WYZANT_MESSAGES_URL,
      headless: this.options.headless ?? true,
      browserFactory: this.options.browserFactory,
    });
    return selectInboundWyzantMessages(snapshots).map((snapshot) =>
      normalizeWyzantMessage(snapshot, this.options.tutorId),
    );
  }

  async send(lead: Lead, approvedMessage: string) {
    void approvedMessage;
    const url = officialWyzantUrl(lead.url);
    if (!url.pathname.startsWith("/tutor/messaging/conversation/")) {
      throw new Error("Refusing to prepare a reply outside Wyzant Messages.");
    }
    return { prefillUrl: url.toString() };
  }
}

export function createWyzantMessagesAdapterFromEnv(): WyzantMessagesAdapter {
  return new WyzantMessagesAdapter({
    storageState: resolveWyzantStorageState(),
    inboxUrl:
      process.env.WYZANT_MESSAGES_URL?.trim() || DEFAULT_WYZANT_MESSAGES_URL,
    tutorId: process.env.WYZANT_TUTOR_ID?.trim() || undefined,
    headless: process.env.WYZANT_HEADLESS !== "false",
  });
}
