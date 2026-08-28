import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  test: {
    environment: "node",
    // The committed suite is `tests/`. `.audit/` is auditor scratch - probes
    // written to break a clause and watch the gate name it - and its
    // assertions encode questions, not requirements. Collecting it made
    // `pnpm verify` fail on a probe file that was never meant to be a
    // regression test, and left an executor unable to tell a real finding from
    // a stale question.
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
