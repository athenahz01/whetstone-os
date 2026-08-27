import type { CrmField, MergedCrmLead } from "./merge";
import { isLiveStatus, readStatus } from "./vocabulary";

/**
 * What a disputed cell may and may not do.
 *
 * A disputed cell is readable. It is not actionable. It never drives a stall, a
 * threshold or a draft, because acting on one of two disagreeing values is
 * choosing between them, and the whole point of importing it as disputed was
 * that nobody has chosen yet.
 *
 * The failure this prevents is the quiet one: defaulting to `!Dashboard` for
 * display is a stated default, while defaulting to it for a nag sent to a
 * family is a decision nobody recorded making.
 */

export interface ResolvedRuling {
  field: CrmField;
  resolvedValue: string;
}

export interface CrmLeadView {
  identity: string;
  leadRef: string;
  values: Partial<Record<CrmField, string>>;
  disputedFields: CrmField[];
}

export function toLeadView(
  lead: MergedCrmLead,
  rulings: ResolvedRuling[] = [],
): CrmLeadView {
  const ruled = new Map(rulings.map((ruling) => [ruling.field, ruling]));
  const values = { ...lead.values };
  for (const [field, ruling] of ruled) values[field] = ruling.resolvedValue;
  return {
    identity: lead.identity,
    leadRef: lead.leadRef,
    values,
    // A ruled field is no longer disputed. That is what makes a ruling an
    // update rather than a re-import.
    disputedFields: lead.disputes
      .map((dispute) => dispute.field)
      .filter((field) => !ruled.has(field)),
  };
}

/**
 * The value a downstream job may act on, or undefined.
 *
 * Undefined is deliberate and is not the same as empty. A caller that wants to
 * act has to handle the absence, which is what stops a disputed stage silently
 * becoming a default one.
 */
export function actionableValue(
  lead: CrmLeadView,
  field: CrmField,
): string | undefined {
  if (lead.disputedFields.includes(field)) return undefined;
  return lead.values[field];
}

export interface StallCandidate {
  identity: string;
  leadRef: string;
  status: string;
}

export interface StallExclusion {
  identity: string;
  leadRef: string;
  reason: "disputed-stage" | "unmapped-stage" | "no-stage" | "closed-stage";
}

export interface StallSelection {
  candidates: StallCandidate[];
  excluded: StallExclusion[];
}

/**
 * Which leads a silence clock may consider.
 *
 * 7.5c owns the clock. This owns the gate in front of it, because the exclusion
 * rule is a 7.5a acceptance criterion: a lead whose stage is disputed leaves
 * the list with a reason, rather than being clocked against whichever value
 * happened to win the import.
 *
 * Every lead lands in exactly one of the two arrays. A lead that simply
 * vanished from both would be the same silent loss the import refuses.
 */
export function selectStallCandidates(leads: CrmLeadView[]): StallSelection {
  const candidates: StallCandidate[] = [];
  const excluded: StallExclusion[] = [];
  for (const lead of leads) {
    const status = actionableValue(lead, "status");
    if (status === undefined) {
      excluded.push({
        identity: lead.identity,
        leadRef: lead.leadRef,
        reason: lead.disputedFields.includes("status")
          ? "disputed-stage"
          : "no-stage",
      });
      continue;
    }
    const read = readStatus(status);
    if (read.unmapped) {
      // A stage nobody recognises is not silently treated as live or closed.
      excluded.push({
        identity: lead.identity,
        leadRef: lead.leadRef,
        reason: "unmapped-stage",
      });
      continue;
    }
    if (!isLiveStatus(read.value)) {
      excluded.push({
        identity: lead.identity,
        leadRef: lead.leadRef,
        reason: "closed-stage",
      });
      continue;
    }
    candidates.push({
      identity: lead.identity,
      leadRef: lead.leadRef,
      status: read.value as string,
    });
  }
  return { candidates, excluded };
}
