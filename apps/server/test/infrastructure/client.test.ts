import { describe, expect, it } from "vitest";
import { KitchenOwlClient, KitchenOwlError } from "../../src/infrastructure/kitchenowl/client.js";

const cfg = { kitchenowlUrl: "https://ko.test", kitchenowlToken: "tok", householdId: 2 };
const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe("KitchenOwlClient", () => {
  it("sends the bearer token to the household recipe endpoint", async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), auth: new Headers(init?.headers).get("Authorization") };
      return new Response("[]");
    }) as typeof fetch;
    await new KitchenOwlClient(cfg, f).listRecipes();
    expect(seen).toEqual({ url: "https://ko.test/api/household/2/recipe", auth: "Bearer tok" });
  });

  it("parses recipes and ignores unknown fields", async () => {
    const recipes = await new KitchenOwlClient(
      cfg,
      json([{ id: 5, name: "A", time: 20, tags: [{ name: "x", id: 1 }], extra: true }]),
    ).listRecipes();
    expect(recipes[0]).toMatchObject({ id: 5, name: "A", time: 20, items: [] });
  });

  it("raises a KitchenOwlError with the status on HTTP errors", async () => {
    await expect(new KitchenOwlClient(cfg, json({}, 401)).listRecipes()).rejects.toMatchObject({ status: 401 });
    await expect(new KitchenOwlClient(cfg, json({}, 500)).listRecipes()).rejects.toBeInstanceOf(KitchenOwlError);
  });

  it("rejects an unexpected response shape", async () => {
    await expect(new KitchenOwlClient(cfg, json({ not: "a list" })).listRecipes()).rejects.toThrow(
      /unexpected recipe list/,
    );
  });
});
