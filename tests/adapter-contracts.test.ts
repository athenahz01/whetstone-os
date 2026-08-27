import { describe, expect, it } from "vitest";
import { BatchAdapter } from "../lib/adapters/batch";
import { EmailAdapter } from "../lib/adapters/email";
import { WyzantAdapter } from "../lib/adapters/wyzant";
import { WyzantMessagesAdapter } from "../lib/adapters/wyzant-messages";
import { CounselorsAdapter } from "../lib/adapters/counselors";
import { ReengagementAdapter } from "../lib/adapters/reengagement";
import { ReferralsAdapter } from "../lib/adapters/referrals";
import type { ChannelAdapter } from "../lib/core/types";
import { lead } from "./helpers";

function expectAdapterContract(adapter: ChannelAdapter, expectedName: string) {
  expect(adapter.name).toBe(expectedName);
  expect(typeof adapter.poll).toBe("function");
  expect(typeof adapter.send).toBe("function");
}

describe("channel adapter contracts", () => {
  it("keeps every production channel behind one interface", () => {
    expectAdapterContract(
      new EmailAdapter({
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
      }),
      "email",
    );
    expectAdapterContract(
      new WyzantAdapter({
        storageState: { cookies: [], origins: [] },
        feedUrl: "https://www.wyzant.com/tutor/jobs",
        targetSubjects: ["College Counseling"],
        targetLocations: ["Manhattan"],
        includeOnlineJobs: true,
      }),
      "wyzant",
    );
    expectAdapterContract(
      new WyzantMessagesAdapter({
        storageState: { cookies: [], origins: [] },
      }),
      "wyzant-messages",
    );
    expectAdapterContract(new BatchAdapter([lead()]), "ingest");
    expectAdapterContract(new ReengagementAdapter([]), "reengagement");
    expectAdapterContract(new ReferralsAdapter([]), "referrals");
    expectAdapterContract(new CounselorsAdapter([]), "counselors");
  });
});
