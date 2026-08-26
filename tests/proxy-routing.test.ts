import { describe, expect, it } from "vitest";
import { config } from "../proxy";

describe("authentication proxy routing", () => {
  it("excludes shared-secret API routes from Supabase session refresh", () => {
    expect(config.matcher).toEqual([
      "/((?!api|_next/static|_next/image|favicon.ico).*)",
    ]);
  });
});
