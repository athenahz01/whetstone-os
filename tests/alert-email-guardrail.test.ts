import { readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ALERT_SUBJECT_PREFIX,
  EmailAlertService,
  type AlertEnvelope,
} from "../lib/core/alerts";
import type { Lead } from "../lib/core/types";
import { lead } from "./helpers";

const LEAD_ADDRESS = "prospective.parent@example.test";

function recordingService(overrides: Partial<AlertEnvelope> = {}) {
  const sent: AlertEnvelope[] = [];
  const service = new EmailAlertService({
    from: "ops@whetstone.test",
    to: "operator@whetstone.test",
    reviewBaseUrl: "https://whetstone.test/today",
    transport: {
      async sendMail(envelope) {
        sent.push({ ...envelope, ...overrides });
        return undefined;
      },
    },
  });
  return { service, sent };
}

describe("alert email guardrails", () => {
  it("mails only the operator and never a lead address", async () => {
    const { service, sent } = recordingService();
    await service.notify(
      lead({ author: LEAD_ADDRESS, text: `Contact me at ${LEAD_ADDRESS}` }),
      92,
    );
    expect(sent).toHaveLength(1);
    const envelope = sent[0];
    expect(envelope.to).toBe("operator@whetstone.test");
    expect(Object.keys(envelope).sort()).toEqual([
      "from",
      "subject",
      "text",
      "to",
    ]);
    expect(JSON.stringify(envelope)).not.toContain(LEAD_ADDRESS);
  });

  it("takes no recipient argument on either alert method", () => {
    const { service } = recordingService();
    expectTypeOf(service.notify).parameters.toEqualTypeOf<[Lead, number]>();
    expectTypeOf(service.notifyException).parameters.toEqualTypeOf<
      [string, string]
    >();
  });

  it("carries no lead body text into the message", async () => {
    const { service, sent } = recordingService();
    const item = lead({
      text: "My daughter is applying early decision and needs help this week.",
      author: LEAD_ADDRESS,
    });
    await service.notify(item, 92);
    expect(sent[0].text).not.toContain(item.text);
    expect(sent[0].text).not.toContain(item.author);
    expect(sent[0].text).toContain("Review: https://whetstone.test/today");
  });

  it("prefixes every subject so a phone filter can match it", async () => {
    const { service, sent } = recordingService();
    await service.notify(lead({ location: "Manhattan" }), 87);
    await service.notifyException("SESSION_STALE", "No successful poll.");
    expect(sent[0].subject).toBe(
      `${ALERT_SUBJECT_PREFIX}Hot lead 87 - College Counseling, Manhattan`,
    );
    expect(sent[1].subject).toBe(
      `${ALERT_SUBJECT_PREFIX}Exception - SESSION_STALE`,
    );
    expect(
      sent.every((envelope) => envelope.subject.startsWith("[Whetstone] ")),
    ).toBe(true);
  });

  it("swallows a throwing transport so a send failure cannot kill the tick", async () => {
    const sendMail = vi.fn(async () => {
      throw new Error("SMTP connection timed out");
    });
    const service = new EmailAlertService({
      from: "ops@whetstone.test",
      to: "operator@whetstone.test",
      reviewBaseUrl: "https://whetstone.test/today",
      transport: { sendMail },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(service.notify(lead(), 92)).resolves.toBeUndefined();
    await expect(
      service.notifyException("SESSION_STALE", "No successful poll."),
    ).resolves.toBeUndefined();
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("exposes no reply-to, cc or bcc path to a prospect", async () => {
    const source = await readFile(
      new URL("../lib/core/alerts.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\b(replyTo|cc|bcc|sender|envelope)\s*:/);
    expect(source).not.toMatch(/lead\.author|lead\.text/);
  });
});
