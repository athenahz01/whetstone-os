import type { CrmLeadView } from "../crm/actionable";
import type { SilenceClockResult } from "../crm/clock";
import {
  buildDailyDigest,
  digestLogLine,
  renderDigestBody,
  renderDigestSubject,
  type DailyDigest,
} from "../crm/digest";
import type { DigestAlertService } from "../core/alerts";
import type { StepContext, Workflow } from "../core/workflow";

export const S6_DAILY_MESSAGE_ID = "S6.daily-message";

export interface DailyMessageWorkflowOptions {
  clock: SilenceClockResult;
  leads: CrmLeadView[];
  alerts: DigestAlertService;
  maxItems?: number;
}

export interface DailyMessageBatch {
  digest: DailyDigest;
  subject: string;
  sent: boolean;
  /** Safe to log. References and counts, never a name. */
  logLine: string;
}

/**
 * One message a day, to the operator inbox and nowhere else.
 *
 * GREEN. It reports and it asks; it writes nothing to a lead record and it
 * drafts nothing. The YELLOW half of 7.5d is what a reply starts: "draft a
 * follow-up" hands to `S3.draft`, which runs the voice gate and produces
 * something a human still has to approve and paste.
 *
 * The alert sender takes no recipient. That is G1 restated for a component that
 * can send mail: this message names students who are minors, and the only
 * address it can ever reach is `ALERT_EMAIL_TO`.
 */
export function createDailyMessageWorkflow(
  options: DailyMessageWorkflowOptions,
): Workflow {
  return {
    id: S6_DAILY_MESSAGE_ID,
    goal: "Send one message a day naming at most five overdue leads, and say what was held back.",
    approvalLevel: "GREEN",
    owner: "Athena Huo",
    inputs: [
      {
        doc: "BASELINES.md",
        why: "The thresholds the overdue counts are measured against.",
      },
    ],
    tools: [
      {
        name: "table:crm_leads",
        access: "read",
        why: "The student name shown to the recipient, and the stage.",
      },
      {
        name: "alert-email",
        access: "write",
        why: "Send the message to the operator inbox. It takes no recipient.",
      },
    ],
    outputs: [{ kind: "daily-message", destination: "Ren" }],
    steps: [
      {
        id: "send-digest",
        async run(context: StepContext): Promise<DailyMessageBatch> {
          const digest = buildDailyDigest({
            result: options.clock,
            leads: options.leads,
            maxItems: options.maxItems,
          });
          const subject = renderDigestSubject(digest);
          const logLine = digestLogLine(digest);

          // Sent on every status, including "clear". A day with nothing to do
          // and a day where the job died look identical when the response to
          // both is no email, and that ambiguity is what the criteria forbid.
          let sent = false;
          if (options.alerts.isEnabled()) {
            await options.alerts.notifyDigest(
              subject,
              renderDigestBody(digest),
            );
            sent = true;
          }

          context.measure("s6.stalls_surfaced", digest.items.length, "leads");
          context.measure("s6.stalls_held_back", digest.heldBack, "leads");
          return { digest, subject, sent, logLine };
        },
      },
    ],
    qaGates: [
      {
        id: "a-truncated-list-never-reads-as-complete",
        describe:
          "The message states how many overdue leads it did not show, including when that is none.",
        check({ outputs }) {
          const batch = outputs.get("send-digest") as
            DailyMessageBatch | undefined;
          if (!batch) return false;
          const body = renderDigestBody(batch.digest);
          return (
            batch.digest.items.length + batch.digest.heldBack ===
              batch.digest.totalStalls &&
            /overdue and not shown|Nothing else is overdue and unshown/.test(
              body,
            )
          );
        },
      },
      {
        id: "no-name-outside-the-body",
        describe:
          "The subject and the log line carry references and counts, never a student name.",
        check({ outputs }) {
          const batch = outputs.get("send-digest") as
            DailyMessageBatch | undefined;
          if (!batch) return false;
          const names = batch.digest.items
            .map((item) => item.studentName)
            .filter(Boolean);
          return names.every(
            (name) =>
              !batch.subject.includes(name) && !batch.logLine.includes(name),
          );
        },
      },
      {
        id: "the-message-carries-no-draft",
        describe:
          "Nothing here renders a draft. A draft is what a reply starts, and it passes the voice gate first.",
        check({ outputs }) {
          const batch = outputs.get("send-digest") as
            DailyMessageBatch | undefined;
          if (!batch) return false;
          // The standing binding is that no surface renders a `drafts` row
          // until it has passed voiceLint. This surface renders none at all,
          // which is the only version of that rule with no way to get it wrong.
          return !("draftBody" in batch.digest) && !("drafts" in batch.digest);
        },
      },
    ],
    handoff: {
      to: "Ren",
      state:
        "at most five overdue leads, worst first in their own stage's terms, each with its evidence and four numbered replies",
    },
    escalation: [
      {
        when: "the clock read no mailbox",
        who: "Athena Huo",
        how: "the message says the run was degraded rather than reporting a clear day",
      },
      {
        when: "a lead cannot be measured at all",
        who: "Athena Huo",
        how: "the attention count in the message, which is never folded into the stall list",
      },
    ],
    measures: [
      { kpi: "s6.stalls_surfaced", unit: "leads" },
      { kpi: "s6.stalls_held_back", unit: "leads" },
    ],
    // No baseline. H-01 through H-10 record ten manual tasks and none of them
    // is "notice which leads have gone quiet and decide what to do", because
    // the spreadsheet never pushed that question at anybody. A number here
    // would be self-report, which the KPI rules name as never a data source.
  };
}
