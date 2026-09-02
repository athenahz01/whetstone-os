// U7 live probe. Read-only. Run from the repo root:  node .audit/rls-probe.mjs
// Asks the live database three questions per table:
//   is RLS enabled, how many policies exist, and how many rows are really there.
// A table with rows > 0 that the anon key reads as empty is RLS doing its job.
import { PrismaClient } from "@prisma/client";

const TABLES = [
  "tutors", "leads", "drafts", "outcomes", "profiles", "metrics_daily",
  "poll_heartbeats", "runs", "run_steps", "approvals", "measurements",
  "exceptions", "system_flags", "research_briefs",
];

const prisma = new PrismaClient();
let bad = 0;

console.log("table                rls    policies  rows");
console.log("-------------------------------------------");
for (const t of TABLES) {
  const [meta] = await prisma.$queryRawUnsafe(
    `select c.relrowsecurity as rls,
            (select count(*)::int from pg_policies p
              where p.schemaname = 'public' and p.tablename = $1) as policies
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = $1`,
    t,
  );
  const [count] = await prisma.$queryRawUnsafe(
    `select count(*)::int as n from public."${t}"`,
  );
  const ok = meta?.rls === true && Number(meta.policies) === 0;
  if (!ok) bad += 1;
  console.log(
    `${t.padEnd(20)} ${String(meta?.rls).padEnd(6)} ${String(meta?.policies).padEnd(9)} ${count.n}${ok ? "" : "   <-- PROBLEM"}`,
  );
}

const [extra] = await prisma.$queryRawUnsafe(
  `select count(*)::int as n from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname <> ALL($1::text[])`,
  TABLES,
);
console.log("-------------------------------------------");
console.log(`unlisted tables in public: ${extra.n}`);
if (extra.n > 0) {
  const rows = await prisma.$queryRawUnsafe(
    `select c.relname, c.relrowsecurity as rls from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname <> ALL($1::text[])`,
    TABLES,
  );
  for (const r of rows) {
    console.log(`  ${r.relname}  rls=${r.rls}${r.rls ? "" : "   <-- PROBLEM"}`);
    if (!r.rls) bad += 1;
  }
}
console.log(bad === 0 ? "\nU7 read side: PASS" : `\nU7 read side: FAIL (${bad})`);
await prisma.$disconnect();
