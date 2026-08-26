import { describe, expect, it, vi } from "vitest";
import { ClaudeDraftService } from "../lib/core/drafting";
import { lead } from "./helpers";

describe("regression lock: Sonnet 5 temperature omission", () => {
  it("does not send a temperature field", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ content: [{ type: "text", text: "Draft" }] });
    const service = new ClaudeDraftService({
      client: { messages: { create } },
      profiles: {
        async getForTutor() {
          return {
            tutorId: "t1",
            tutorName: "Tutor",
            product: "Admissions",
            copy: "Bio",
            faq: {},
          };
        },
      },
      context: async () => ({
        hash: "hash",
        documents: {} as never,
        promptText: "Approved context",
      }),
    });
    await service.create(lead());
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).not.toHaveProperty("temperature");
  });
});
