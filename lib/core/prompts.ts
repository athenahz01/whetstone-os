import { createHash } from "node:crypto";
import type { AgentContext } from "./context";
import type { Lead } from "./types";

export interface DraftProfile {
  tutorId: string;
  tutorName: string;
  product: string;
  copy: string;
  faq: unknown;
}

export interface PromptVariant {
  id: string;
  instruction: string;
}

export const promptVariants: readonly PromptVariant[] = [
  {
    id: "specific-first",
    instruction:
      "Open with one concrete detail from the inquiry, then make a concise connection to the tutor's relevant experience.",
  },
  {
    id: "question-led",
    instruction:
      "Open with one genuinely useful question grounded in the inquiry, then explain how the tutor could help.",
  },
  {
    id: "plan-first",
    instruction:
      "Open with a practical two-step direction for this exact situation, then offer the tutor's help without pressure.",
  },
] as const;

export function selectPromptVariant(leadId: string): PromptVariant {
  const digest = createHash("sha256").update(leadId).digest();
  return promptVariants[digest[0] % promptVariants.length];
}

export function buildDraftPrompt({
  lead,
  profile,
  variant,
  context,
}: {
  lead: Lead;
  profile: DraftProfile;
  variant: PromptVariant;
  context: AgentContext;
}) {
  return {
    system: [
      `You prepare a human-reviewed reply for ${profile.product}.`,
      "Nothing is sent automatically. Return only the draft body.",
      `Prompt context hash: ${context.hash}`,
      "The four documents below are authoritative. Do not use blocked facts.",
      context.promptText,
      `Variant direction: ${variant.instruction}`,
    ].join("\n\n"),
    user: [
      `Lead subject: ${lead.subject ?? "Not provided"}`,
      `Lead location: ${lead.location ?? "Not provided"}`,
      `Lead text: ${lead.text}`,
      `Channel: ${lead.channel}`,
      `Tutor: ${profile.tutorName}`,
      `Tutor profile copy: ${profile.copy}`,
      `FAQ context: ${JSON.stringify(profile.faq)}`,
      "Reference at least one specific inquiry detail.",
    ].join("\n"),
  };
}
