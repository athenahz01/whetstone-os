import type { CrmLeadView } from "../crm/actionable";
import { buildContactIndex } from "../crm/contacts";
import { runTouchScan, type TouchRepository } from "../crm/touch-store";
import type { TouchProvider, TouchRecord } from "../crm/touches";
import type { StepContext, Workflow } from "../core/workflow";

export const S4_TOUCH_SCAN_ID = "S4.touch-scan";

export interface TouchScanWorkflowOptions {
  providers: TouchProvider[];
  repository: TouchRepository;
  /** The merged CRM leads to match against. */
  leads: CrmLeadView[];
  window: { since: Date; until: Date };
  now: Date;
}

export interface TouchScanBatch {
  touches: TouchRecord[];
  providersRead: number;
  providersFailed: number;
  candidatesRead: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
  unaddressed: number;
  unmonitorableLeads: number;
  /** Leads whose every usable contact reaches more than one lead. */
  unattributableLeads: number;
}

/**
 * Reading email and calendar for evidence that a lead was contacted.
 *
 * GREEN because it only observes. It writes rows about what already happened
 * in someone else's mailbox and never produces anything a person has to
 * approve, which is also why there is no `approvals` row in its outputs.
 *
 * One failing provider does not take the other down. This is the per-adapter
 * isolation rule from the ingest tick, restated: a calendar outage must not
 * cost a day of email evidence, and both attempts are recorded either way.
 */
export function createTouchScanWorkflow(
  options: TouchScanWorkflowOptions,
): Workflow {
  return {
    id: S4_TOUCH_SCAN_ID,
    goal: "Record that a lead was contacted, from email and calendar, without ever sending.",
    approvalLevel: "GREEN",
    owner: "Athena Huo",
    inputs: [
      {
        doc: "BASELINES.md",
        why: "The silence thresholds these touches will be measured against.",
      },
    ],
    tools: [
      {
        name: "gmail",
        access: "read",
        why: "Find messages exchanged with a lead. Read-only, never sends.",
      },
      {
        name: "google-calendar",
        access: "read",
        why: "Find meetings held and meetings booked. Read forwards and back.",
      },
      {
        name: "table:crm_touches",
        access: "write",
        why: "Record one row per contact, with how it was learned.",
      },
      {
        name: "table:crm_touch_scans",
        access: "write",
        why: "Record every attempt, so a failure never reads as a quiet day.",
      },
      {
        name: "table:crm_touch_unmatched",
        access: "write",
        why: "Keep messages that matched no lead, with a reason and a count.",
      },
    ],
    outputs: [{ kind: "touch-records", destination: "S5.silence-clock" }],
    steps: [
      {
        id: "scan-providers",
        async run(context: StepContext): Promise<TouchScanBatch> {
          const index = buildContactIndex(options.leads);
          const touches: TouchRecord[] = [];
          const batch: TouchScanBatch = {
            touches,
            providersRead: 0,
            providersFailed: 0,
            candidatesRead: 0,
            matched: 0,
            unmatched: 0,
            ambiguous: 0,
            unaddressed: 0,
            unmonitorableLeads: index.unmonitorable.length,
            // Counted separately from unmonitorable on purpose. A lead with a
            // shared parent address has contact details and still cannot be
            // credited a touch, so folding the two together would let it read
            // as healthy.
            unattributableLeads: index.unattributable.filter((l) => l.wholly)
              .length,
          };

          for (const provider of options.providers) {
            try {
              const outcome = await runTouchScan(
                provider,
                index,
                options.repository,
                options.window,
                options.now,
              );
              batch.providersRead += 1;
              touches.push(...outcome.touches);
              batch.candidatesRead += outcome.scan.candidatesRead;
              batch.matched += outcome.scan.matched;
              batch.unmatched += outcome.scan.unmatched;
              batch.ambiguous += outcome.scan.ambiguous;
              batch.unaddressed += outcome.scan.unaddressed;
            } catch (error) {
              // Isolated, and named without the provider's own words. The scan
              // row already carries the classified reason.
              batch.providersFailed += 1;
              await context.recordException({
                kind: "TouchScanFailed",
                severity: "warning",
                message: `${provider.name}: ${error instanceof Error ? error.name : "UnknownError"}`,
              });
            }
          }

          context.measure("s4.touches_recorded", touches.length, "touches");
          context.measure(
            "s4.leads_unmonitorable",
            batch.unmonitorableLeads,
            "leads",
          );
          context.measure(
            "s4.leads_unattributable",
            batch.unattributableLeads,
            "leads",
          );
          return batch;
        },
      },
    ],
    qaGates: [
      {
        id: "every-touch-says-how-it-was-learned",
        describe:
          "Every recorded touch carries a basis, and an asserted one names who asserted it.",
        check({ outputs }) {
          const batch = outputs.get("scan-providers") as
            TouchScanBatch | undefined;
          return Boolean(
            batch?.touches.every(
              (touch) =>
                (touch.basis === "email" || touch.basis === "calendar") &&
                touch.assertedBy === null,
            ),
          );
        },
      },
      {
        id: "no-message-text-is-stored",
        describe:
          "A touch carries a subject digest and a provider id, never prose.",
        check({ outputs }) {
          const batch = outputs.get("scan-providers") as
            TouchScanBatch | undefined;
          return Boolean(
            batch?.touches.every(
              (touch) =>
                touch.subjectRef === null ||
                /^subj_[0-9a-f]{16}$/.test(touch.subjectRef),
            ),
          );
        },
      },
    ],
    handoff: {
      to: "S5.silence-clock",
      state:
        "touch rows carrying basis, kind and state, with unmonitorable leads named",
    },
    escalation: [
      {
        when: "a provider fails on consecutive scans",
        who: "Athena Huo",
        how: "alert email, from the failed scan rows",
      },
      {
        when: "an address reaches more than one lead",
        who: "Athena Huo",
        how: "ambiguous rows in crm_touch_unmatched, for a human to split",
      },
    ],
    measures: [
      { kpi: "s4.touches_recorded", unit: "touches" },
      { kpi: "s4.leads_unmonitorable", unit: "leads" },
      { kpi: "s4.leads_unattributable", unit: "leads" },
    ],
    // No baseline. H-01 through H-10 record ten manual tasks and none of them
    // is "notice that a lead was contacted and write it down", because in the
    // spreadsheet era that work was not done at all: `1M Date` is filled on 8
    // rows of 69. Putting a number here would be self-report, which the KPI
    // rules name as never a data source, so the field is left absent and the
    // gap is stated instead.
  };
}
