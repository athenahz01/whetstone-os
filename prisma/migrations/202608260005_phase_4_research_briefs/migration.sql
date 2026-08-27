-- Phase 4: durable, review-ready prospect research briefs.
--
-- The JSON columns preserve the citation graph as one immutable review
-- artifact. Claims are still validated in code before insertion. These
-- structural checks prevent a second write path from storing a brief with no
-- unknowns, the wrong hook count, or an invalid confidence value.

CREATE TABLE "research_briefs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "run_id" UUID NOT NULL,
  "lead_id" TEXT NOT NULL,
  "why_fit" JSONB NOT NULL,
  "hooks" JSONB NOT NULL,
  "disqualifier" JSONB NOT NULL,
  "unknowns" JSONB NOT NULL,
  "confidence" DECIMAL(4,3) NOT NULL,
  "evidence" JSONB NOT NULL,
  "exclusions" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ready_for_review',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "research_briefs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_briefs_hook_count" CHECK (jsonb_array_length("hooks") = 3),
  CONSTRAINT "research_briefs_unknowns_required" CHECK (jsonb_array_length("unknowns") > 0),
  CONSTRAINT "research_briefs_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

ALTER TABLE public.research_briefs ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX "research_briefs_run_id_key" ON "research_briefs"("run_id");
CREATE INDEX "research_briefs_org_id_lead_id_created_at_idx" ON "research_briefs"("org_id", "lead_id", "created_at");
CREATE INDEX "research_briefs_org_id_status_created_at_idx" ON "research_briefs"("org_id", "status", "created_at");

ALTER TABLE "research_briefs" ADD CONSTRAINT "research_briefs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_briefs" ADD CONSTRAINT "research_briefs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
