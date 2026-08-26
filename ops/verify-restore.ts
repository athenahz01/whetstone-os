import { PrismaClient } from "@prisma/client";

const restoreUrl = process.env.RESTORE_DATABASE_URL?.trim();
if (!restoreUrl) throw new Error("RESTORE_DATABASE_URL is required.");

const expected = [
  "tutors",
  "leads",
  "drafts",
  "outcomes",
  "profiles",
  "metrics_daily",
];
const client = new PrismaClient({ datasourceUrl: restoreUrl });
try {
  const rows = await client.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'org_id'
      AND table_name IN ('tutors', 'leads', 'drafts', 'outcomes', 'profiles', 'metrics_daily')
  `;
  const present = new Set(rows.map((row) => row.table_name));
  const missing = expected.filter((table) => !present.has(table));
  if (missing.length)
    throw new Error(
      `Restore verification failed; missing tenant tables: ${missing.join(", ")}`,
    );
  console.info("[restore:verified]", { tenantTables: present.size });
} finally {
  await client.$disconnect();
}
