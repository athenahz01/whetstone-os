import { describe, expect, expectTypeOf, it } from "vitest";
import { CounselorsAdapter } from "../lib/adapters/counselors";
import {
  ReengagementAdapter,
  ReengagementImportError,
} from "../lib/adapters/reengagement";
import {
  parseReferralCsv,
  parseReferralJson,
  ReferralsAdapter,
} from "../lib/adapters/referrals";
import type { ChannelAdapter } from "../lib/core/types";

const consent = {
  recordedAt: "2026-01-10T12:00:00.000Z",
  source: "Harvard Club signup checkbox",
  scope: "Tutoring follow-up by email",
};

describe("Phase 3 source adapters", () => {
  it("implements ChannelAdapter for reengagement, referrals, and counselors", () => {
    expectTypeOf(new ReengagementAdapter([])).toMatchTypeOf<ChannelAdapter>();
    expectTypeOf(new ReferralsAdapter([])).toMatchTypeOf<ChannelAdapter>();
    expectTypeOf(new CounselorsAdapter([])).toMatchTypeOf<ChannelAdapter>();
  });

  it("rejects an entire reengagement import when any row lacks provenance", async () => {
    const adapter = new ReengagementAdapter([
      {
        id: "allowed",
        name: "Allowed sample",
        email: "allowed@example.test",
        subject: "English",
        notes: "Grade 10 student wants English tutoring this term.",
        consent,
      },
      {
        id: "missing-consent",
        name: "Blocked sample",
        email: "blocked@example.test",
        subject: "English",
      },
    ]);
    await expect(adapter.poll()).rejects.toThrow(ReengagementImportError);
  });

  it.each([
    [undefined, "required"],
    [
      { recordedAt: "bad", source: "signup", scope: "email" },
      "valid recordedAt",
    ],
    [{ recordedAt: consent.recordedAt, source: "", scope: "email" }, "source"],
    [{ recordedAt: consent.recordedAt, source: "signup", scope: "" }, "scope"],
  ])("negative-probes every consent clause", async (provenance, message) => {
    const adapter = new ReengagementAdapter([
      {
        name: "Consent probe",
        email: "probe@example.test",
        consent: provenance,
      },
    ]);
    await expect(adapter.poll()).rejects.toThrow(message);
  });

  it("rejects suppressed contacts at the import boundary", async () => {
    await expect(
      new ReengagementAdapter([
        {
          name: "Suppressed",
          email: "suppressed@example.test",
          consent,
          suppressed: true,
        },
      ]).poll(),
    ).rejects.toThrow("Suppressed contacts cannot be imported");
  });

  it("rejects consent for the wrong contact channel and current-client records", async () => {
    await expect(
      new ReengagementAdapter([
        {
          name: "Wrong channel",
          email: "email-only@example.test",
          consent: { ...consent, scope: "SMS follow-up" },
        },
      ]).poll(),
    ).rejects.toThrow("available email, SMS, text, or phone");
    await expect(
      new ReengagementAdapter([
        {
          name: "Current family",
          email: "current@example.test",
          consent,
          currentClient: true,
        },
      ]).poll(),
    ).rejects.toThrow("Current client families are human-owned");
  });

  it("parses referral CSV and JSON and preserves its source-population declaration", () => {
    const csv = [
      "id,name,email,contactType,publicSourceUrl,subject",
      "partner-1,Sample Counselor,counselor@example.test,professional_partner,https://school.example.test/team,College Counseling",
    ].join("\n");
    expect(parseReferralCsv(csv)[0]).toMatchObject({
      id: "partner-1",
      contactType: "professional_partner",
      publicSourceUrl: "https://school.example.test/team",
    });
    expect(
      parseReferralJson(JSON.stringify({ contacts: parseReferralCsv(csv) })),
    ).toHaveLength(1);
  });

  it("rejects a professional referral with no public source and a direct contact with no consent", async () => {
    await expect(
      new ReferralsAdapter([
        {
          name: "Unverified partner",
          email: "partner@example.test",
          contactType: "professional_partner",
        },
      ]).poll(),
    ).rejects.toThrow("public HTTPS source");
    await expect(
      new ReferralsAdapter([
        {
          name: "Direct family",
          email: "family@example.test",
          contactType: "consented_contact",
        },
      ]).poll(),
    ).rejects.toThrow("Consent provenance");
  });

  it("rejects non-public or non-professional counselor records clause by clause", async () => {
    const base = {
      name: "Sample Counselor",
      email: "counselor@example.test",
      role: "School counselor",
      organization: "Sample School",
      publicSourceUrl: "https://school.example.test/team",
    };
    await expect(
      new CounselorsAdapter([
        { ...base, publicSourceUrl: "http://school.example.test" },
      ]).poll(),
    ).rejects.toThrow("public HTTPS source");
    await expect(
      new CounselorsAdapter([{ ...base, role: "" }]).poll(),
    ).rejects.toThrow("professional role and organization");
    await expect(
      new CounselorsAdapter([{ ...base, organization: "" }]).poll(),
    ).rejects.toThrow("professional role and organization");
  });

  it("all send methods create local prefills and perform no transmission", async () => {
    const reengagement = new ReengagementAdapter([
      { name: "Sample", email: "sample@example.test", consent },
    ]);
    const [lead] = await reengagement.poll();
    await expect(
      reengagement.send(lead, "Human-approved copy"),
    ).resolves.toMatchObject({
      prefillUrl: expect.stringMatching(/^mailto:/),
    });
  });
});
