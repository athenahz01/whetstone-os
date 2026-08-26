import { readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  assertAuthenticatedWyzantMessagesUrl,
  normalizeWyzantMessage,
  selectInboundWyzantMessages,
  WyzantMessagesAdapter,
  type WyzantMessageSnapshot,
} from "../lib/adapters/wyzant-messages";
import { WyzantAuthenticationError } from "../lib/adapters/wyzant";
import { StubDraftService } from "../lib/core/drafting";
import { GrowthEngine } from "../lib/core/engine";
import type { ChannelAdapter, Lead } from "../lib/core/types";
import { MemoryLeadStore } from "./helpers";

const inbound: WyzantMessageSnapshot = {
  threadId: "CH-thread-a17",
  messageId: "IM-message-501",
  author: "Sample learner",
  text: "Could we talk tomorrow afternoon?",
  threadUrl:
    "https://www.wyzant.com/tutor/messaging/conversation/CH-thread-a17",
  postedAt: "2026-08-26T18:05:00.000Z",
  unread: true,
  direction: "inbound",
};

const outbound: WyzantMessageSnapshot = {
  ...inbound,
  messageId: "IM-message-502",
  text: "Human-approved reply sent by the tutor.",
  direction: "outbound",
};

describe("Wyzant Messages adapter", () => {
  it("conforms to the shared channel contract", () => {
    const adapter = new WyzantMessagesAdapter({
      storageState: { cookies: [], origins: [] },
    });
    expectTypeOf(adapter).toMatchTypeOf<ChannelAdapter>();
    expect(adapter.name).toBe("wyzant-messages");
  });

  it("normalizes only inbound messages with a stable high-priority ID", () => {
    const first = normalizeWyzantMessage(inbound, "tutor-admissions");
    const second = normalizeWyzantMessage(inbound, "tutor-admissions");
    expectTypeOf(first).toMatchTypeOf<Lead>();
    expect(first).toMatchObject({
      id: second.id,
      channel: "wyzant-messages",
      priority: "high",
      tutorId: "tutor-admissions",
      raw: {
        threadId: "CH-thread-a17",
        messageId: "IM-message-501",
        source: "operator-owned-wyzant-messages-inbox",
      },
    });
    expect(first.id).toMatch(/^[a-f0-9]{64}$/);
    expect(() => normalizeWyzantMessage(outbound)).toThrow(
      "Only inbound Wyzant messages can become leads.",
    );
    expect(selectInboundWyzantMessages([inbound, outbound])).toEqual([inbound]);
  });

  it("fails closed when navigation leaves the authenticated Messages route", () => {
    expect(() =>
      assertAuthenticatedWyzantMessagesUrl(
        "https://highered.wyzant.com/tutor/messaging",
      ),
    ).not.toThrow();
    expect(() =>
      assertAuthenticatedWyzantMessagesUrl(
        "https://www.wyzant.com/login?ReturnUrl=/tutor/messaging",
      ),
    ).toThrow(WyzantAuthenticationError);
    expect(() =>
      assertAuthenticatedWyzantMessagesUrl("https://www.wyzant.com/tutor/jobs"),
    ).toThrow(
      "Wyzant did not remain on the authenticated tutor Messages inbox.",
    );
    expect(() =>
      assertAuthenticatedWyzantMessagesUrl(
        "https://wyzant.com.evil.test/tutor/messaging",
      ),
    ).toThrow("official HTTPS origin");
  });

  it("reads the configured operator session and filters outbound messages", async () => {
    const readInbox = vi.fn(async () => [inbound, outbound]);
    const storageState = { cookies: [], origins: [] };
    const adapter = new WyzantMessagesAdapter({
      storageState,
      tutorId: "tutor-admissions",
      readInbox,
    });
    await expect(adapter.poll()).resolves.toMatchObject([
      { channel: "wyzant-messages", raw: { messageId: "IM-message-501" } },
    ]);
    expect(readInbox).toHaveBeenCalledWith({
      storageState,
      inboxUrl: "https://www.wyzant.com/tutor/messaging",
      headless: true,
      browserFactory: undefined,
    });
  });

  it("routes a direct inbound inquiry through drafting and alerting", async () => {
    const adapter = new WyzantMessagesAdapter({
      storageState: { cookies: [], origins: [] },
      tutorId: "tutor-admissions",
      readInbox: async () => [inbound],
    });
    const store = new MemoryLeadStore();
    const notify = vi.fn(async () => undefined);
    const engine = new GrowthEngine({
      adapters: [adapter],
      store,
      drafts: new StubDraftService(),
      alerts: { isEnabled: () => true, notify },
    });
    await expect(engine.tick()).resolves.toEqual({
      polled: 1,
      inserted: 1,
      deduped: 0,
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "wyzant-messages" }),
      100,
    );
  });

  it("returns only the official thread URL and exposes no send action", async () => {
    const adapter = new WyzantMessagesAdapter({
      storageState: { cookies: [], origins: [] },
    });
    const fetchCall = vi.fn();
    vi.stubGlobal("fetch", fetchCall);
    await expect(
      adapter.send(normalizeWyzantMessage(inbound), "Approved reply"),
    ).resolves.toEqual({ prefillUrl: inbound.threadUrl });
    expect(fetchCall).not.toHaveBeenCalled();
    const source = await readFile(
      new URL("../lib/adapters/wyzant-messages.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\.(click|fill|press|type)\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/markChannelAsRead|setAllMessagesRead/);
    vi.unstubAllGlobals();
  });
});
