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

  it("reads the dates on the planner from the midnight-UTC day of each entry, from a date on", async () => {
    const day = (iso: string) => ({ cooking_date: Date.parse(`${iso}T00:00:00Z`) });
    let url = "";
    const f = (async (u: string | URL | Request) => {
      url = String(u);
      return new Response(JSON.stringify([day("2026-11-03"), day("2026-11-05"), { cooking_date: null }, {}]));
    }) as typeof fetch;
    const dates = await new KitchenOwlClient(cfg, f).plannedDatesFrom("2026-11-04");
    expect(url).toBe("https://ko.test/api/household/2/planner");
    expect([...dates]).toEqual(["2026-11-05"]);
    await expect(new KitchenOwlClient(cfg, json({ no: "list" })).plannedDatesFrom("2026-11-04")).rejects.toBeInstanceOf(
      KitchenOwlError,
    );
  });

  it("fetches the icon font from the web app's assets, and gives null when it is not there", async () => {
    let url = "";
    const f = (async (u: string | URL | Request) => {
      url = String(u);
      return new Response(new Uint8Array([0, 1, 0, 0]));
    }) as typeof fetch;
    const font = await new KitchenOwlClient(cfg, f).fetchItemIcons();
    expect(url).toBe("https://ko.test/assets/fonts/Items.ttf");
    expect(font?.contentType).toBe("font/ttf");
    expect([...(font?.data ?? [])]).toEqual([0, 1, 0, 0]);
    expect(await new KitchenOwlClient(cfg, json({}, 404)).fetchItemIcons()).toBeNull();
  });

  it("treats a recipe line that does not say it is optional as needed", async () => {
    const recipes = await new KitchenOwlClient(
      cfg,
      json([{ id: 5, name: "A", items: [{ id: 1, name: "Salz", description: "1 TL" }] }]),
    ).listRecipes();
    expect(recipes[0]?.items[0]).toMatchObject({ optional: false });
  });

  it("rejects an unexpected response shape", async () => {
    await expect(new KitchenOwlClient(cfg, json({ not: "a list" })).listRecipes()).rejects.toThrow(
      /unexpected recipe list/,
    );
  });

  describe("fetchPhoto", () => {
    it("asks the upload endpoint with the service token and returns type and bytes", async () => {
      let seen: { url: string; auth: string | null } | undefined;
      const f = (async (url: string | URL | Request, init?: RequestInit) => {
        seen = { url: String(url), auth: new Headers(init?.headers).get("Authorization") };
        return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
      }) as typeof fetch;
      const photo = await new KitchenOwlClient(cfg, f).fetchPhoto("a b.jpg");
      expect(seen).toEqual({ url: "https://ko.test/api/upload/a%20b.jpg", auth: "Bearer tok" });
      expect(photo).toEqual({ contentType: "image/jpeg", data: new Uint8Array([1, 2, 3]) });
    });

    it("passes the content type through and falls back to a generic one", async () => {
      const png = (async () =>
        new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } })) as typeof fetch;
      expect((await new KitchenOwlClient(cfg, png).fetchPhoto("a.png"))?.contentType).toBe("image/png");
      const bare = (async () => new Response(new Uint8Array([1]))) as typeof fetch; // no content-type header at all
      expect((await new KitchenOwlClient(cfg, bare).fetchPhoto("a"))?.contentType).toBe("application/octet-stream");
    });

    it("is null when KitchenOwl does not have the file, and fails on other errors", async () => {
      expect(await new KitchenOwlClient(cfg, json({}, 404)).fetchPhoto("x.jpg")).toBeNull();
      await expect(new KitchenOwlClient(cfg, json({}, 500)).fetchPhoto("x.jpg")).rejects.toMatchObject({ status: 500 });
    });
  });
});
