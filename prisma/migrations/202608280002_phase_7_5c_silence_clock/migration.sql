-- Phase 7.5c: the silence clock.
--
-- Row-level security is enabled in the same statement block that creates the
-- table, per docs/DEPLOYMENT.md.
--
-- Only one table. The stall list is computed from `crm_leads` and `crm_touches`
-- on every run and is deliberately not stored: a stored list would be a second
-- copy of a derived fact, and the fork this phase exists to end was two copies
-- of a derived fact. What does need storing is a threshold that has moved away
-- from its stage default, because section 7 forbids a silent tuning.

CREATE TABLE "crm_threshold_overrides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "identity" TEXT NOT NULL,
  "lead_ref" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "base_days" INTEGER NOT NULL,
  "adjusted_days" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "asserted_run_length" INTEGER NOT NULL,
  "cleared_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "crm_threshold_overrides_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.crm_threshold_overrides ENABLE ROW LEVEL SECURITY;

-- The reason vocabulary, pinned here as well as in the code that writes it.
ALTER TABLE public.crm_threshold_overrides
  ADD CONSTRAINT crm_threshold_overrides_reason_is_known
  CHECK (reason IN ('asserted_only_run'));

-- An override that does not change anything is not a record of a change.
ALTER TABLE public.crm_threshold_overrides
  ADD CONSTRAINT crm_threshold_overrides_actually_widens
  CHECK (adjusted_days > base_days AND base_days > 0);

-- A widening carries its evidence. A tuning with no reason behind it is the
-- silent tuning section 7 names.
ALTER TABLE public.crm_threshold_overrides
  ADD CONSTRAINT crm_threshold_overrides_carries_its_evidence
  CHECK (asserted_run_length > 0);

-- The stages the clock watches. Complete, Lost, NQ and Inactive are not quiet,
-- they are finished, so a threshold for one of them is a mistake not a setting.
ALTER TABLE public.crm_threshold_overrides
  ADD CONSTRAINT crm_threshold_overrides_stage_is_clocked
  CHECK (stage IN ('Negotiate', 'Active', 'Engage', 'Prospect', 'Cold'));

CREATE UNIQUE INDEX "crm_threshold_overrides_identity_stage_key" ON "crm_threshold_overrides"("identity", "stage");
CREATE INDEX "crm_threshold_overrides_org_id_cleared_at_idx" ON "crm_threshold_overrides"("org_id", "cleared_at");

ALTER TABLE "crm_threshold_overrides" ADD CONSTRAINT "crm_threshold_overrides_identity_fkey" FOREIGN KEY ("identity") REFERENCES "crm_leads"("identity") ON DELETE CASCADE ON UPDATE CASCADE;
