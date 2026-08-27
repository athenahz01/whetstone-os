import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const MIGRATIONS = new URL("../prisma/migrations/", import.meta.url);

/**
 * Regression lock: every table in `public` is denied to the anon key.
 *
 * Prisma creates tables with no row-level security, Supabase grants the anon
 * role access to everything in `public`, and PostgREST publishes it. The anon
 * key is `NEXT_PUBLIC_`, so a table that ships without RLS is world-readable
 * from the JavaScript of every page. A live probe found exactly that.
 *
 * This reads the migration set rather than a database, so it fails in CI before
 * a migration reaches a project, and it discovers tables instead of listing
 * them: a table added without RLS fails here by name.
 */

/**
 * Tables that exist in `public` without any migration creating them, so
 * discovery alone can never see them. Naming them is the whole point: the first
 * version of this lock scanned CREATE TABLE only, and `_prisma_migrations` was
 * therefore invisible to it while being live-readable by anon.
 *
 * Prisma creates `_prisma_migrations` itself before applying anything in the
 * migration directory. Anything else that arrives the same way belongs on this
 * list the day it arrives.
 */
const TABLES_CREATED_OUTSIDE_MIGRATIONS = ["_prisma_migrations"];

async function readMigrationSql(): Promise<string> {
  const entries = await readdir(MIGRATIONS, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readFile(new URL(`${entry.name}/migration.sql`, MIGRATIONS), "utf8"),
      ),
  );
  return files.join("\n");
}

function normalize(identifier: string): string {
  return identifier
    .replace(/"/g, "")
    .replace(/^public\./i, "")
    .toLowerCase();
}

function matchAll(sql: string, pattern: RegExp): string[] {
  return [...sql.matchAll(pattern)].map((match) => normalize(match[1]));
}

const IDENTIFIER = String.raw`((?:public\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)`;

function createdTables(sql: string): string[] {
  return matchAll(
    sql,
    new RegExp(
      String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENTIFIER}`,
      "gi",
    ),
  );
}

function securedTables(sql: string): Set<string> {
  return new Set(
    matchAll(
      sql,
      new RegExp(
        String.raw`ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${IDENTIFIER}\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`,
        "gi",
      ),
    ),
  );
}

describe("regression lock: anon cannot read any table in public", () => {
  it("enables row level security on every table any migration creates", async () => {
    const sql = await readMigrationSql();
    const created = createdTables(sql);
    const secured = securedTables(sql);

    expect(created.length).toBeGreaterThan(0);
    const unsecured = created.filter((table) => !secured.has(table));
    expect(
      unsecured,
      `these tables ship without row level security, so the anon key can read them: ${unsecured.join(", ")}`,
    ).toEqual([]);
  });

  it("enables it on the tables no migration creates, which discovery cannot see", async () => {
    const sql = await readMigrationSql();
    const secured = securedTables(sql);
    const created = new Set(createdTables(sql));

    // Naming it is the assertion. Emptying the list would otherwise make every
    // check below vacuous and the lock would go quiet rather than fail.
    expect(TABLES_CREATED_OUTSIDE_MIGRATIONS).toContain("_prisma_migrations");

    const missing = TABLES_CREATED_OUTSIDE_MIGRATIONS.filter(
      (table) => !secured.has(table),
    );
    expect(
      missing,
      `these tables exist in public without a CREATE TABLE in the migration set, so only this list can require their RLS: ${missing.join(", ")}`,
    ).toEqual([]);

    // If one of these ever does get created by a migration it is no longer in
    // this category, and leaving it here would hide a discovery gap behind a
    // hard-coded name.
    for (const table of TABLES_CREATED_OUTSIDE_MIGRATIONS) {
      expect(
        created.has(table),
        `${table} is now created by a migration, so remove it from TABLES_CREATED_OUTSIDE_MIGRATIONS and let discovery cover it`,
      ).toBe(false);
    }
  });

  it("guards the statement so a fresh database does not fail on it", async () => {
    const sql = await readMigrationSql();
    for (const table of TABLES_CREATED_OUTSIDE_MIGRATIONS) {
      expect(
        sql,
        `${table} is not this repository's to create, so its ALTER must tolerate its absence`,
      ).toMatch(
        new RegExp(
          String.raw`ALTER\s+TABLE\s+IF\s+EXISTS\s+(?:public\.)?"?${table}"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY`,
          "i",
        ),
      );
    }
  });

  it("grants the anon role no policy back into those tables", async () => {
    const sql = await readMigrationSql();
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/GRANT\s[\s\S]*?\sTO\s+anon\b/i);
  });
});
