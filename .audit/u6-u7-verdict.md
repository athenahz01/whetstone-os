# AUDIT VERDICT - U6 restore drill, U7 anon lockout, and commit `682bbb4`

**U6: CLOSED.** The drill found a real defect, it is fixed, and the fix is verified.
**U7: CLOSED, both halves.** Read and write, against a live database holding 226 rows.
**Commit `682bbb4`: PASS.**

The live Wyzant poll is no longer gated on U6.

---

## U6 - the restore drill found something

I built the backup, seeded a scratch Supabase project with 226 rows across all fourteen tables - jsonb, unicode, emoji, embedded apostrophes and newlines, nulls, foreign keys, numerics, timestamps - dumped it, wiped it, restored it, and compared table by table.

```
table                rows(before/after)  hash
tutors              6/6                 MATCH
leads               40/40               MATCH
drafts              20/20               MATCH
outcomes            12/12               MATCH
profiles            6/6                 MATCH
metrics_daily       15/15               MATCH
poll_heartbeats     4/4                 MATCH
runs                25/25               MATCH
run_steps           30/30               MATCH
approvals           18/18               MATCH
measurements        22/22               MATCH
exceptions          14/14               MATCH
system_flags        5/5                 MATCH
research_briefs     9/9                 MATCH

RESTORE VERIFIED: every table byte-identical
```

Then I checked the thing a row count cannot see. My first sequence check said "ok" and it was **my test that was wrong**: I had wiped with `TRUNCATE ... CASCADE`, which leaves sequences where they were, so the restored database still had a correct sequence for reasons that would not exist in a real recovery. I re-ran it against `TRUNCATE ... RESTART IDENTITY`, which is what a database freshly built by `prisma migrate deploy` actually looks like:

```
fresh drafts: sequence last_value=1 is_called=false
restore: OK
drafts:        sequence=1  max(id)=20   <-- SEQUENCE BEHIND DATA
metrics_daily: sequence=1  max(id)=15   <-- SEQUENCE BEHIND DATA

first app INSERT after recovery: FAILED -> duplicate key value violates unique constraint "drafts_pkey"
```

**The restore succeeded and the application was still broken.** Every row was back, every hash matched, and the first write after recovery died on a primary key collision - and it would have kept dying on every subsequent write until someone diagnosed it, during the exact hour when nobody has time to diagnose anything.

This is the reason the drill exists. No amount of assuming would have produced that line.

Fixed: the dump now emits `setval` for every serial column, positioned from the data it just wrote. Re-run against a simulated fresh database:

```
fresh drafts: sequence last_value=1 is_called=false
restore: OK
drafts:        sequence=21 max(id)=20   ok
metrics_daily: sequence=16 max(id)=15   ok

first app INSERT after recovery: OK
```

All fourteen tables still byte-identical afterwards.

### What you now have

A real backup of production sits **outside the repository** at `C:\AA_Whetstone\whetstone-backups\whetstone-os-2026-08-27.sql`. It holds the current 2 rows and the sequence positions. Outside the repo deliberately: it will contain families' names and inquiry text, and `.audit/` is untracked but not ignored, so one `git add -A` would have committed it.

The working scripts are in `.audit/dump.mjs`, `.audit/restore.mjs` and `.audit/fingerprint.mjs`. They are auditor tooling, not shipped code - see the follow-ups.

### Design note

The schema half is not in the backup, on purpose. It is fully reproducible from `prisma/migrations`, which is version-controlled and CI-tested, and you proved it twice today by deploying it to two different databases. So recovery is: `pnpm prisma:migrate:deploy` for the schema, then this file for the data. That is a smaller and more honest artifact than a schema blob that can drift from the migration set.

---

## U7 - closed on both halves

**Read side**, live production, public anon key: all fifteen tables in `public` return `[]` with `content-range: */0`, including `_prisma_migrations` after the fix. Not an empty-database illusion - `leads` and `poll_heartbeats` each hold a row the anon key cannot see.

