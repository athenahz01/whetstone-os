import type { ChannelAdapter, Lead } from "../core/types";
import {
  assertConsent,
  assertConsentDestination,
  contactPrefillUrl,
  normalizeContact,
  normalizeEmail,
  normalizePhone,
  type ConsentProvenance,
  type ContactRecord,
} from "./contact-utils";

export interface ReengagementRecord extends ContactRecord {
  consent?: ConsentProvenance;
  suppressed?: boolean;
  currentClient?: boolean;
}

export class ReengagementImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReengagementImportError";
  }
}

export function normalizeReengagementRecord(record: ReengagementRecord): Lead {
  try {
    assertConsent(record.consent);
  } catch (error) {
    throw new ReengagementImportError(
      error instanceof Error
        ? error.message
        : "Consent provenance is required.",
    );
  }
  if (record.suppressed) {
    throw new ReengagementImportError(
      "Suppressed contacts cannot be imported.",
    );
  }
  if (record.currentClient) {
    throw new ReengagementImportError(
      "Current client families are human-owned and cannot be imported.",
    );
  }
  try {
    assertConsentDestination(
      record.consent,
      normalizeEmail(record.email),
      normalizePhone(record.phone),
    );
  } catch (error) {
    throw new ReengagementImportError(
      error instanceof Error ? error.message : "Consent scope is invalid.",
    );
  }
  return normalizeContact(
    "reengagement",
    record,
    {
      source: "operator-supplied-dormant-contact",
      consent: record.consent,
    },
    { defaultSubject: "Dormant tutoring follow-up" },
  );
}

export class ReengagementAdapter implements ChannelAdapter {
  readonly name = "reengagement";

  constructor(private readonly records: readonly ReengagementRecord[]) {}

  async poll(): Promise<Lead[]> {
    // Validate the whole import before returning anything. A mixed batch with
    // one missing consent record is rejected atomically, never partially used.
    return this.records.map(normalizeReengagementRecord);
  }

  async send(lead: Lead, approvedMessage: string) {
    const raw = lead.raw as { email?: string; phone?: string } | undefined;
    return {
      prefillUrl: contactPrefillUrl(
        normalizeEmail(raw?.email),
        normalizePhone(raw?.phone),
        lead.subject ?? "Following up",
        approvedMessage,
      ),
    };
  }
}
