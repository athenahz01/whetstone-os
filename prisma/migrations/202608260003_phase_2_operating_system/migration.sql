-- Phase 2: the KPI substrate and the approval machinery.
--
-- Every table here enables row-level security in the same statement block that
-- creates it, per the rule in docs/DEPLOYMENT.md. approvals holds human
-- decisions and exceptions can hold message fragments, so neither is less
-- sensitive than leads. tests/rls-coverage.test.ts refuses this migration
-- otherwise.

CREATE TABLE "runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "workflow_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMPTZ(3),
  "human_minutes" INTEGER NOT NULL DEFAULT 0,
  "baseline_minutes" INTEGER NOT NULL DEFAULT 0,
  "cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "human_rescue" BOOLEAN NOT NULL DEFAULT false,
  "rescue_note" TEXT,
  CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "run_steps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "run_id" UUID NOT NULL,
  "step" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "input_hash" TEXT,
  "output_ref" TEXT,
  "error" TEXT,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMPTZ(3),
  CONSTRAINT "run_steps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "approvals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "run_id" UUID NOT NULL,
  "level" TEXT NOT NULL,
  "artifact_kind" TEXT NOT NULL,
  "approved_by" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "edit_distance" DECIMAL(6,5) NOT NULL DEFAULT 0,
  "required_new_research" BOOLEAN NOT NULL DEFAULT false,
  "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "measurements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "run_id" UUID NOT NULL,
  "kpi" TEXT NOT NULL,
  "value" DECIMAL(18,6) NOT NULL,
  "unit" TEXT NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "measurements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "exceptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "run_id" UUID,
  "workflow_id" TEXT,
  "kind" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "exceptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "system_flags" (
  "key" TEXT NOT NULL,
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "note" TEXT,
  "updated_by" TEXT,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "system_flags_pkey" PRIMARY KEY ("key")
);

ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_flags ENABLE ROW LEVEL SECURITY;

CREATE INDEX "runs_org_id_started_at_workflow_id_idx" ON "runs"("org_id", "started_at", "workflow_id");
CREATE INDEX "runs_org_id_started_at_status_human_rescue_idx" ON "runs"("org_id", "started_at", "status", "human_rescue");
CREATE INDEX "runs_org_id_workflow_id_started_at_idx" ON "runs"("org_id", "workflow_id", "started_at");
CREATE INDEX "run_steps_org_id_run_id_started_at_idx" ON "run_steps"("org_id", "run_id", "started_at");
CREATE INDEX "approvals_org_id_decided_at_decision_idx" ON "approvals"("org_id", "decided_at", "decision");
CREATE INDEX "approvals_org_id_run_id_decided_at_idx" ON "approvals"("org_id", "run_id", "decided_at");
CREATE INDEX "measurements_org_id_kpi_recorded_at_idx" ON "measurements"("org_id", "kpi", "recorded_at");
CREATE INDEX "exceptions_org_id_created_at_resolved_at_idx" ON "exceptions"("org_id", "created_at", "resolved_at");
CREATE INDEX "exceptions_org_id_kind_created_at_idx" ON "exceptions"("org_id", "kind", "created_at");
CREATE INDEX "system_flags_org_id_key_idx" ON "system_flags"("org_id", "key");

ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
