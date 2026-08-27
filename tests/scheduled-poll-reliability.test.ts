import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("scheduled Wyzant poll reliability", () => {
  it("uses a 15-minute jittered cadence with dependency and browser caches", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/wyzant-poll.yml", import.meta.url),
      "utf8",
    );
    expect(workflow).toContain('cron: "*/15 * * * *"');
    expect(workflow).toContain("cache: pnpm");
    expect(workflow).toContain("uses: actions/cache@v4");
    expect(workflow).toContain("path: ~/.cache/ms-playwright");
    expect(workflow).toContain("sleep $((RANDOM % 121))");
    expect(workflow).toContain(
      "WYZANT_TARGET_SUBJECTS: College Counseling|English|Essay Writing|SAT Reading",
    );
    expect(workflow).toContain('WYZANT_INCLUDE_ONLINE_JOBS: "true"');
    expect(workflow).not.toMatch(/WYZANT_TARGET_SUBJECTS:.*ACT/);
    expect(workflow).not.toContain('cron: "*/5 * * * *"');
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
