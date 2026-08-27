-- Phase 7.5a: Whetstone's own lead records, merged from two forked sheets.
--
-- Row-level security is enabled in the same statement block that creates each
-- table, per docs/DEPLOYMENT.md. These rows carry student names, parent
-- contact details and the academic picture of minors, so they are the most
-- sensitive tables in the schema.

CREATE TABLE "crm_leads" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "identity" TEXT NOT NULL,
  "lead_ref" TEXT NOT NULL,
  "tab" TEXT NOT NULL,
  "values" JSONB NOT NULL,
  "status_raw" TEXT NOT NULL DEFAULT '',
  "status_value" TEXT,
  "status_unmapped" BOOLEAN NOT NULL DEFAULT false,
  "referrer_source_raw" TEXT NOT NULL DEFAULT '',
  "referrer_source_value" TEXT,
  "referrer_source_unmapped" BOOLEAN NOT NULL DEFAULT false,
  "sources" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_field_disputes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "identity" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "working_value" TEXT NOT NULL,
  "working_source" TEXT NOT NULL,
  "alternate_value" TEXT NOT NULL,
  "alternate_source" TEXT NOT NULL,
  "resolved_value" TEXT,
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "crm_field_disputes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_import_rejections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "source" TEXT NOT NULL,
  "tab" TEXT NOT NULL,
  "row_number" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_import_rejections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_import_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "rows_read" INTEGER NOT NULL,
  "rows_imported" INTEGER NOT NULL,
  "rows_rejected" INTEGER NOT NULL,
  "merged" INTEGER NOT NULL,
  "dashboard_only" INTEGER NOT NULL,
  "copy_only" INTEGER NOT NULL,
  "disputed_cells" INTEGER NOT NULL,
  "unmapped_cells" INTEGER NOT NULL,
  "balanced" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_import_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_field_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_import_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_import_runs ENABLE ROW LEVEL SECURITY;

-- A reconciliation that does not balance must not be storable as if it did.
ALTER TABLE public.crm_import_runs
  ADD CONSTRAINT crm_import_runs_balanced_totals
  CHECK (balanced = (rows_imported + rows_rejected = rows_read));

-- A resolution is a decision, so it carries who made it and when.
ALTER TABLE public.crm_field_disputes
  ADD CONSTRAINT crm_field_disputes_resolution_is_complete
  CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL AND resolved_value IS NULL)
    OR (resolved_at IS NOT NULL AND btrim(coalesce(resolved_by, '')) <> '' AND resolved_value IS NOT NULL)
  );

CREATE UNIQUE INDEX "crm_leads_identity_key" ON "crm_leads"("identity");
CREATE INDEX "crm_leads_org_id_lead_ref_idx" ON "crm_leads"("org_id", "lead_ref");
CREATE INDEX "crm_leads_org_id_status_value_idx" ON "crm_leads"("org_id", "status_value");
CREATE INDEX "crm_leads_org_id_status_unmapped_idx" ON "crm_leads"("org_id", "status_unmapped");
CREATE UNIQUE INDEX "crm_field_disputes_identity_field_key" ON "crm_field_disputes"("identity", "field");
CREATE INDEX "crm_field_disputes_org_id_resolved_at_idx" ON "crm_field_disputes"("org_id", "resolved_at");
CREATE UNIQUE INDEX "crm_import_rejections_source_tab_row_number_key" ON "crm_import_rejections"("source", "tab", "row_number");
CREATE INDEX "crm_import_rejections_org_id_created_at_idx" ON "crm_import_rejections"("org_id", "created_at");
CREATE INDEX "crm_import_runs_org_id_created_at_idx" ON "crm_import_runs"("org_id", "created_at");

ALTER TABLE "crm_field_disputes" ADD CONSTRAINT "crm_field_disputes_identity_fkey" FOREIGN KEY ("identity") REFERENCES "crm_leads"("identity") ON DELETE CASCADE ON UPDATE CASCADE;
