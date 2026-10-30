import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("requires a token and strips a trailing slash", () => {
    expect(() => loadConfig({})).toThrow(/KITCHENOWL_TOKEN/);
    const c = loadConfig({ KITCHENOWL_URL: "https://example.org/", KITCHENOWL_TOKEN: "x" });
    expect(c).toMatchObject({ kitchenowlUrl: "https://example.org", householdId: 2 });
  });

  it("never puts the token into an error message", () => {
    try {
      loadConfig({ KITCHENOWL_URL: "not a url", KITCHENOWL_TOKEN: "secret-token" });
    } catch (e) {
      expect(String(e)).not.toContain("secret-token");
    }
  });
});
