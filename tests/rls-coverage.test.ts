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
 * them: a Phase 2 table added without RLS fails here by name.
 */
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

describe("regression lock: anon cannot read any table in public", () => {
  it("enables row level security on every table any migration creates", async () => {
    const sql = await readMigrationSql();
    const created = matchAll(
      sql,
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)/gi,
    );
    const secured = new Set(
      matchAll(
        sql,
        /ALTER\s+TABLE\s+(?:ONLY\s+)?((?:public\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi,
      ),
    );

    expect(created.length).toBeGreaterThan(0);
    const unsecured = created.filter((table) => !secured.has(table));
    expect(
      unsecured,
      `these tables ship without row level security, so the anon key can read them: ${unsecured.join(", ")}`,
    ).toEqual([]);
  });

  it("grants the anon role no policy back into those tables", async () => {
    const sql = await readMigrationSql();
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/GRANT\s[\s\S]*?\sTO\s+anon\b/i);
  });
});
