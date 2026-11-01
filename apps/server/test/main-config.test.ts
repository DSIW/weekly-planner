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

  it("takes KitchenOwl's public address for links: none by default, a URL or / on a shared host", () => {
    expect(loadServerConfig(base).kitchenowlPublicUrl).toBeNull();
    expect(loadServerConfig({ ...base, KITCHENOWL_PUBLIC_URL: "https://ko.example.org/" }).kitchenowlPublicUrl).toBe(
      "https://ko.example.org",
    );
    expect(loadServerConfig({ ...base, KITCHENOWL_PUBLIC_URL: "/" }).kitchenowlPublicUrl).toBe("");
    expect(() => loadServerConfig({ ...base, KITCHENOWL_PUBLIC_URL: "ko.example.org" })).toThrow(
      /KITCHENOWL_PUBLIC_URL/,
    );
  });

  it("sets up the language model for recipe import only with a key: OpenRouter by default, any compatible API", () => {
    expect(loadServerConfig(base).llm).toEqual({ apiKey: null, model: "", baseUrl: "https://openrouter.ai/api/v1" });
    expect(
      loadServerConfig({ ...base, LLM_API_KEY: "k", LLM_MODEL: "vendor/model", LLM_BASE_URL: "http://llm.local/v1/" })
        .llm,
    ).toEqual({ apiKey: "k", model: "vendor/model", baseUrl: "http://llm.local/v1" });
    expect(() => loadServerConfig({ ...base, LLM_BASE_URL: "not a url" })).toThrow(/LLM_BASE_URL/);
  });

  it("never puts the language model's key into an error message", () => {
    try {
      loadServerConfig({ ...base, LLM_API_KEY: "sk-secret-key", LLM_BASE_URL: "not a url" });
    } catch (e) {
      expect(String(e)).not.toContain("sk-secret-key");
    }
  });

  it("tells the push services who to contact, as a mailto: address or an https URL", () => {
    expect(loadServerConfig(base).vapidSubject).toBe("mailto:planner@example.org");
    expect(loadServerConfig({ ...base, VAPID_SUBJECT: "mailto:me@home.example" }).vapidSubject).toBe(
      "mailto:me@home.example",
    );
    expect(loadServerConfig({ ...base, VAPID_SUBJECT: "https://home.example" }).vapidSubject).toBe(
      "https://home.example",
    );
    expect(() => loadServerConfig({ ...base, VAPID_SUBJECT: "me@home.example" })).toThrow(/VAPID_SUBJECT/);
    expect(() => loadServerConfig({ ...base, VAPID_SUBJECT: "http://home.example" })).toThrow(/VAPID_SUBJECT/);
  });

  it("refuses a VAPID_SUBJECT that only contains a contact, or a mailto: without an address", () => {
    for (const subject of [
      "mailto:nobody",
      "xmailto:me@home.example",
      "https://home.example and more",
      "see https://home.example",
    ]) {
      expect(() => loadServerConfig({ ...base, VAPID_SUBJECT: subject })).toThrow(/VAPID_SUBJECT/);
    }
  });

  it("fills the shopping list with id 2 unless SHOPPING_LIST_ID says otherwise", () => {
    expect(loadServerConfig(base).shoppingListId).toBe(2);
    expect(loadServerConfig({ ...base, SHOPPING_LIST_ID: "3" }).shoppingListId).toBe(3);
    expect(() => loadServerConfig({ ...base, SHOPPING_LIST_ID: "REWE" })).toThrow(/SHOPPING_LIST_ID/);
    expect(() => loadServerConfig({ ...base, SHOPPING_LIST_ID: "0" })).toThrow(/SHOPPING_LIST_ID/);
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
