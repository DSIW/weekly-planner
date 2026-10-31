import { describe, expect, it } from "vitest";
import { loadConfig, loadServerConfig } from "../src/main/config.js";

describe("loadConfig", () => {
  it("requires a URL and a token and strips a trailing slash", () => {
    expect(() => loadConfig({})).toThrow(/KITCHENOWL_TOKEN/);
    expect(() => loadConfig({ KITCHENOWL_TOKEN: "x" })).toThrow(/KITCHENOWL_URL/);
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

describe("loadServerConfig", () => {
  const base = { KITCHENOWL_URL: "https://example.org", KITCHENOWL_TOKEN: "x", SESSION_SECRET: "s".repeat(32) };

  it("applies the defaults for the deployment under /plan", () => {
    expect(loadServerConfig(base)).toMatchObject({
      port: 3000,
      basePath: "/plan",
      cookieSecure: true,
      trustProxy: true,
      householdId: 2,
      databasePath: "data/planner.sqlite",
      timezone: "Europe/Berlin",
    });
  });

  it("requires a session secret of at least 32 characters", () => {
    expect(() => loadServerConfig({ ...base, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
    expect(() => loadServerConfig({ ...base, SESSION_SECRET: undefined })).toThrow(/SESSION_SECRET/);
  });

  it("accepts the root as base path and rejects malformed ones", () => {
    expect(loadServerConfig({ ...base, BASE_PATH: "" }).basePath).toBe("");
    expect(() => loadServerConfig({ ...base, BASE_PATH: "plan/" })).toThrow(/BASE_PATH/);
  });

  it("never puts a secret into an error message", () => {
    try {
      loadServerConfig({ ...base, SESSION_SECRET: "tiny", KITCHENOWL_TOKEN: "secret-token" });
    } catch (e) {
      expect(String(e)).not.toContain("secret-token");
      expect(String(e)).not.toContain("tiny");
    }
  });
});
