import { describe, expect, it, vi } from "vitest";
import { StubAlertService } from "../lib/core/alerts";
import { GrowthEngine } from "../lib/core/engine";
import { draftService, lead, MemoryLeadStore } from "./helpers";

describe("regression lock: adapter failure isolation", () => {
  it("continues with healthy adapters and logs no lead body", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const body = "private inquiry text that must not appear in logs";
    const engine = new GrowthEngine({
      adapters: [
        {
          name: "broken",
          poll: async () => {
            throw new Error(body);
          },
          send: async () => ({}),
        },
        {
          name: "healthy",
          poll: async () => [lead({ text: body })],
          send: async () => ({}),
        },
      ],
      store: new MemoryLeadStore(),
      drafts: draftService,
      alerts: new StubAlertService(),
    });
    expect((await engine.tick()).inserted).toBe(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain(body);
    error.mockRestore();
  });
});
