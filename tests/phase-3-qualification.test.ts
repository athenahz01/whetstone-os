import { describe, expect, it } from "vitest";
import { loadAgentContext } from "../lib/core/context";
import {
  parseIcpCriteria,
  qualify,
  qualifyLead,
  readQualification,
} from "../lib/core/qualification";
import { scoreLead } from "../lib/core/scoring";
import type { Lead, QualificationVerdict } from "../lib/core/types";
import { stableLeadId } from "../lib/core/stable-id";

function inquiry(
  subject: string | undefined,
  text: string,
  raw: object = {},
): Lead {
  return {
    id: stableLeadId("wyzant", `${subject ?? "missing"}:${text}`),
    channel: "wyzant",
    author: "Sample learner",
    subject,
    text,
    location: "Online",
    url: "https://www.wyzant.com/tutor/jobs/sample",
    postedAt: "2026-08-26T12:00:00.000Z",
    raw: { source: "operator-owned-tutor-jobs-feed", ...raw },
  };
}

describe("Phase 3 qualification", () => {
  it("parses exactly the owner-approved subject list from ICP.md", async () => {
    const context = await loadAgentContext();
    expect(
      parseIcpCriteria(context.documents["ICP.md"]).approvedWyzantSubjects,
    ).toEqual([
      "College Counseling",
      "English",
      "Essay Writing",
      "SAT Reading",
    ]);
  });

  it.each([
    [
      "College Counseling",
      "Grade 11 student needs help planning a college list.",
    ],
    [
      "English",
      "Grade 9 student wants ongoing English tutoring this semester.",
    ],
    ["Essay Writing", "Grade 12 student wants feedback on an essay draft."],
    ["SAT Reading", "Grade 10 student needs a structured SAT Reading plan."],
  ])("marks approved subject %s icp_pass", async (subject, text) => {
    const context = await loadAgentContext();
    const verdict = readQualification(
      qualifyLead(inquiry(subject, text), context),
    );
    expect(verdict).toMatchObject({ verdict: "icp_pass" });
    expect(verdict?.evidence.length).toBeGreaterThan(0);
    expect(
      verdict?.evidence.every((item) => item.ref.startsWith("ICP.md#")),
    ).toBe(true);
  });

  it.each([
    "SAT Math",
    "ACT Math",
    "ACT English",
    "ACT Science",
    "ACT Reading",
  ])(
    "routes %s out_of_scope and makes it ineligible for drafting",
    async (subject) => {
      const context = await loadAgentContext();
      const lead = qualifyLead(
        inquiry(
          subject,
          `Grade 10 student needs help with ${subject} this semester.`,
        ),
        context,
      );
      expect(readQualification(lead)?.verdict).toBe("out_of_scope");
      expect(scoreLead(lead)).toBe(0);
    },
  );

  it("keeps online and remote approved work in scope under D-001", async () => {
    const context = await loadAgentContext();
    const lead = inquiry(
      "Essay Writing",
      "Grade 11 student wants online essay writing feedback this fall.",
    );
    lead.location = "Remote";
    expect(readQualification(qualifyLead(lead, context))?.verdict).toBe(
      "icp_pass",
    );
  });

  it("uses all four verdicts for their distinct guard clauses", async () => {
    const context = await loadAgentContext();
    const criteria = parseIcpCriteria(context.documents["ICP.md"]);
    const cases: Array<[Lead, QualificationVerdict]> = [
      [
        inquiry(
          "English",
          "Grade 10 student needs English tutoring this term.",
        ),
        "icp_pass",
      ],
      [
        inquiry("Essay Writing", "Grade 12 student needs essay writing help.", {
          grade: 12,
          deadline: "2026-09-10T12:00:00.000Z",
        }),
        "icp_fail",
      ],
      [
        inquiry("SAT Math", "Grade 10 student needs SAT Math tutoring."),
        "out_of_scope",
      ],
      [
        inquiry(
          "SAT Reading and ACT English",
          "Grade 10 student asks for SAT Reading and ACT English help.",
        ),
        "needs_human_review",
      ],
    ];
    expect(
      cases.map(([lead]) => qualify(lead, criteria, context.hash).verdict),
    ).toEqual(cases.map(([, verdict]) => verdict));
  });

  it("refuses prohibited channels and escalates an unproven source population", async () => {
    const context = await loadAgentContext();
    const criteria = parseIcpCriteria(context.documents["ICP.md"]);
    expect(
      qualify(
        {
          ...inquiry("English", "Grade 10 student needs English tutoring."),
          channel: "reddit",
        },
        criteria,
        context.hash,
      ).verdict,
    ).toBe("out_of_scope");
    expect(
      qualify(
        {
          ...inquiry("English", "Grade 10 student needs English tutoring."),
          channel: "unknown",
        },
        criteria,
        context.hash,
      ).verdict,
    ).toBe("needs_human_review");
  });
});
