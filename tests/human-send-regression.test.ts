import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { EmailAdapter } from "../lib/adapters/email";
import { WyzantAdapter } from "../lib/adapters/wyzant";
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

    const source = await readFile(
      new URL("../lib/adapters/wyzant.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\.click\s*\(/);
    expect(source).not.toMatch(/auto.?submit/i);
  });
});
