import { describe, expect, it } from "vitest";
import { BatchAdapter } from "../lib/adapters/batch";
import { EmailAdapter } from "../lib/adapters/email";
import { WyzantAdapter } from "../lib/adapters/wyzant";
import type { ChannelAdapter } from "../lib/core/types";
import { lead } from "./helpers";

function expectAdapterContract(adapter: ChannelAdapter, expectedName: string) {
  expect(adapter.name).toBe(expectedName);
  expect(typeof adapter.poll).toBe("function");
  expect(typeof adapter.send).toBe("function");
}

describe("channel adapter contracts", () => {
  it("keeps email, Wyzant, and batch ingestion behind one interface", () => {
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
    expectAdapterContract(new BatchAdapter([lead()]), "ingest");
  });
});
