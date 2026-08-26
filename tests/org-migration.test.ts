import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const tables = [
  "tutors",
  "leads",
  "drafts",
  "outcomes",
  "profiles",
  "metrics_daily",
];

const archivedColumns: Record<string, string[]> = {
  tutors: [
    "id",
    "name",
    "slug",
    "product",
    "active",
    "created_at",
    "updated_at",
  ],
  leads: [
    "id",
    "channel",
    "author",
    "text",
    "subject",
    "location",
    "url",
    "posted_at",
    "raw",
    "score",
    "status",
    "first_responded_at",
    "alert_reserved_at",
    "alerted_at",
    "prefill_approved_at",
    "sent_at",
    "sent_by",
    "tutor_id",
    "created_at",
  ],
  drafts: [
    "id",
    "lead_id",
    "tutor_id",
    "variant",
    "body",
    "approved_at",
    "created_at",
    "updated_at",
  ],
  outcomes: [
    "id",
    "lead_id",
    "tutor_id",
    "status",
    "revenue_cents",
    "occurred_at",
    "created_at",
  ],
  profiles: [
    "id",
    "tutor_id",
    "short_bio",
    "rate_cents",
    "faq",
    "created_at",
    "updated_at",
  ],
  metrics_daily: [
    "id",
    "date",
    "tutor_id",
    "tutor_name",
    "product",
    "opportunities",
    "replies",
    "calls_booked",
    "conversions",
    "response_time_total_minutes",
    "responded_lead_count",
    "revenue_cents",
    "source",
    "created_at",
    "updated_at",
  ],
};

describe("Postgres tenant migration", () => {
  it("creates every operational table with a non-null default org_id", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/202608260001_phase_1_postgres_foundation/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const table of tables) {
      const statement = migration.match(
        new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`),
      )?.[0];
      expect(statement, table).toBeTruthy();
      expect(statement, table).toContain('"org_id" UUID NOT NULL DEFAULT');
      for (const column of archivedColumns[table]) {
        expect(statement, `${table}.${column}`).toContain(`"${column}"`);
      }
    }
    expect(migration.toLowerCase()).not.toContain("sqlite");
  });
});
