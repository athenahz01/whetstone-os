import { describe, expect, it, vi } from "vitest";
import { createEmailAdapterFromEnv } from "../lib/adapters/email";
import { EmailAlertService } from "../lib/core/alerts";
import {
  ClaudeDraftService,
  DraftingUnavailableError,
} from "../lib/core/drafting";
import { lead } from "./helpers";

describe("optional service degradation", () => {
  it("warns once and disables alert email when credentials are absent", async () => {
    const warn = vi.fn();
    const alerts = new EmailAlertService({ warn });
    await alerts.notify(lead(), 100);
    await alerts.notify(lead(), 100);
    expect(alerts.isEnabled()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("fails drafting explicitly without an API key and does not stop configuration", async () => {
    const service = new ClaudeDraftService({
      profiles: {
        async getForTutor() {
          return null;
        },
      },
    });
    await expect(service.create(lead())).rejects.toBeInstanceOf(
      DraftingUnavailableError,
    );
  });

  it("leaves email ingestion disabled when credentials are incomplete", () => {
    expect(createEmailAdapterFromEnv()).toBeNull();
  });
});
