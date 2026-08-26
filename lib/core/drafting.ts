import Anthropic from "@anthropic-ai/sdk";
import type { PrismaClient } from "@prisma/client";
import { loadAgentContext, type AgentContext } from "./context";
import {
  buildDraftPrompt,
  selectPromptVariant,
  type DraftProfile,
} from "./prompts";
import { WHETSTONE_ORG_ID } from "./organization";
import type { Draft, Lead } from "./types";

const DEFAULT_MODEL = "claude-sonnet-5";

interface ClaudeMessage {
  content: Array<{ type: string; text?: string }>;
}

export interface ClaudeClient {
  messages: {
    create(input: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Array<{ role: "user"; content: string }>;
    }): Promise<ClaudeMessage>;
  };
}

export interface DraftProfileRepository {
  getForTutor(tutorId?: string): Promise<DraftProfile | null>;
}

export interface DraftService {
  create(lead: Lead): Promise<Draft>;
}

export class DraftingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftingUnavailableError";
  }
}

export class PrismaDraftProfileRepository implements DraftProfileRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly orgId = WHETSTONE_ORG_ID,
  ) {}

  async getForTutor(tutorId?: string): Promise<DraftProfile | null> {
    const profile = tutorId
      ? await this.client.profile.findFirst({
          where: { orgId: this.orgId, tutorId },
          include: {
            tutor: { select: { id: true, name: true, product: true } },
          },
        })
      : await this.client.profile.findFirst({
          where: { orgId: this.orgId, tutor: { active: true } },
          include: {
            tutor: { select: { id: true, name: true, product: true } },
          },
          orderBy: { tutorId: "asc" },
        });

    if (!profile) return null;
    return {
      tutorId: profile.tutor.id,
      tutorName: profile.tutor.name,
      product: profile.tutor.product,
      copy: profile.shortBio,
      faq: profile.faq,
    };
  }
}

export interface ClaudeDraftServiceOptions {
  profiles: DraftProfileRepository;
  client?: ClaudeClient;
  apiKey?: string;
  model?: string;
  defaultTutorId?: string;
  context?: () => Promise<AgentContext>;
}

export class ClaudeDraftService implements DraftService {
  constructor(private readonly options: ClaudeDraftServiceOptions) {}

  async create(lead: Lead): Promise<Draft> {
    const client = this.resolveClient();
    const profile = await this.options.profiles.getForTutor(
      lead.tutorId ?? this.options.defaultTutorId,
    );
    if (!profile) {
      throw new DraftingUnavailableError(
        "AI drafting is disabled: no active tutor profile is available.",
      );
    }

    const context = await (this.options.context ?? loadAgentContext)();
    const variant = selectPromptVariant(lead.id);
    const prompt = buildDraftPrompt({ lead, profile, variant, context });
    const message = await client.messages.create({
      model: this.options.model ?? DEFAULT_MODEL,
      max_tokens: 500,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
    const body = message.content
      .filter(
        (block): block is { type: string; text: string } =>
          block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!body) throw new Error("Claude returned an empty draft.");
    return {
      leadId: lead.id,
      tutorId: profile.tutorId,
      variant: variant.id,
      body,
    };
  }

  private resolveClient(): ClaudeClient {
    if (this.options.client) return this.options.client;
    if (!this.options.apiKey?.trim()) {
      throw new DraftingUnavailableError(
        "AI drafting is disabled: ANTHROPIC_API_KEY is not configured.",
      );
    }
    return new Anthropic({
      apiKey: this.options.apiKey,
    }) as unknown as ClaudeClient;
  }
}

export class StubDraftService implements DraftService {
  async create(lead: Lead): Promise<Draft> {
    return {
      leadId: lead.id,
      tutorId: lead.tutorId ?? "unassigned",
      variant: "test-stub",
      body: "Human review is required before any send action.",
    };
  }
}
