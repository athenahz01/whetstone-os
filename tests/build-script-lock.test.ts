import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Regression lock: the build generates the Prisma client before it compiles.
 *
 * Vercel restored a cached `node_modules`, so `pnpm install` finished in 1.1
 * seconds as a no-op, so Prisma's postinstall never re-ran, so the generated
 * client stayed frozen from before Phase 2's models existed. Twenty type
 * errors, every deployment failing for fourteen hours, and every local
 * `pnpm build` passing the entire time because the local client was current.
 *
 * Production served twenty-hour-old code while the workflow engine, the
 * research brief and the drafting all sat in the repository and none of them
 * ran. Nothing we were looking at could see it: the tests were green, the
 * types were green, the build was green, and the only symptom was in a log
 * nobody reads on a success.
 *
 * `prisma generate` in the build script is what makes the generated client a
 * function of the schema in the commit rather than of whatever the installer
 * happened to leave on the machine. It is not redundant with the postinstall
 * hook, because a cache hit skips the hook and does not skip the build. If you
 * are here to simplify this script, that is the thing you would be removing.
 */
async function buildScript(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts?: Record<string, string> };
  return manifest.scripts?.build ?? "";
}

describe("regression lock: the build generates the Prisma client first", () => {
  it("runs prisma generate before next build", async () => {
    const build = await buildScript();
    const generate = build.indexOf("prisma generate");
    const compile = build.indexOf("next build");

    expect(
      generate,
      "the build script no longer runs `prisma generate`, so a cached node_modules will compile against a stale client",
    ).toBeGreaterThanOrEqual(0);
    expect(
      compile,
      "the build script no longer runs `next build`",
    ).toBeGreaterThanOrEqual(0);
    expect(
      generate,
      "`prisma generate` must run before `next build`, or the compile still sees the stale client",
    ).toBeLessThan(compile);
  });

  it("keeps the two steps chained so a failed generate stops the build", async () => {
    const build = await buildScript();
    // `&&` rather than `;`, so a generate that fails does not hand a stale
    // client to a compile that then succeeds.
    expect(build).toMatch(/prisma generate\s*&&\s*next build/);
  });

  it("still generates on install as well, since the two cover different misses", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(manifest.scripts?.["prisma:generate"]).toBe("prisma generate");
  });
});
