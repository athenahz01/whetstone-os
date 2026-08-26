import { describe, expect, it } from "vitest";
import { StubAlertService } from "../lib/core/alerts";
import { GrowthEngine } from "../lib/core/engine";
import { stableLeadId } from "../lib/core/stable-id";
import { draftService, lead, MemoryLeadStore } from "./helpers";

describe("regression lock: stable deduplication", () => {
  it("derives stable IDs and never inserts the same native lead twice", async () => {
    expect(stableLeadId("WYZANT", " 42 ")).toBe(stableLeadId("wyzant", "42"));
    const item = lead({ id: stableLeadId("wyzant", "42") });
    const store = new MemoryLeadStore();
    const engine = new GrowthEngine({
      adapters: [
        {
          name: "test",
          poll: async () => [item],
          send: async () => ({ prefillUrl: item.url }),
        },
      ],
      store,
      drafts: draftService,
      alerts: new StubAlertService(),
    });
    expect((await engine.tick()).inserted).toBe(1);
    expect((await engine.tick()).deduped).toBe(1);
    expect(store.entries.size).toBe(1);
  });
});
