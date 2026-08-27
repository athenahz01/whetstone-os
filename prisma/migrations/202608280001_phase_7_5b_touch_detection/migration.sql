-- Phase 7.5b: touch detection from email and calendar.
--
-- Row-level security is enabled in the same statement block that creates each
-- table, per docs/DEPLOYMENT.md. These rows say who Whetstone has been talking
-- to and when, which is as sensitive as the lead records themselves.
--
-- There is deliberately no column for a message body or a subject line. The
-- subject is stored as a digest and the provider's own id is kept as the way
-- back to the original, so a student's name has nowhere in this schema to land.

CREATE TABLE "crm_touches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "identity" TEXT NOT NULL,
  "lead_ref" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "source_ref" TEXT NOT NULL,
  "subject_ref" TEXT,
  "matched_field" TEXT,
  "asserted_by" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_touches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_touch_unmatched" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "source_ref" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "candidate_leads" INTEGER NOT NULL DEFAULT 0,
  "scanned_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_touch_unmatched_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_touch_scans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "provider" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ(3) NOT NULL,
  "window_end" TIMESTAMPTZ(3) NOT NULL,
  "status" TEXT NOT NULL,
  "failure_reason" TEXT,
  "candidates_read" INTEGER NOT NULL,
  "matched" INTEGER NOT NULL,
  "unmatched" INTEGER NOT NULL,
  "ambiguous" INTEGER NOT NULL,
  "unaddressed" INTEGER NOT NULL,
  "balanced" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_touch_scans_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.crm_touches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_touch_unmatched ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_touch_scans ENABLE ROW LEVEL SECURITY;

-- The vocabularies, enforced here as well as in the code that writes them.
ALTER TABLE public.crm_touches
  ADD CONSTRAINT crm_touches_basis_is_known
  CHECK (basis IN ('email', 'calendar', 'asserted'));

ALTER TABLE public.crm_touches
  ADD CONSTRAINT crm_touches_kind_is_known
  CHECK (kind IN ('email', 'meeting'));

ALTER TABLE public.crm_touches
  ADD CONSTRAINT crm_touches_direction_is_known
  CHECK (direction IN ('inbound', 'outbound'));

ALTER TABLE public.crm_touches
  ADD CONSTRAINT crm_touches_state_is_known
  CHECK (state IN ('occurred', 'scheduled'));

-- Only a calendar can know about contact that has not happened yet. A
-- scheduled email touch would be a send, and nothing here sends.
ALTER TABLE public.crm_touches
  ADD CONSTRAINT crm_touches_only_calendar_is_scheduled
  CHECK (state <> 'scheduled' OR basis = 'calendar');

-- A row can always say whether a human or a mailbox produced it.
ALTER TABLE public.crm_touches
  ADD CONSTRAINT crm_touches_asserted_names_a_human
  CHECK (
    (basis = 'asserted' AND btrim(coalesce(asserted_by, '')) <> '')
    OR (basis <> 'asserted' AND asserted_by IS NULL)
  );

-- An asserted touch came from a person answering a question, so there is no
-- message behind it and nothing to correlate.
ALTER TABLE public.crm_touches
  ADD CONSTRAINT crm_touches_asserted_has_no_subject
  CHECK (basis <> 'asserted' OR subject_ref IS NULL);

-- The subject reference is a digest, never the subject. Pinning the shape here
-- means a writer that starts storing prose fails at the database rather than
-- passing every test and shipping a student's name.
ALTER TABLE public.crm_touches
  ADD CONSTRAINT crm_touches_subject_ref_is_a_digest
  CHECK (subject_ref IS NULL OR subject_ref ~ '^subj_[0-9a-f]{16}$');

ALTER TABLE public.crm_touches
  ADD CONSTRAINT crm_touches_source_ref_is_present
  CHECK (btrim(source_ref) <> '');

ALTER TABLE public.crm_touch_unmatched
  ADD CONSTRAINT crm_touch_unmatched_reason_is_known
  CHECK (reason IN ('no_matching_lead', 'ambiguous_lead', 'no_participants'));

ALTER TABLE public.crm_touch_scans
  ADD CONSTRAINT crm_touch_scans_status_is_known
  CHECK (status IN ('completed', 'failed'));

-- A failed scan says why, from the closed list, and a completed one does not
-- carry a reason it did not have. This is what keeps a quiet day and a broken
-- job from looking alike.
ALTER TABLE public.crm_touch_scans
  ADD CONSTRAINT crm_touch_scans_failure_is_complete
  CHECK (
    (status = 'completed' AND failure_reason IS NULL)
    OR (status = 'failed' AND failure_reason IN (
      'provider_unreachable',
      'provider_rejected_credentials',
      'provider_rate_limited',
      'provider_timed_out',
      'malformed_provider_response'
    ))
  );

-- Every candidate read left as a match or as a recorded non-match.
ALTER TABLE public.crm_touch_scans
  ADD CONSTRAINT crm_touch_scans_balanced_totals
  CHECK (balanced = (matched + unmatched + ambiguous + unaddressed = candidates_read));

ALTER TABLE public.crm_touch_scans
  ADD CONSTRAINT crm_touch_scans_window_is_ordered
  CHECK (window_end >= window_start);

CREATE UNIQUE INDEX "crm_touches_identity_basis_source_ref_key" ON "crm_touches"("identity", "basis", "source_ref");
CREATE INDEX "crm_touches_org_id_identity_occurred_at_idx" ON "crm_touches"("org_id", "identity", "occurred_at");
CREATE INDEX "crm_touches_org_id_state_occurred_at_idx" ON "crm_touches"("org_id", "state", "occurred_at");
CREATE INDEX "crm_touches_org_id_kind_occurred_at_idx" ON "crm_touches"("org_id", "kind", "occurred_at");
CREATE UNIQUE INDEX "crm_touch_unmatched_basis_source_ref_scanned_at_key" ON "crm_touch_unmatched"("basis", "source_ref", "scanned_at");
CREATE INDEX "crm_touch_unmatched_org_id_scanned_at_idx" ON "crm_touch_unmatched"("org_id", "scanned_at");
CREATE INDEX "crm_touch_scans_org_id_provider_created_at_idx" ON "crm_touch_scans"("org_id", "provider", "created_at");
CREATE INDEX "crm_touch_scans_org_id_status_created_at_idx" ON "crm_touch_scans"("org_id", "status", "created_at");

ALTER TABLE "crm_touches" ADD CONSTRAINT "crm_touches_identity_fkey" FOREIGN KEY ("identity") REFERENCES "crm_leads"("identity") ON DELETE CASCADE ON UPDATE CASCADE;
