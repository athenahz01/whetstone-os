import { normalizeEmail, normalizePhone } from "../adapters/contact-utils";
import type { CrmField } from "./merge";
import { CONTACT_FIELDS } from "./merge";
import { actionableValue, type CrmLeadView } from "./actionable";

/**
 * Which lead a message belongs to.
 *
 * The index is deliberately not a `Map<address, identity>`. An address can
 * legitimately reach two leads - a parent with two children in the pipeline is
 * the ordinary case, and `P1 Email` is the same person on both rows - so the
 * index holds every lead an address reaches and the lookup reports ambiguity
 * instead of picking one.
 *
 * This is the 7.5a finding restated for a different join. There, balance proved
 * nothing was lost and could not prove anything was joined correctly, and three
 * leads split in two while the totals looked healthy. Here, a count of matched
 * messages cannot prove the matches went to the right leads. So ambiguity is a
 * separate outcome with its own count, not a silent first-wins.
 */

export type ContactKind = "email" | "phone";

export interface ContactEntry {
  /** The normalized address or number, which is what gets compared. */
  value: string;
  kind: ContactKind;
  identity: string;
  leadRef: string;
  field: CrmField;
}

export interface ContactIndex {
  entries: ContactEntry[];
  /** Normalized value to every lead it reaches. */
  byValue: Map<string, ContactEntry[]>;
  /**
   * Leads carrying no usable contact detail, with the fields that were empty.
   *
   * Not an error and not healthy. 7.5c renders these as `unmonitorable`; the
   * point of naming the fields here is that the reason travels with the lead
   * rather than being recomputed by whoever displays it.
   */
  unmonitorable: Array<{
    identity: string;
    leadRef: string;
    missingFields: CrmField[];
  }>;
  /**
   * Contact cells skipped because the two files disagree and nobody has ruled.
   *
   * A disputed address is not a fact about who a message was from, so it is
   * excluded from matching for the same reason a disputed stage cannot drive a
   * stall. Counted rather than dropped, because a lead that became
   * unmonitorable through a dispute is a different problem from one that never
   * had an address, and the two must not look alike.
   */
  disputedContacts: Array<{
    identity: string;
    leadRef: string;
    field: CrmField;
  }>;
}

export type ContactLookup =
  | { outcome: "matched"; entry: ContactEntry }
  | { outcome: "unmatched" }
  | { outcome: "ambiguous"; entries: ContactEntry[] };

/**
 * A phone number reduced to what two records can actually be compared on.
 *
 * The sheets hold `(555) 010-1234` and a provider hands back `+15550101234`.
 * Those are the same number and `normalizePhone` alone keeps them apart, so
 * every phone match would silently fail while the counts still balanced.
 *
 * The rule is deliberately narrow: strip to digits, then drop a leading `1`
 * when what remains is ten digits. That is the North American case, which is
 * what Whetstone has. A number that is not ten digits after that is compared
 * whole rather than guessed at, so an international number does not get
 * mangled into a collision.
 */
export function comparablePhone(raw: string): string | undefined {
  const normalized = normalizePhone(raw);
  if (!normalized) return undefined;
  const digits = normalized.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function normalizeContactValue(
  field: CrmField,
  raw: string,
): { value: string; kind: ContactKind } | undefined {
  if (field.endsWith("Email")) {
    const value = normalizeEmail(raw);
    return value ? { value, kind: "email" } : undefined;
  }
  const value = comparablePhone(raw);
  return value ? { value, kind: "phone" } : undefined;
}

/**
 * Builds the index from merged leads.
 *
 * Reads every contact cell through `actionableValue`, so a disputed address is
 * never indexed. Normalization is the shared `normalizeEmail` / `normalizePhone`
 * from the adapter layer rather than a second implementation, because two
 * normalizers that drift are how an address matches on one surface and not on
 * another.
 */
export function buildContactIndex(leads: CrmLeadView[]): ContactIndex {
  const entries: ContactEntry[] = [];
  const byValue = new Map<string, ContactEntry[]>();
  const unmonitorable: ContactIndex["unmonitorable"] = [];
  const disputedContacts: ContactIndex["disputedContacts"] = [];

  for (const lead of leads) {
    const missingFields: CrmField[] = [];
    let usable = 0;
    for (const field of CONTACT_FIELDS) {
      if (lead.disputedFields.includes(field)) {
        disputedContacts.push({
          identity: lead.identity,
          leadRef: lead.leadRef,
          field,
        });
        missingFields.push(field);
        continue;
      }
      const raw = actionableValue(lead, field);
      if (!raw?.trim()) {
        missingFields.push(field);
        continue;
      }
      const normalized = normalizeContactValue(field, raw);
      if (!normalized) {
        // Present but unusable. It is missing for matching purposes, which is
        // the only purpose this index serves.
        missingFields.push(field);
        continue;
      }
      usable += 1;
      const entry: ContactEntry = {
        value: normalized.value,
        kind: normalized.kind,
        identity: lead.identity,
        leadRef: lead.leadRef,
        field,
      };
      entries.push(entry);
      const held = byValue.get(normalized.value) ?? [];
      held.push(entry);
      byValue.set(normalized.value, held);
    }
    if (usable === 0) {
      unmonitorable.push({
        identity: lead.identity,
        leadRef: lead.leadRef,
        missingFields,
      });
    }
  }

  return { entries, byValue, unmonitorable, disputedContacts };
}

/**
 * Resolves one address to one lead, or says why it could not.
 *
 * Ambiguity is its own outcome. Returning the first match would attribute a
 * parent's email to whichever child happened to be indexed first, and every
 * count downstream would still add up.
 */
export function lookupContact(
  index: ContactIndex,
  kind: ContactKind,
  raw: string,
): ContactLookup {
  // The same reduction the index was built with. Two normalizers that drift
  // are how an address matches on one surface and not on another.
  const normalized =
    kind === "email" ? normalizeEmail(raw) : comparablePhone(raw);
  if (!normalized) return { outcome: "unmatched" };
  const held = index.byValue.get(normalized) ?? [];
  const matches = held.filter((entry) => entry.kind === kind);
  if (matches.length === 0) return { outcome: "unmatched" };
  // Two cells on the same lead holding the same address is one lead, not an
  // ambiguity. The question is how many distinct leads an address reaches.
  const identities = new Set(matches.map((entry) => entry.identity));
  if (identities.size > 1) return { outcome: "ambiguous", entries: matches };
  return { outcome: "matched", entry: matches[0]! };
}
