// Data-only logical backup. Read-only against the source database.
// The schema half is already reproducible from prisma/migrations, so this
// backs up what cannot be re-derived: the rows.
import { writeFileSync } from "node:fs";
import pg from "pg";

const TABLES = ["tutors","leads","drafts","outcomes","profiles","metrics_daily",
  "poll_heartbeats","runs","run_steps","approvals","measurements","exceptions",
  "system_flags","research_briefs"];

const url = process.argv[2];
const out = process.argv[3];
if (!url || !out) { console.error("usage: node dump.mjs <db-url> <out.sql>"); process.exit(1); }

function lit(v, type) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Buffer.isBuffer(v)) return `'\\x${v.toString("hex")}'`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const parts = [
  "-- Whetstone OS data-only backup",
  `-- taken: ${new Date().toISOString()}`,
  "-- restore into a database whose schema was built by: pnpm prisma:migrate:deploy",
  "BEGIN;",
];
const counts = {};
for (const t of TABLES) {
  const { rows, fields } = await client.query(`SELECT * FROM public."${t}"`);
  counts[t] = rows.length;
  parts.push(`\n-- ${t}: ${rows.length} rows`);
  if (!rows.length) continue;
  const cols = fields.map((f) => `"${f.name}"`).join(", ");
  for (const r of rows) {
    const vals = fields.map((f) => lit(r[f.name])).join(", ");
    parts.push(`INSERT INTO public."${t}" (${cols}) VALUES (${vals});`);
  }
}
// Sequences. Without these a restore into a fresh database leaves every serial
// at its starting value, and the first write after recovery collides on the
// primary key. Found by the U6 drill on 2026-08-27.
const seqs = await client.query(`
  select c.relname as table_name, a.attname as column_name,
         pg_get_serial_sequence('public.'||c.relname, a.attname) as seq
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
   where n.nspname = 'public' and c.relkind = 'r'
     and pg_get_serial_sequence('public.'||c.relname, a.attname) is not null`);
parts.push("\n-- sequence positions");
for (const s of seqs.rows) {
  parts.push(`SELECT setval('${s.seq}', (SELECT COALESCE(MAX("${s.column_name}"), 0) + 1 FROM public."${s.table_name}"), false);`);
}
parts.push("\nCOMMIT;");
writeFileSync(out, parts.join("\n") + "\n", "utf8");
await client.end();

console.log("table                rows");
for (const t of TABLES) console.log(`${t.padEnd(20)} ${counts[t]}`);
console.log(`\ntotal rows: ${Object.values(counts).reduce((a,b)=>a+b,0)}`);
console.log(`written: ${out}`);
