import pg from "pg"; import fs from "node:fs";
const url = fs.readFileSync(process.env.HOME+"/u6/target.url","utf8").trim();
const sql = fs.readFileSync(process.argv[2],"utf8");
const c = new pg.Client({connectionString:url, ssl:{rejectUnauthorized:false}});
await c.connect();
try { await c.query(sql); console.log("restore: OK"); }
catch (e) { console.log("restore: FAILED ->", e.message); process.exitCode = 1; }
await c.end();
