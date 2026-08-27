import type { ChannelAdapter, Lead } from "../core/types";
import {
  contactPrefillUrl,
  normalizeContact,
  normalizeEmail,
  type ContactRecord,
} from "./contact-utils";

export interface CounselorRecord extends ContactRecord {
  role: string;
  organization: string;
  publicSourceUrl: string;
}

export function normalizeCounselorRecord(record: CounselorRecord): Lead {
  const source = new URL(record.publicSourceUrl);
  if (source.protocol !== "https:") {
    throw new Error("Counselor contacts require a public HTTPS source.");
  }
  if (!record.role.trim() || !record.organization.trim()) {
    throw new Error(
      "Counselor contacts require a professional role and organization.",
    );
  }
  return normalizeContact(
    "counselors",
    record,
    {
      source: "public-professional-contact",
      professionalAdult: true,
      role: record.role.trim(),
      organization: record.organization.trim(),
      publicSourceUrl: source.toString(),
    },
    { defaultSubject: "Professional counselor resource" },
  );
}

export class CounselorsAdapter implements ChannelAdapter {
  readonly name = "counselors";
  constructor(private readonly records: readonly CounselorRecord[]) {}
  async poll(): Promise<Lead[]> {
    return this.records.map(normalizeCounselorRecord);
  }
  async send(lead: Lead, approvedMessage: string) {
    const raw = lead.raw as { email?: string } | undefined;
    return {
      prefillUrl: contactPrefillUrl(
        normalizeEmail(raw?.email),
        undefined,
        lead.subject ?? "A resource for your students",
        approvedMessage,
      ),
    };
  }
}
