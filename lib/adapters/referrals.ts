import type { ChannelAdapter, Lead } from "../core/types";
import {
  assertConsent,
  assertConsentDestination,
  contactPrefillUrl,
  normalizeContact,
  normalizeEmail,
  normalizePhone,
  parseCsvRecords,
  type ConsentProvenance,
  type ContactRecord,
} from "./contact-utils";

export interface ReferralRecord extends ContactRecord {
  contactType: "professional_partner" | "consented_contact";
  referredBy?: string;
  publicSourceUrl?: string;
  consent?: ConsentProvenance;
  currentClient?: boolean;
}

export function parseReferralCsv(contents: string): ReferralRecord[] {
  return parseCsvRecords(contents).map((row) => ({
    id: row.id,
    name: row.name ?? "",
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    subject: row.subject,
    location: row.location,
    createdAt: row.createdat,
    tutorId: row.tutorid,
    contactType: row.contacttype as ReferralRecord["contactType"],
    referredBy: row.referredby,
    publicSourceUrl: row.publicsourceurl,
    consent:
      row.consentrecordedat || row.consentsource || row.consentscope
        ? {
            recordedAt: row.consentrecordedat,
            source: row.consentsource,
            scope: row.consentscope,
          }
        : undefined,
  }));
}

export function parseReferralJson(contents: string): ReferralRecord[] {
  const value = JSON.parse(contents) as
    ReferralRecord[] | { contacts?: ReferralRecord[] };
  const records = Array.isArray(value) ? value : value.contacts;
  if (!Array.isArray(records)) {
    throw new Error(
      "Referral JSON must be an array or an object with contacts.",
    );
  }
  return records;
}

function officialPublicUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" ? url.toString() : undefined;
}

export function normalizeReferralRecord(record: ReferralRecord): Lead {
  if (record.currentClient) {
    throw new Error(
      "Current client families are human-owned and cannot be imported.",
    );
  }
  if (record.contactType === "consented_contact") {
    assertConsent(record.consent);
    assertConsentDestination(
      record.consent,
      normalizeEmail(record.email),
      normalizePhone(record.phone),
    );
  }
  if (
    record.contactType !== "professional_partner" &&
    record.contactType !== "consented_contact"
  ) {
    throw new Error(
      "Referral contactType must name the permitted source population.",
    );
  }
  const publicSourceUrl = officialPublicUrl(record.publicSourceUrl);
  if (record.contactType === "professional_partner" && !publicSourceUrl) {
    throw new Error(
      "A professional referral partner requires a public HTTPS source.",
    );
  }
  return normalizeContact(
    "referrals",
    record,
    {
      source: "operator-referral-import",
      professionalAdult: record.contactType === "professional_partner",
      publicSourceUrl,
      consent: record.consent,
      referredBy: record.referredBy?.trim(),
    },
    { defaultSubject: "Professional referral" },
  );
}

export class ReferralsAdapter implements ChannelAdapter {
  readonly name = "referrals";
  constructor(private readonly records: readonly ReferralRecord[]) {}
  async poll(): Promise<Lead[]> {
    return this.records.map(normalizeReferralRecord);
  }
  async send(lead: Lead, approvedMessage: string) {
    const raw = lead.raw as { email?: string; phone?: string } | undefined;
    return {
      prefillUrl: contactPrefillUrl(
        normalizeEmail(raw?.email),
        normalizePhone(raw?.phone),
        lead.subject ?? "Referral follow-up",
        approvedMessage,
      ),
    };
  }
}
