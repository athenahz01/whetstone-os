import type { Lead } from "./types";

const highIntentTerms = [
  "looking for",
  "need help",
  "tutor",
  "admissions",
  "application",
  "sat",
  "essay",
];

export function scoreLead(lead: Lead): number {
  if (lead.priority === "high") return 100;

  const searchable = `${lead.subject ?? ""} ${lead.text}`.toLowerCase();
  const intentPoints = highIntentTerms.reduce(
    (score, term) => score + (searchable.includes(term) ? 12 : 0),
    0,
  );
  const completenessPoints =
    (lead.subject ? 8 : 0) + (lead.location ? 6 : 0) + (lead.url ? 6 : 0);

  return Math.min(100, 20 + intentPoints + completenessPoints);
}
