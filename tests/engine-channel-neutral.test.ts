import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("engine channel neutrality", () => {
  it("contains no channel-specific branch or adapter import", async () => {
    const source = await readFile(
      new URL("../lib/core/engine.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/wyzant|email|telegram/i);
    expect(source).not.toMatch(/lib\/adapters|\.\.\/adapters/);
  });
});