**Write side**, run in-database as the `anon` role against the scratch project holding all 226 rows, every statement rolled back:

```
table                SELECT   UPDATE   DELETE   INSERT
tutors               0 rows   0 rows   0 rows   denied
leads                0 rows   0 rows   0 rows   denied
...  (all 14, identical) ...
_prisma_migrations   0 rows   -        0 rows   denied

U7 write side: PASS - anon can read, update, delete and insert nothing
```

`INSERT` is refused with `42501`, which is row-level security, not a constraint. `UPDATE` and `DELETE` affect zero of 226 rows. This is the same check PostgREST performs, done at the source.

---

## Commit `682bbb4` - PASS

`engine.ts` md5 `9f95451a2e60cd143afa1d46618b34e0` unchanged. **185 tests, 29 files, 0 skipped**, reproduced.

The migration is correct, and I have unusually good evidence for it: **it applied cleanly to a genuinely fresh database during my U6 drill**, in sequence with the other five, before I knew it existed. That is the fresh-database path proven in production conditions rather than argued.

I ran three of my own negative probes on the new lock, independent of your six:

| Probe | Result |
|---|---|
| Point the `ALTER` at an already-secured table (`public.leads`) | caught, 2 failures |
| Empty the `TABLES_CREATED_OUTSIDE_MIGRATIONS` list | caught, 1 failure |
| Delete the whole migration directory, moved outside the tree | caught, 2 failures |

The second one is the one that matters, and it is the assertion you added after your own first sweep missed it. Without it the lock would go quiet instead of failing, which is the worst failure mode a lock has.

**On your P1 correction** - reporting that your probe harness moved the migration to a sibling path still inside `prisma/migrations/`, so `readdir` kept finding it and the probe lied: that was the right call and it is the standard I want held. A probe harness that lies is exactly a fake that agrees with itself. Say so every time.

**On `docs/DEPLOYMENT.md`** - your flag is correct and I am adopting it. The probe list there names the seven Phase 1 tables and has not moved since; it is missing the six Phase 2 tables, `research_briefs`, and `_prisma_migrations`. A stale list is how this bug survived. It is in the follow-ups below.

---

## Follow-ups for the executor

1. **Productionize the backup.** Move `.audit/dump.mjs` and `.audit/restore.mjs` into `ops/` as `ops/backup.mjs` and `ops/restore.mjs`. They need `pg` as a dependency, which the repo does not have yet. Requirements the drill established:
   - The dump emits `setval` for **every** serial column, positioned from the restored data. Test this by asserting the generated SQL contains one `setval` per sequence found in `information_schema`, so adding a serial column later cannot silently drop out.
   - A restore test that runs against `TRUNCATE ... RESTART IDENTITY`, not plain `TRUNCATE`. Plain truncate hides the entire defect class - it hid it from me for one round.
   - Never write a backup inside the repository tree.

2. **Fix `docs/DEPLOYMENT.md`.** The live probe list must enumerate every table the migration set secures plus every name in `TABLES_CREATED_OUTSIDE_MIGRATIONS`, so the live check and the CI lock cover the same set by construction rather than by someone remembering.

3. **A backup taken once is not a backup.** U6 closes on the drill, but before real inquiries start flowing this needs a schedule - weekly at minimum, and the restore re-verified whenever the schema changes. That belongs to Phase 11.

---

## Standing gates

- **U6: closed** 2026-08-27, by an actual restore that found and fixed a defect.
- **U7: closed** 2026-08-27, read and write, against a live deployment.
- **The live Wyzant poll is unblocked.** Turn it on when you want real inquiries flowing.
- **Still open:** the S2 source filter must cover spelled-out numerals before any live `ResearchSourceProvider` ships. That line is in `CLAUDE.md`.

Phase 5 - S3 outreach preparation - is open with nothing blocking it.
