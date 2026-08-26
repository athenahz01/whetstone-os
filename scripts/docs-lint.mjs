#!/usr/bin/env node
// Phase 0 ground-truth validator.
// Makes the Phase 0 acceptance checks repeatable instead of a one-time manual pass.
// Run: pnpm docs:lint   (or: node scripts/docs-lint.mjs)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DOCS = "docs";
const REQUIRED = [
  "ICP.md",
  "VOICE.md",
  "FACTS.md",
  "BASELINES.md",
  "AUTOMATION-MAP.md",
];

const APPROVED_SUBJECTS = [
  "College Counseling",
  "English",
  "Essay Writing",
  "SAT Reading",
];

const MUST_BE_OUT_OF_SCOPE = ["SAT Math", "ACT Math", "ACT English", "ACT Science", "ACT Reading"];

const VERDICTS = ["icp_pass", "icp_fail", "out_of_scope", "needs_human_review"];

const POSITIONING_BANS = [
  "consultation",
  "ikigai",
  "Common App",
  "capstone",
  "first come first served",
  "you'll get a spot",
];

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);

const read = (name) => readFileSync(join(DOCS, name), "utf8");

// 1. The five documents exist and are non-empty.
for (const name of REQUIRED) {
  const path = join(DOCS, name);
  if (!existsSync(path)) {
    fail(`missing required document: ${path}`);
    continue;
  }
  if (read(name).trim().length === 0) fail(`document is empty: ${path}`);
}
if (failures.length) {
  report();
}

const icp = read("ICP.md");
const voice = read("VOICE.md");
const facts = read("FACTS.md");
const baselines = read("BASELINES.md");
const map = read("AUTOMATION-MAP.md");

// 2. ICP parses into a structured criteria object the qualifier can consume.
const criteria = parseIcp(icp);

if (criteria.approvedSubjects.length !== APPROVED_SUBJECTS.length) {
  fail(
    `ICP approved subjects: expected ${APPROVED_SUBJECTS.length}, parsed ${criteria.approvedSubjects.length} (${criteria.approvedSubjects.join(", ")})`
  );
}
for (const s of APPROVED_SUBJECTS) {
  if (!criteria.approvedSubjects.includes(s)) fail(`ICP approved subjects missing: ${s}`);
}
for (const s of criteria.approvedSubjects) {
  if (!APPROVED_SUBJECTS.includes(s)) fail(`ICP approved subjects contains unapproved entry: ${s}`);
}
for (const s of MUST_BE_OUT_OF_SCOPE) {
  if (!criteria.outOfScopeText.includes(s.toLowerCase())) {
    fail(`ICP does not place out of scope: ${s}`);
  }
}
for (const v of VERDICTS) {
  if (!icp.includes(v)) fail(`ICP missing verdict label: ${v}`);
}
if (!criteria.gradeRange) fail("ICP does not state a grade range for the pilot");
if (!/too_early/.test(icp)) fail("ICP missing the too-early (grade 5 to 7) stage rule");
if (!/too_late/.test(icp)) fail("ICP missing the too-late (senior near deadline) disqualifier");

// 3. VOICE carries Whetstone's own positioning bans.
for (const ban of POSITIONING_BANS) {
  if (!voice.toLowerCase().includes(ban.toLowerCase())) {
    fail(`VOICE missing positioning ban: ${ban}`);
  }
}
if (!/no promised outcomes/i.test(voice)) fail("VOICE missing the no-promised-outcomes rule");

// 4. Every VERIFIED fact row carries an ISO verification date.
const ISO = /\d{4}-\d{2}-\d{2}/;
let verifiedRows = 0;
let blockedRows = 0;
for (const line of facts.split("\n")) {
  if (!line.trim().startsWith("|")) continue;
  const cells = line.split("|").map((c) => c.trim());
  if (cells.some((c) => c === "VERIFIED")) {
    verifiedRows += 1;
    if (!ISO.test(line)) fail(`FACTS VERIFIED row has no ISO date: ${cells[1]}`);
  }
  if (cells.some((c) => c === "BLOCKED")) blockedRows += 1;
}
if (verifiedRows === 0) fail("FACTS has no VERIFIED rows; the register is unusable");
if (!/Register verified: \d{4}-\d{2}-\d{2}/.test(facts)) {
  fail("FACTS is missing a top-level register verification date");
}

// 5. The docs obey the voice rule they set: no em dash, no en dash.
for (const [name, body] of [
  ["ICP.md", icp],
  ["VOICE.md", voice],
  ["FACTS.md", facts],
  ["BASELINES.md", baselines],
  ["AUTOMATION-MAP.md", map],
]) {
  body.split("\n").forEach((line, i) => {
    if (line.includes("—") || line.includes("–")) {
      fail(`${name}:${i + 1} contains an em dash or en dash, which VOICE.md bans`);
    }
  });
}

// 6. The minor-edit threshold is frozen and stated.
if (!/minor_edit\s*=/.test(baselines)) fail("BASELINES does not state the minor_edit formula");
if (!/required_new_research/.test(baselines)) {
  fail("BASELINES minor-edit rule is missing the required_new_research clause");
}

// 7. AUTOMATION-MAP answers Cole's four questions.
if (!/Cole's four questions/.test(map)) {
  fail("AUTOMATION-MAP does not answer Cole's four questions per row");
}
for (const q of ["1. Human work replaced", "2. How often", "3. Value per occurrence", "4. How we know"]) {
  if (!map.includes(q)) fail(`AUTOMATION-MAP missing four-questions column: ${q}`);
}
if (!/Do not load this file into agent prompts/.test(map)) {
  fail("AUTOMATION-MAP is missing its human-only marker");
}

// 8. No runtime code yet. Phase 0 is documents only.
notes.push(`FACTS register: ${verifiedRows} verified rows, ${blockedRows} blocked rows`);
notes.push(`ICP: ${criteria.approvedSubjects.length} approved subjects, grade range ${criteria.gradeRange}`);

report();

function parseIcp(text) {
  const approved = [];
  const approvedBlock = text.split(/Cole's approved Wyzant subjects[^\n]*\n/)[1] || "";
  for (const line of approvedBlock.split("\n")) {
    const m = line.match(/^-\s+(.*\S)\s*$/);
    if (m) approved.push(m[1]);
    else if (approved.length && line.trim() === "") break;
  }
  const oosBlock = (text.split(/### Explicitly out of scope/)[1] || "").split(/^###\s/m)[0] || "";
  const grade = (text.match(/grades?\s+(\d+)\s+(?:through|to)\s+(\d+)/i) || [])[0] || null;
  return {
    approvedSubjects: approved,
    outOfScopeText: oosBlock.toLowerCase(),
    gradeRange: grade,
  };
}

function report() {
  for (const n of notes) console.log(`note: ${n}`);
  if (failures.length === 0) {
    console.log(`docs:lint PASS - ${REQUIRED.length}/${REQUIRED.length} documents valid`);
    process.exit(0);
  }
  console.error(`docs:lint FAIL - ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
