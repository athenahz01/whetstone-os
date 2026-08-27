/**
 * The controlled vocabularies observed in the two sheets, with an escape hatch.
 *
 * A value outside a vocabulary is stored raw and flagged. It is never coerced
 * to the nearest match, because the nearest match is a guess and a guess here
 * silently rewrites what a human wrote about a real family. "Affiliate" and
 * "Affiliate Referral" look like the same thing and are two of the six
 * head-to-head conflicts; a fuzzy matcher would have merged them and lost the
 * disagreement the ruling list exists to surface.
 */

export const CRM_STATUSES = [
  "Cold",
  "Active",
  "Complete",
  "NQ",
  "Lost",
  "Engage",
  "Prospect",
  "Negotiate",
  "Inactive",
] as const;

export type CrmStatus = (typeof CRM_STATUSES)[number];

/** Stages a lead can still be worked. Everything else is closed. */
export const LIVE_CRM_STATUSES: readonly CrmStatus[] = [
  "Negotiate",
  "Active",
  "Engage",
  "Prospect",
  "Cold",
];

export const CRM_REFERRER_SOURCES = [
  "Parent Referral",
  "Student Referral",
  "Sibling",
  "Affiliate Referral",
  "Direct",
  "Event",
  "Influencer",
  "Linkedin",
] as const;

export type CrmReferrerSource = (typeof CRM_REFERRER_SOURCES)[number];

export const CRM_MEETING_MEDIA = ["Video", "Phone", "HC", "Meet"] as const;
export type CrmMeetingMedium = (typeof CRM_MEETING_MEDIA)[number];

/**
 * A vocabulary read.
 *
 * `raw` is always what the cell said, verbatim. `value` is the canonical member
 * or null. `unmapped` is true when the cell held something the vocabulary does
 * not contain, which is a fact to surface rather than an error to swallow.
 */
export interface VocabularyRead<T extends string> {
  raw: string;
  value: T | null;
  unmapped: boolean;
}

function read<T extends string>(
  raw: string | null | undefined,
  members: readonly T[],
): VocabularyRead<T> {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { raw: "", value: null, unmapped: false };
  // Case and surrounding whitespace are formatting, not meaning. Anything
  // beyond that is a different string and is kept as one.
  const match = members.find(
    (member) => member.toLowerCase() === trimmed.toLowerCase(),
  );
  return {
    raw: trimmed,
    value: match ?? null,
    unmapped: match === undefined,
  };
}

export function readStatus(raw: string | null | undefined) {
  return read(raw, CRM_STATUSES);
}

export function readReferrerSource(raw: string | null | undefined) {
  return read(raw, CRM_REFERRER_SOURCES);
}

export function readMeetingMedium(raw: string | null | undefined) {
  return read(raw, CRM_MEETING_MEDIA);
}

export function isLiveStatus(value: CrmStatus | null): boolean {
  return value !== null && LIVE_CRM_STATUSES.includes(value);
}
