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
  const owners = new Map<string, number>();
  let deduped = 0;

  for (const lead of leads) {
    const keys = prospectIdentityKeys(lead);
    const existingIndex = keys
      .map((key) => owners.get(key))
      .find((index): index is number => index !== undefined);
    if (existingIndex === undefined) {
      const index = kept.push(lead) - 1;
      for (const key of keys) owners.set(key, index);
      continue;
    }

    deduped += 1;
    const existing = kept[existingIndex];
    const existingRaw =
      existing.raw && typeof existing.raw === "object"
        ? (existing.raw as Record<string, unknown>)
        : {};
    kept[existingIndex] = {
      ...existing,
      raw: {
        ...existingRaw,
        duplicateSourceIds: [
          ...(Array.isArray(existingRaw.duplicateSourceIds)
            ? existingRaw.duplicateSourceIds
            : []),
          lead.id,
        ],
      },
    };
    for (const key of keys) owners.set(key, existingIndex);
  }

  return { leads: kept, deduped };
}
