export interface Lead {
  id: string;
  channel: string;
  author: string;
  text: string;
  subject?: string;
  location?: string;
  url: string;
  postedAt: string;
  tutorId?: string;
  /** Source-declared urgency, interpreted generically by the scoring layer. */
  priority?: "high";
  raw?: unknown;
}

export type QualificationVerdict =
  "icp_pass" | "icp_fail" | "out_of_scope" | "needs_human_review";

export interface QualificationEvidence {
  ref: string;
  observation: string;
}

export interface QualificationResult {
  verdict: QualificationVerdict;
  rationale: string;
  evidence: QualificationEvidence[];
  confidence: number;
  contextHash: string;
}

export interface Draft {
  leadId: string;
  tutorId: string;
  variant: string;
  body: string;
}

export interface Outcome {
  leadId: string;
  status: "replied" | "call_booked" | "converted";
  revenueCents?: number;
  recordedAt: string;
}

export interface ChannelAdapter {
  name: string;
  /** Watch the source, return NORMALIZED leads. Read-only, own account. */
  poll(): Promise<Lead[]>;
  /** Record + prefill an approved reply. MUST NOT auto-submit to the platform. */
  send(lead: Lead, approvedMessage: string): Promise<{ prefillUrl?: string }>;
  /** Optional non-fatal poll failures for the workflow exception ledger. */
  drainExceptions?(): AdapterException[];
}

export interface AdapterException {
  kind: string;
  severity: "warning" | "critical";
  message: string;
}
