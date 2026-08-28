import { assertedTouch, type TouchRecord } from "./touches";
import {
  DIGEST_ACTIONS,
  type DailyDigest,
  type DigestAction,
  type DigestItem,
} from "./digest";

/**
 * The reply, and the CRM write it performs.
 *
 * "The reply is the CRM write. Nobody opens a spreadsheet." That sentence is
 * the whole design. Every branch here ends in a row, and none of them ends in a
 * flag that hides something: "already spoke to them" writes a real touch,
 * "mark lost" writes a stage change, "snooze" writes a date it comes back on.
 *
 * The record gets accurate through use rather than through maintenance. A false
 * stall Ren dismisses becomes a true touch, and he never opens a form to do it,
 * which inverts the failure that emptied the spreadsheet: keeping the record
 * current was a separate chore and the chore lost.
 */

export interface DigestCommand {
  code: string;
  item: DigestItem;
  action: DigestAction;
}

export interface ParsedDigestReply {
  commands: DigestCommand[];
  /**
   * Tokens that addressed nothing, kept rather than dropped.
   *
   * A reply that is half understood and silently half applied is worse than one
   * that is refused, because the sender believes all of it landed.
   */
  unrecognised: string[];
  /** The same lead answered twice in one reply, which is a question not a write. */
  conflicts: Array<{ leadRef: string; actions: DigestAction[] }>;
}

/**
 * Reads a reply into commands.
 *
 * Tolerant about shape and strict about meaning: any separator, any order, and
 * a code that does not address a lead in this message is reported rather than
 * guessed at. Codes are resolved against the digest that was actually sent, so
 * yesterday's "24" cannot act on today's second lead.
 */
export function parseDigestReply(
  text: string,
  digest: DailyDigest,
): ParsedDigestReply {
  const byCode = new Map<string, DigestCommand>();
  for (const item of digest.items) {
    for (const action of DIGEST_ACTIONS) {
      byCode.set(item.codes[action], {
        code: item.codes[action],
        item,
        action,
      });
    }
  }

  const commands: DigestCommand[] = [];
  const unrecognised: string[] = [];
  const seen = new Set<string>();
  for (const token of text.split(/[^0-9]+/).filter(Boolean)) {
    const command = byCode.get(token);
    if (!command) {
      unrecognised.push(token);
      continue;
    }
    if (seen.has(command.code)) continue;
    seen.add(command.code);
    commands.push(command);
  }

  const byLead = new Map<string, DigestAction[]>();
  for (const command of commands) {
    const held = byLead.get(command.item.leadRef) ?? [];
    held.push(command.action);
    byLead.set(command.item.leadRef, held);
  }
  const conflicts = [...byLead.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([leadRef, actions]) => ({ leadRef, actions }));

  return { commands, unrecognised, conflicts };
}

/** How long a snooze lasts. Configuration, like every other interval here. */
export const DEFAULT_SNOOZE_DAYS = 7;

export interface LeadActionRecord {
  identity: string;
  leadRef: string;
  action: DigestAction;
  /** Who replied. Never blank: a write nobody owns is not attributed. */
  actor: string;
  /** When they replied. */
  actedAt: Date;
  /** Which day's message this answered, so a reply can be traced to its list. */
  digestDate: Date;
}

export interface SnoozeRecord {
  identity: string;
  leadRef: string;
  until: Date;
  actor: string;
  createdAt: Date;
}

export interface DigestActionRepository {
  /** The attributed audit row. Written for every reply, whatever it does. */
  recordAction(action: LeadActionRecord): Promise<void>;
  recordSnooze(snooze: SnoozeRecord): Promise<void>;
  /** Writes the stage and returns nothing. Refuses a disputed stage. */
  markLost(input: {
    identity: string;
    actor: string;
    actedAt: Date;
  }): Promise<void>;
  upsertTouch(touch: TouchRecord): Promise<void>;
}

/** Starting a draft is a handoff, not a write to the CRM record. */
export interface DraftRequest {
  identity: string;
  leadRef: string;
  requestedBy: string;
  requestedAt: Date;
}

export interface AppliedDigestReply {
  applied: DigestCommand[];
  drafts: DraftRequest[];
  touches: TouchRecord[];
  snoozes: SnoozeRecord[];
  /** Commands refused, with the reason, so nothing fails silently. */
  refused: Array<{ code: string; reason: "conflicting_actions" }>;
}

export class UnattributedReplyError extends Error {
  constructor() {
    super("A reply must name who sent it before it may write to the CRM.");
    this.name = "UnattributedReplyError";
  }
}

/**
 * Applies a parsed reply.
 *
 * Every command writes an attributed action row first, so the audit trail
 * exists whether or not the write behind it is a touch, a stage, or a date. A
 * lead answered twice in one reply is refused rather than resolved: choosing
 * between "mark lost" and "already spoke to them" is not a decision code should
 * make on somebody's behalf.
 */
export async function applyDigestReply(
  parsed: ParsedDigestReply,
  repository: DigestActionRepository,
  context: {
    actor: string;
    now: Date;
    digestDate: Date;
    snoozeDays?: number;
  },
): Promise<AppliedDigestReply> {
  const actor = context.actor.trim();
  if (!actor) throw new UnattributedReplyError();

  const conflicted = new Set(
    parsed.conflicts.map((conflict) => conflict.leadRef),
  );
  const applied: DigestCommand[] = [];
  const drafts: DraftRequest[] = [];
  const touches: TouchRecord[] = [];
  const snoozes: SnoozeRecord[] = [];
  const refused: AppliedDigestReply["refused"] = [];

  for (const command of parsed.commands) {
    if (conflicted.has(command.item.leadRef)) {
      refused.push({ code: command.code, reason: "conflicting_actions" });
      continue;
    }

    await repository.recordAction({
      identity: command.item.identity,
      leadRef: command.item.leadRef,
      action: command.action,
      actor,
      actedAt: context.now,
      digestDate: context.digestDate,
    });

    if (command.action === "spoke") {
      // A real row, not a suppression. The clock resets because contact was
      // recorded, the same way it would for an email nobody had to type.
      const touch = assertedTouch({
        identity: command.item.identity,
        leadRef: command.item.leadRef,
        assertedBy: actor,
        occurredAt: context.now,
      });
      await repository.upsertTouch(touch);
      touches.push(touch);
    } else if (command.action === "snooze") {
      const until = new Date(
        context.now.getTime() +
          (context.snoozeDays ?? DEFAULT_SNOOZE_DAYS) * 24 * 60 * 60 * 1000,
      );
      const snooze = {
        identity: command.item.identity,
        leadRef: command.item.leadRef,
        until,
        actor,
        createdAt: context.now,
      };
      await repository.recordSnooze(snooze);
      snoozes.push(snooze);
    } else if (command.action === "lost") {
      await repository.markLost({
        identity: command.item.identity,
        actor,
        actedAt: context.now,
      });
    } else {
      // A draft is a handoff to S3.draft, which runs the voice gate. Nothing
      // is written here and nothing is sent anywhere.
      drafts.push({
        identity: command.item.identity,
        leadRef: command.item.leadRef,
        requestedBy: actor,
        requestedAt: context.now,
      });
    }
    applied.push(command);
  }

  return { applied, drafts, touches, snoozes, refused };
}
