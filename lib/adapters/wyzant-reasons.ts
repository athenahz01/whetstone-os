/**
 * The closed vocabulary of reasons a malformed Wyzant job may report.
 *
 * This lives in its own module, with no Playwright import, because both the
 * adapter (which runs on the GitHub runner) and the wire validator (which runs
 * on Vercel, inside the ingest route) have to agree on it. Pulling the adapter
 * into the route to share a constant would drag a browser driver into a
 * serverless function.
 *
 * Why a vocabulary and not a shape: the reason travels to the app as an adapter
 * exception. A free-text reason is a channel for a learner's name, a parent's
 * name or a phone number to leave the runner. Before this, the reason was
 * whatever `error.message` happened to say, and one ordinary edit inside the
 * extraction block — interpolating `job.author` into a throw — put a learner's
 * name on the wire with the whole suite still green.
 */
export const WYZANT_EXTRACTION_REASONS = [
  "job URL is invalid",
  "job subject is missing",
  "job description is missing",
  // Thrown by parseWyzantPostedAt, a callee inside the same try block. The
  // audit that closed this gap first enumerated only the three throws written
  // directly in the extraction loop and missed this one — which is the point:
  // the reason set was already open to a callee, not merely open in theory.
  "Wyzant job is missing a recognizable posted time.",
  "job could not be normalized",
] as const;

export type WyzantExtractionReason = (typeof WYZANT_EXTRACTION_REASONS)[number];

export function isWyzantExtractionReason(
  value: unknown,
): value is WyzantExtractionReason {
  return (
    typeof value === "string" &&
    (WYZANT_EXTRACTION_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Narrows a thrown message to the vocabulary, or falls back.
 *
 * Anything this does not recognise becomes the fallback rather than
 * travelling. That is what makes the guarantee survive a future edit, instead
 * of resting on today's throws happening to be string literals.
 */
export function narrowWyzantExtractionReason(
  value: unknown,
): WyzantExtractionReason {
  return isWyzantExtractionReason(value)
    ? value
    : "job could not be normalized";
}
