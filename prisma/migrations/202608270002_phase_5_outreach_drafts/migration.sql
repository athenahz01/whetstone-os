-- Phase 5: prepared outreach, and the marker KPI #5 counts.
--
-- Row-level security is enabled in the same statement block that creates the
-- table, per docs/DEPLOYMENT.md. An outreach draft is a reply written to a
-- named family, so it is at least as sensitive as leads.

ALTER TABLE "leads" ADD COLUMN "icp_pass_ready_at" TIMESTAMPTZ(3);

CREATE INDEX "leads_org_id_icp_pass_ready_at_idx" ON "leads"("org_id", "icp_pass_ready_at");

CREATE TABLE "outreach_drafts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "run_id" UUID NOT NULL,
  "lead_id" TEXT NOT NULL,
  "tutor_id" TEXT NOT NULL,
  "variant" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "opening" TEXT NOT NULL,
  "substance" TEXT NOT NULL,
  "plan" TEXT NOT NULL,
  "disqualifier" TEXT NOT NULL,
  "ask" TEXT NOT NULL,
  "citations" JSONB NOT NULL,
  "context_hash" TEXT NOT NULL,
  "rendered_body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ready_for_review',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "outreach_drafts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.outreach_drafts ENABLE ROW LEVEL SECURITY;

-- The disqualifier and the ask are not optional. VOICE.md requires an honest
-- limitation and a single next step, and a blank one must not be storable.
ALTER TABLE public.outreach_drafts
  ADD CONSTRAINT outreach_drafts_disqualifier_not_blank CHECK (btrim(disqualifier) <> '');
ALTER TABLE public.outreach_drafts
  ADD CONSTRAINT outreach_drafts_ask_is_question CHECK (btrim(ask) LIKE '%?');

CREATE UNIQUE INDEX "outreach_drafts_run_id_key" ON "outreach_drafts"("run_id");
CREATE INDEX "outreach_drafts_org_id_lead_id_created_at_idx" ON "outreach_drafts"("org_id", "lead_id", "created_at");
CREATE INDEX "outreach_drafts_org_id_status_created_at_idx" ON "outreach_drafts"("org_id", "status", "created_at");
CREATE INDEX "outreach_drafts_org_id_variant_created_at_idx" ON "outreach_drafts"("org_id", "variant", "created_at");

ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
