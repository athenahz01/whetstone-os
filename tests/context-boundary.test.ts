import { describe, expect, it } from "vitest";
import { loadAgentContext } from "../lib/core/context";

describe("agent context boundary", () => {
  it("loads exactly the four approved documents and produces a stable hash", async () => {
    const first = await loadAgentContext();
    const second = await loadAgentContext();
    expect(Object.keys(first.documents).sort()).toEqual([
      "BASELINES.md",
      "FACTS.md",
      "ICP.md",
      "VOICE.md",
    ]);
    expect(first.promptText).not.toContain("AUTOMATION-MAP.md");
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.hash).toBe(second.hash);
  });
});
