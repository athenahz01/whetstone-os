import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("scheduled Wyzant poll reliability", () => {
  it("uses the bounded 30-minute cadence in the pinned Playwright container", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/wyzant-poll.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain('cron: "0,30 0-3,11-23 * * *"');
    expect(workflow).toContain(
      "container: mcr.microsoft.com/playwright:v1.62.1",
    );
    expect(workflow).toContain("cache: pnpm");
    expect(workflow).not.toContain("uses: actions/cache@v4");
    expect(workflow).not.toContain("path: ~/.cache/ms-playwright");
    expect(workflow).not.toContain("playwright install");
    expect(workflow).toContain("sleep $((RANDOM % 121))");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain(
      "WYZANT_TARGET_SUBJECTS: College Counseling|English|Essay Writing|SAT Reading",
    );
    expect(workflow).toContain('WYZANT_INCLUDE_ONLINE_JOBS: "true"');
    expect(workflow).not.toMatch(/WYZANT_TARGET_SUBJECTS:.*ACT/);
    const dailyRuns = 2 * (4 + 13);
    expect(dailyRuns).toBe(34);
    expect(dailyRuns * 30).toBe(1_020);
  });

  it("polls both Wyzant surfaces and records a heartbeat only on full success", async () => {
    const source = await readFile(
      new URL("../ops/wyzant-poll.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("createWyzantMessagesAdapterFromEnv");
    expect(source).toContain("createWyzantAdapterFromEnv");
    expect(source).toContain("WYZANT_POLL_HEARTBEAT");
    expect(source).toContain("failedAdapters.length === 0");
  });
});
