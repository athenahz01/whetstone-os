import pg from "pg"; import fs from "node:fs"; import {createHash} from "node:crypto";
const TABLES = ["tutors","leads","drafts","outcomes","profiles","metrics_daily","poll_heartbeats",
  "runs","run_steps","approvals","measurements","exceptions","system_flags","research_briefs"];
const url = fs.readFileSync(process.env.HOME+"/u6/target.url","utf8").trim();
const c = new pg.Client({connectionString:url, ssl:{rejectUnauthorized:false}});
await c.connect();
const out = {};
for (const t of TABLES) {
  const {rows} = await c.query(`select * from public."${t}"`);
  const norm = rows.map(r=>JSON.stringify(r, Object.keys(r).sort())).sort();
  out[t] = { rows: rows.length, hash: createHash("sha256").update(norm.join("\n")).digest("hex").slice(0,16) };
}
fs.writeFileSync(process.argv[2], JSON.stringify(out,null,2));
console.log(process.argv[2], "written");
await c.end();
