import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { EmailAdapter } from "../lib/adapters/email";
import { WyzantAdapter } from "../lib/adapters/wyzant";
import { CounselorsAdapter } from "../lib/adapters/counselors";
import { ReengagementAdapter } from "../lib/adapters/reengagement";
import { ReferralsAdapter } from "../lib/adapters/referrals";
import { lead } from "./helpers";

describe("regression lock: no automatic submission", () => {
  it("returns prefills from every production adapter and records no send", async () => {
    const item = lead({ url: "https://www.wyzant.com/tutoring-job/42" });
    const wyzant = new WyzantAdapter({
      storageState: { cookies: [], origins: [] },
      feedUrl: "https://www.wyzant.com/tutor/jobs",
      targetSubjects: ["College Counseling"],
      targetLocations: ["Manhattan"],
      includeOnlineJobs: true,
    });
    expect(await wyzant.send(item, "Approved by a person")).toEqual({
      prefillUrl: item.url,
    });

    const email = new EmailAdapter({
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "operator@example.test",
      password: "test",
      mailbox: "INBOX",
      lookbackHours: 48,
      maxMessages: 10,
      maxBytes: 10_000,
      ownAddress: "operator@example.test",
      keywords: ["tutor"],
    });
    expect((await email.send(item, "Approved by a person")).prefillUrl).toMatch(
      /^mailto:/,
    );

    const consent = {
      recordedAt: "2026-01-10T12:00:00.000Z",
      source: "Signup checkbox",
      scope: "Email follow-up",
    };
    const adapters = [
      new ReengagementAdapter([
        { name: "Sample", email: "sample@example.test", consent },
      ]),
      new ReferralsAdapter([
        {
          name: "Sample partner",
          email: "partner@example.test",
          contactType: "professional_partner" as const,
          publicSourceUrl: "https://school.example.test/team",
        },
      ]),
      new CounselorsAdapter([
        {
          name: "Sample counselor",
          email: "counselor@example.test",
          role: "Counselor",
          organization: "Sample School",
          publicSourceUrl: "https://school.example.test/team",
        },
      ]),
    ];
    for (const adapter of adapters) {
      const [contact] = await adapter.poll();
      expect(
        (await adapter.send(contact, "Approved by a person")).prefillUrl,
      ).toMatch(/^mailto:/);
    }

    const sources = await Promise.all(
      ["wyzant.ts", "reengagement.ts", "referrals.ts", "counselors.ts"].map(
        (file) =>
          readFile(new URL(`../lib/adapters/${file}`, import.meta.url), "utf8"),
      ),
    );
    const source = sources.join("\n");
    expect(source).not.toMatch(/\.click\s*\(/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\.(sendMail|post)\s*\(/);
  });
});
