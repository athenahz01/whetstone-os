import { stableLeadId } from "../core/stable-id";
import type { Lead } from "../core/types";

export interface ConsentProvenance {
  recordedAt: string;
  source: string;
  scope: string;
}

export function assertConsent(
  value: unknown,
): asserts value is ConsentProvenance {
  if (!value || typeof value !== "object") {
    throw new Error("Consent provenance is required at import.");
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.recordedAt !== "string" ||
    Number.isNaN(Date.parse(item.recordedAt)) ||
    typeof item.source !== "string" ||
    !item.source.trim() ||
    typeof item.scope !== "string" ||
    !item.scope.trim()
  ) {
    throw new Error(
      "Consent provenance must include a valid recordedAt, source, and scope.",
    );
  }
}

export function assertConsentDestination(
  consent: ConsentProvenance,
  email: string | undefined,
  phone: string | undefined,
): void {
  const scope = consent.scope.toLowerCase();
  const permitsEmail = /\bemail\b/.test(scope);
  const permitsPhone = /\b(?:sms|text|phone)\b/.test(scope);
  if ((email && permitsEmail) || (phone && permitsPhone)) return;
  throw new Error(
    "Consent scope must name the available email, SMS, text, or phone follow-up channel.",
  );
}

export function normalizeEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

export function normalizePhone(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const prefix = value.trim().startsWith("+") ? "+" : "";
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15
    ? `${prefix}${digits}`
    : undefined;
}

export function contactPrefillUrl(
  email: string | undefined,
  phone: string | undefined,
  subject: string,
  body?: string,
): string | undefined {
  if (email) {
    const params = new URLSearchParams({ subject });
    if (body) params.set("body", body);
    return `mailto:${email}?${params.toString()}`;
  }
  if (phone) {
    const params = new URLSearchParams();
    if (body) params.set("body", body);
    return `sms:${phone}${params.size ? `?${params.toString()}` : ""}`;
  }
  return undefined;
}

export interface ContactRecord {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  subject?: string;
  location?: string;
  createdAt?: string;
  tutorId?: string;
}

export function normalizeContact(
  channel: string,
  contact: ContactRecord,
  raw: Record<string, unknown>,
  options: { now?: number; defaultSubject: string },
): Lead {
  const name = contact.name.trim();
  const email = normalizeEmail(contact.email);
  const phone = normalizePhone(contact.phone);
  if (!name || (!email && !phone)) {
    throw new Error("A contact requires a name and valid email or phone.");
  }
  const postedAt = contact.createdAt
    ? new Date(contact.createdAt)
    : new Date(options.now ?? Date.now());
  if (Number.isNaN(postedAt.getTime())) {
    throw new Error("A contact has an invalid createdAt timestamp.");
  }
  const subject = contact.subject?.trim() || options.defaultSubject;
  const url = contactPrefillUrl(email, phone, subject);
  if (!url) throw new Error("A contact has no prefillable destination.");
  const nativeId = contact.id?.trim() || email || phone;
  if (!nativeId) throw new Error("A contact requires a stable native id.");
  return {
    id: stableLeadId(channel, nativeId),
    channel,
    author: name,
    text: contact.notes?.trim() || subject,
    subject,
    location: contact.location?.trim() || undefined,
    url,
    postedAt: postedAt.toISOString(),
    tutorId: contact.tutorId?.trim() || "tutor-admissions",
    raw: { ...raw, nativeId, email, phone },
  };
}

export function parseCsvRecords(contents: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (quoted) {
      if (character === '"' && contents[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n") {
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else if (character !== "\r") cell += character;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new Error("CSV contains an unterminated quote.");
  const [headers, ...values] = rows;
  if (!headers) return [];
  const keys = headers.map((value) =>
    value
      .replace(/^\uFEFF/, "")
      .trim()
      .replace(/[^a-z0-9]+/gi, "")
      .toLowerCase(),
  );
  return values.map((cells) =>
    Object.fromEntries(keys.map((key, index) => [key, cells[index] ?? ""])),
  );
}
