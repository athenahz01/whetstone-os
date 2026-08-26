import { describe, expect, it } from "vitest";
import { isOfficialWyzantUrl } from "../lib/adapters/wyzant";

describe("regression lock: every official Wyzant subdomain", () => {
  it("accepts root and arbitrary *.wyzant.com HTTPS hosts", () => {
    expect(isOfficialWyzantUrl("https://wyzant.com/tutor/jobs")).toBe(true);
    expect(isOfficialWyzantUrl("https://www.wyzant.com/tutor/jobs")).toBe(true);
    expect(
      isOfficialWyzantUrl("https://highered.wyzant.com/tutoring-job/1"),
    ).toBe(true);
  });

  it("rejects lookalikes and insecure URLs", () => {
    expect(isOfficialWyzantUrl("https://wyzant.com.evil.test/jobs")).toBe(
      false,
    );
    expect(isOfficialWyzantUrl("https://evilwyzant.com/jobs")).toBe(false);
    expect(isOfficialWyzantUrl("http://www.wyzant.com/jobs")).toBe(false);
  });
});
