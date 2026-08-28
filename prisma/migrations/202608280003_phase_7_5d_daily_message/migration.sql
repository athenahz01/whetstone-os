-- Phase 7.5d: the daily message.
--
-- Row-level security is enabled in the same statement block that creates each
-- table, per docs/DEPLOYMENT.md.
--
-- Two tables, both of them records of a human decision. The message itself is
-- not stored: it is rendered from the clock on every run, and a stored copy of
-- a derived fact is the fork this phase exists to end.
--
-- Neither table has a column that could hold a student's name or any prose. A
-- reply is a lead reference, a term from a closed list, and a timestamp.

CREATE TABLE "crm_lead_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "identity" TEXT NOT NULL,
  "lead_ref" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "acted_at" TIMESTAMPTZ(3) NOT NULL,
  "digest_date" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_lead_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_snoozes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "identity" TEXT NOT NULL,
  "lead_ref" TEXT NOT NULL,
  "until" TIMESTAMPTZ(3) NOT NULL,
  "actor" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crm_snoozes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public.crm_lead_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_snoozes ENABLE ROW LEVEL SECURITY;

-- The four replies the message offers, and nothing else.
ALTER TABLE public.crm_lead_actions
  ADD CONSTRAINT crm_lead_actions_action_is_known
  CHECK (action IN ('draft', 'snooze', 'lost', 'spoke'));

-- A CRM write is attributed or it is not a write. This is the same rule the
-- approvals table carries, for the same reason.
ALTER TABLE public.crm_lead_actions
  ADD CONSTRAINT crm_lead_actions_is_attributed
  CHECK (btrim(actor) <> '');

ALTER TABLE public.crm_snoozes
  ADD CONSTRAINT crm_snoozes_is_attributed
  CHECK (btrim(actor) <> '');

-- A snooze that never lapses is a delete with better manners. The window has to
-- end after it began, so the lead comes back on its own.
ALTER TABLE public.crm_snoozes
  ADD CONSTRAINT crm_snoozes_returns_the_lead
  CHECK ("until" > created_at);

-- One reply per lead per action per day's message. Answering the same message
-- twice is one decision, not two.
CREATE UNIQUE INDEX "crm_lead_actions_identity_action_digest_date_key" ON "crm_lead_actions"("identity", "action", "digest_date");
CREATE INDEX "crm_lead_actions_org_id_acted_at_idx" ON "crm_lead_actions"("org_id", "acted_at");
CREATE UNIQUE INDEX "crm_snoozes_identity_until_key" ON "crm_snoozes"("identity", "until");
CREATE INDEX "crm_snoozes_org_id_until_idx" ON "crm_snoozes"("org_id", "until");

ALTER TABLE "crm_lead_actions" ADD CONSTRAINT "crm_lead_actions_identity_fkey" FOREIGN KEY ("identity") REFERENCES "crm_leads"("identity") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_snoozes" ADD CONSTRAINT "crm_snoozes_identity_fkey" FOREIGN KEY ("identity") REFERENCES "crm_leads"("identity") ON DELETE CASCADE ON UPDATE CASCADE;
