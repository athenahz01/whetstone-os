import type { CrmLeadView } from "../crm/actionable";
import type { ScanCoverage } from "../crm/touches";
import {
  runSilenceClock,
  type ClockEntry,
  type SilenceClockResult,
} from "../crm/clock";
import type { ContactIndex } from "../crm/contacts";
import type { ThresholdRepository } from "../crm/threshold-store";
import type { SilenceThresholds, WideningPolicy } from "../crm/thresholds";
import type { TouchRecord } from "../crm/touches";
import type { StepContext, Workflow } from "../core/workflow";

export const S5_SILENCE_CLOCK_ID = "S5.silence-clock";

export interface SilenceClockWorkflowOptions {
  /** What the touch scan this run reads from actually covered. */
  coverage: ScanCoverage;
  leads: CrmLeadView[];
  index: ContactIndex;
  touchesByIdentity: Map<string, TouchRecord[]>;
  thresholds: SilenceThresholds;
  thresholdRepository: ThresholdRepository;
  now: Date;
  policy?: WideningPolicy;
}

export interface SilenceClockBatch extends SilenceClockResult {
  leadsRead: number;
  stallCount: number;
  needsAttentionCount: number;
}

/**
 * The clock, as a recorded run.
 *
 * GREEN because it computes and observes. It writes one kind of row, a
 * threshold that has moved off its stage default, and that write exists only
 * because section 7 forbids changing a cadence without saying so.
 *
 * The stall list itself is not stored. It is derived from the lead records and
 * the touch record on every run, and a stored copy would be a second version of
 * a derived fact - which is precisely the failure this whole phase exists to
 * undo.
 */
export function createSilenceClockWorkflow(
  options: SilenceClockWorkflowOptions,
): Workflow {
  return {
    id: S5_SILENCE_CLOCK_ID,
    goal: "Say which live leads have gone quiet longer than their stage allows, and which cannot be measured at all.",
    approvalLevel: "GREEN",
    owner: "Athena Huo",
    inputs: [
      {
        doc: "BASELINES.md",
        why: "The comparison targets the stall counts are read against.",
      },
    ],
    tools: [
      {
        name: "table:crm_leads",
        access: "read",
        why: "The stage and contact cells the clock reads.",
      },
      {
        name: "table:crm_touches",
        access: "read",
        why: "The last contact, and any call booked ahead.",
      },
      {
        name: "table:crm_threshold_overrides",
        access: "write",
        why: "Record a widened threshold with its reason. Never a silent tuning.",
      },
    ],
    outputs: [{ kind: "stall-list", destination: "S6.daily-message" }],
    steps: [
      {
        id: "run-clock",
        async run(context: StepContext): Promise<SilenceClockBatch> {
          const result = runSilenceClock({
            leads: options.leads,
            index: options.index,
            touchesByIdentity: options.touchesByIdentity,
            thresholds: options.thresholds,
            now: options.now,
            policy: options.policy,
            // Passed through from the scan, never assumed here. A stall that
            // names a mailbox nobody read is the clock asserting evidence it
            // does not have.
            coverage: options.coverage,
          });

          for (const adjustment of result.adjustments) {
            await options.thresholdRepository.recordAdjustment(adjustment);
          }
          // A lead whose asserted run has broken returns to its stage default,
          // and the override lapses rather than lingering as a quiet
          // suppression nobody remembers switching on.
          const widened = new Set(
            result.adjustments.map((adjustment) => adjustment.identity),
          );
          await options.thresholdRepository.clearAdjustments(
            result.entries
              .filter((entry) => !widened.has(entry.identity))
              .map((entry) => entry.identity),
            options.now,
          );

          context.measure("s5.stalls_open", result.stalls.length, "leads");
          context.measure(
            "s5.leads_not_measurable",
            result.needsAttention.length,
            "leads",
          );
          return {
            ...result,
            leadsRead: options.leads.length,
            stallCount: result.stalls.length,
            needsAttentionCount: result.needsAttention.length,
          };
        },
      },
    ],
    qaGates: [
      {
        id: "every-lead-lands-somewhere",
        describe:
          "Every lead read leaves in exactly one outcome. None of them is an absence.",
        check({ outputs }) {
          const batch = outputs.get("run-clock") as
            SilenceClockBatch | undefined;
          return Boolean(
            batch &&
            batch.balanced &&
            batch.entries.length === batch.leadsRead &&
            batch.entries.every((entry) => Boolean(entry.outcome)),
          );
        },
      },
      {
        id: "no-stall-states-a-number-without-its-basis",
        describe:
          "Every stall names what was searched and what no scan can see.",
        check({ outputs }) {
          const batch = outputs.get("run-clock") as
            SilenceClockBatch | undefined;
          return Boolean(
            batch?.stalls.every(
              (entry: ClockEntry) =>
                entry.evidence.searched.length > 0 &&
                entry.evidence.blindTo.length > 0 &&
                entry.daysQuiet !== undefined &&
                entry.thresholdDays !== undefined,
            ),
          );
        },
      },
    ],
    handoff: {
      to: "S6.daily-message",
      state:
        "stalls ranked by days overdue, each carrying its last touch and evidence basis, plus the leads that cannot be measured",
    },
    escalation: [
      {
        when: "a live lead cannot be monitored or attributed",
        who: "Athena Huo",
        how: "the needsAttention list, which never reads as no action needed",
      },
      {
        when: "a threshold widens because a lead runs entirely by phone",
        who: "Athena Huo",
        how: "a crm_threshold_overrides row carrying the reason and its evidence",
      },
    ],
    measures: [
      { kpi: "s5.stalls_open", unit: "leads" },
      { kpi: "s5.leads_not_measurable", unit: "leads" },
    ],
    // No baseline, for the same reason S4.touch-scan has none. H-01 through
    // H-10 record ten manual tasks and none of them is "work out which leads
    // have gone quiet": the spreadsheet is a pull surface and that question was
    // only ever asked when somebody remembered to ask it. A number here would
    // be self-report, which the KPI rules name as never a data source.
  };
}
