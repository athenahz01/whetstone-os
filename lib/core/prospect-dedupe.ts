import { createHash } from "node:crypto";
import type { Lead } from "./types";

type RawIdentity = {
  email?: unknown;
  phone?: unknown;
  identityKeys?: unknown;
};

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function normalizePhone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? digits : undefined;
}

function token(kind: string, value: string): string {
  return createHash("sha256").update(`${kind}:${value}`).digest("hex");
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Contact data identifies a household or shared professional address, not a
 * prospect. Merge only when the prospect-specific context also agrees.
 */
export function prospectDiscriminator(lead: Lead): string {
  const raw =
    lead.raw && typeof lead.raw === "object"
      ? (lead.raw as Record<string, unknown>)
      : {};
  if (typeof raw.prospectId === "string" && raw.prospectId.trim()) {
    return token("prospect", raw.prospectId.trim().toLowerCase());
  }
  return token(
    "prospect-context",
    JSON.stringify({
      author: normalizeText(lead.author),
      subject: normalizeText(lead.subject),
      location: normalizeText(lead.location),
      text: normalizeText(lead.text),
    }),
  );
}

function rawRecord(lead: Lead): Record<string, unknown> {
  return lead.raw && typeof lead.raw === "object"
    ? (lead.raw as Record<string, unknown>)
    : {};
}

function appendUnique(values: unknown, value: string): string[] {
  return [
    ...new Set([
      ...(Array.isArray(values)
        ? values.filter((item): item is string => typeof item === "string")
        : []),
      value,
    ]),
  ];
}

function duplicateSnapshot(lead: Lead): Record<string, unknown> {
  return {
    id: lead.id,
    channel: lead.channel,
    author: lead.author,
    subject: lead.subject,
    location: lead.location,
    text: lead.text,
    url: lead.url,
    postedAt: lead.postedAt,
  };
}

/**
 * Strong cross-channel identity only. A name is never enough to merge two
 * people. Adapters may supply already-hashed identity keys when their source
 * has a durable account id that should not be exposed.
 */
export function prospectIdentityKeys(lead: Lead): string[] {
  const raw =
    lead.raw && typeof lead.raw === "object"
      ? (lead.raw as RawIdentity)
      : undefined;
  const keys = new Set<string>();
  const email = normalizeEmail(raw?.email);
  const phone = normalizePhone(raw?.phone);
  if (email) keys.add(token("email", email));
  if (phone) keys.add(token("phone", phone));
  if (Array.isArray(raw?.identityKeys)) {
    for (const value of raw.identityKeys) {
      if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) {
        keys.add(value);
      }
    }
  }
  return [...keys].sort();
}

export interface CrossAdapterDedupeResult {
  leads: Lead[];
  deduped: number;
}

export function dedupeAcrossAdapters(
  leads: readonly Lead[],
): CrossAdapterDedupeResult {
  const kept: Lead[] = [];
  const owners = new Map<string, Set<number>>();
  let deduped = 0;

  for (const lead of leads) {
    const keys = prospectIdentityKeys(lead);
    const relatedIndexes = new Set(
      keys.flatMap((key) => [...(owners.get(key) ?? [])]),
    );
    const discriminator = prospectDiscriminator(lead);
    const existingIndex = [...relatedIndexes].find(
      (index) => prospectDiscriminator(kept[index]) === discriminator,
    );
    if (existingIndex === undefined) {
      const index = kept.push(lead) - 1;
      if (relatedIndexes.size > 0) {
        kept[index] = {
          ...lead,
          raw: {
            ...rawRecord(lead),
            relatedProspectIds: [...relatedIndexes].map(
              (relatedIndex) => kept[relatedIndex].id,
            ),
          },
        };
        for (const relatedIndex of relatedIndexes) {
          const related = kept[relatedIndex];
          const relatedRaw = rawRecord(related);
          kept[relatedIndex] = {
            ...related,
            raw: {
              ...relatedRaw,
              relatedProspectIds: appendUnique(
                relatedRaw.relatedProspectIds,
                lead.id,
              ),
            },
          };
        }
      }
      for (const key of keys) {
        const indexes = owners.get(key) ?? new Set<number>();
        indexes.add(index);
        owners.set(key, indexes);
      }
      continue;
    }

    deduped += 1;
    const existing = kept[existingIndex];
    const existingRaw = rawRecord(existing);
    kept[existingIndex] = {
      ...existing,
      raw: {
        ...existingRaw,
        duplicateSourceIds: appendUnique(
          existingRaw.duplicateSourceIds,
          lead.id,
        ),
        duplicateProspects: [
          ...(Array.isArray(existingRaw.duplicateProspects)
            ? existingRaw.duplicateProspects
            : []),
          duplicateSnapshot(lead),
        ],
      },
    };
    for (const key of keys) {
      const indexes = owners.get(key) ?? new Set<number>();
      indexes.add(existingIndex);
      owners.set(key, indexes);
    }
  }

  return { leads: kept, deduped };
}
