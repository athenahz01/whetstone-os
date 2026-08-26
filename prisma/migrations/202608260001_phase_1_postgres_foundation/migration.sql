CREATE TABLE "tutors" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "tutors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "leads" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "channel" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "subject" TEXT,
  "location" TEXT,
  "url" TEXT NOT NULL,
  "posted_at" TIMESTAMPTZ(3) NOT NULL,
  "raw" JSONB,
  "score" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "first_responded_at" TIMESTAMPTZ(3),
  "alert_reserved_at" TIMESTAMPTZ(3),
  "alerted_at" TIMESTAMPTZ(3),
  "prefill_approved_at" TIMESTAMPTZ(3),
  "sent_at" TIMESTAMPTZ(3),
  "sent_by" TEXT,
  "tutor_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "drafts" (
  "id" SERIAL NOT NULL,
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "lead_id" TEXT NOT NULL,
  "tutor_id" TEXT NOT NULL,
  "variant" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "approved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outcomes" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "lead_id" TEXT NOT NULL,
  "tutor_id" TEXT,
  "status" TEXT NOT NULL,
  "revenue_cents" INTEGER NOT NULL DEFAULT 0,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outcomes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "profiles" (
  "id" TEXT NOT NULL,
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "tutor_id" TEXT NOT NULL,
  "short_bio" TEXT NOT NULL,
  "rate_cents" INTEGER NOT NULL,
  "faq" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "metrics_daily" (
  "id" SERIAL NOT NULL,
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "date" DATE NOT NULL,
  "tutor_id" TEXT NOT NULL,
  "tutor_name" TEXT NOT NULL,
  "product" TEXT NOT NULL,
  "opportunities" INTEGER NOT NULL DEFAULT 0,
  "replies" INTEGER NOT NULL DEFAULT 0,
  "calls_booked" INTEGER NOT NULL DEFAULT 0,
  "conversions" INTEGER NOT NULL DEFAULT 0,
  "response_time_total_minutes" INTEGER NOT NULL DEFAULT 0,
  "responded_lead_count" INTEGER NOT NULL DEFAULT 0,
  "revenue_cents" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL DEFAULT 'engine',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "metrics_daily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "poll_heartbeats" (
  "id" UUID NOT NULL,
  "org_id" UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
  "source" TEXT NOT NULL,
  "last_run_at" TIMESTAMPTZ(3),
  "stale_alerted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "poll_heartbeats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tutors_org_id_slug_key" ON "tutors"("org_id", "slug");
CREATE INDEX "tutors_org_id_active_name_idx" ON "tutors"("org_id", "active", "name");
CREATE INDEX "leads_org_id_channel_posted_at_idx" ON "leads"("org_id", "channel", "posted_at");
CREATE INDEX "leads_org_id_tutor_id_posted_at_idx" ON "leads"("org_id", "tutor_id", "posted_at");
CREATE INDEX "leads_org_id_alert_reserved_at_score_idx" ON "leads"("org_id", "alert_reserved_at", "score");
CREATE INDEX "leads_org_id_alerted_at_alert_reserved_at_idx" ON "leads"("org_id", "alerted_at", "alert_reserved_at");
CREATE INDEX "leads_org_id_sent_at_posted_at_idx" ON "leads"("org_id", "sent_at", "posted_at");
CREATE INDEX "drafts_org_id_lead_id_idx" ON "drafts"("org_id", "lead_id");
CREATE UNIQUE INDEX "outcomes_org_id_lead_id_key" ON "outcomes"("org_id", "lead_id");
CREATE INDEX "outcomes_org_id_occurred_at_status_idx" ON "outcomes"("org_id", "occurred_at", "status");
CREATE INDEX "outcomes_org_id_tutor_id_occurred_at_idx" ON "outcomes"("org_id", "tutor_id", "occurred_at");
CREATE UNIQUE INDEX "profiles_tutor_id_key" ON "profiles"("tutor_id");
CREATE INDEX "profiles_org_id_idx" ON "profiles"("org_id");
CREATE UNIQUE INDEX "metrics_daily_org_id_date_tutor_id_key" ON "metrics_daily"("org_id", "date", "tutor_id");
CREATE INDEX "metrics_daily_org_id_date_tutor_id_idx" ON "metrics_daily"("org_id", "date", "tutor_id");
CREATE INDEX "metrics_daily_org_id_source_date_idx" ON "metrics_daily"("org_id", "source", "date");
CREATE UNIQUE INDEX "poll_heartbeats_org_id_source_key" ON "poll_heartbeats"("org_id", "source");
CREATE INDEX "poll_heartbeats_org_id_last_run_at_idx" ON "poll_heartbeats"("org_id", "last_run_at");

ALTER TABLE "leads" ADD CONSTRAINT "leads_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "tutors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "tutors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "tutors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "tutors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
