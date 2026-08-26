import { readdir, readFile } from "node:fs/promises";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ApprovalLevel } from "../lib/core/workflow";

const ROOTS = ["lib", "app"];
const SOURCE = /\.tsx?$/;

/**
 * The third approval level covers money, contracts, pricing, commitments,
 * sensitive relationships, and anything sent to a current client family. The
 * plan says of it: "No code path exists. Not a flag that could be flipped - the
 * capability is absent. The audit checks this by grep, not by trust."
 *
 * So this is the grep, run as a test rather than by hand. It looks for the
 * token as a whole word, which is why REQUIRED and prepared do not trip it.
 */
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await sourceFiles(path)));
    else if (SOURCE.test(entry.name)) found.push(path);
  }
  return found;
}

describe("regression lock: the human-owned level has no implementation", () => {
  it("names the level nowhere in shipped source", async () => {
    const token = ["R", "E", "D"].join("");
    const pattern = new RegExp(`\\b${token}\\b`);
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of await sourceFiles(root)) {
        const body = await readFile(file, "utf8");
        body.split("\n").forEach((line, index) => {
          if (pattern.test(line)) offenders.push(`${file}:${index + 1}`);
        });
      }
    }

    expect(
      offenders,
      `the human-owned level is named in shipped source, so it is a flag that could be flipped: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("gives the approval type exactly two members, so a third cannot be constructed", async () => {
    expectTypeOf<ApprovalLevel>().toEqualTypeOf<"GREEN" | "YELLOW">();
    const source = await readFile(
      new URL("../lib/core/workflow.ts", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/export type ApprovalLevel = "GREEN" \| "YELLOW";/);
  });
});
