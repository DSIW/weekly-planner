import http from "node:http";
import type { AddressInfo } from "node:net";
import { ExportNotApplied } from "@weekly-planner/application";
import { planDate, recipeId } from "@weekly-planner/domain";
import { afterEach, describe, expect, it } from "vitest";
import { KitchenOwlClient } from "../../src/infrastructure/kitchenowl/client.js";
import {
  cookingDateOf,
  KitchenOwlPlannerGateway,
} from "../../src/infrastructure/kitchenowl/kitchenowl-planner-gateway.js";

// Contract test: the real client and adapter against a fake KitchenOwl that answers like the real one does for the
// two write calls (shapes from ARCHITECTURE.md section 6).
interface Seen {
  method: string;
  url: string;
  auth: string | undefined;
  body: unknown;
}
let seen: Seen[] = [];
let status = 200;
const servers: http.Server[] = [];

async function fake(): Promise<KitchenOwlClient> {
  seen = [];
  status = 200;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        auth: req.headers.authorization,
        body: JSON.parse(body),
      });
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end("{}");
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return new KitchenOwlClient({ kitchenowlUrl: `http://127.0.0.1:${port}`, kitchenowlToken: "tok", householdId: 2 });
}

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

describe("KitchenOwlPlannerGateway", () => {
  it("puts a recipe on the household planner with its date in milliseconds and the portions as yields", async () => {
    const gateway = new KitchenOwlPlannerGateway(await fake(), 2);
    await gateway.addPlannerEntry({ recipeId: recipeId(41), date: planDate("2026-11-02"), portions: 2 });
    expect(seen).toEqual([
      {
        method: "POST",
        url: "/api/household/2/planner/recipe",
        auth: "Bearer tok",
        body: { recipe_id: 41, cooking_date: Date.parse("2026-11-02T12:00:00Z"), yields: 2 },
      },
    ]);
    expect(cookingDateOf("2026-11-02")).toBe(1_793_620_800_000);
  });

  it("sends all list items in one request to the configured list, ids only where known", async () => {
    const gateway = new KitchenOwlPlannerGateway(await fake(), 3);
    await gateway.addShoppingListItems([
      { id: 11, name: "Zwiebel", description: "3 Stück", optional: false },
      { name: "Salz", description: "", optional: false },
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: "/api/shoppinglist/3/recipeitems", auth: "Bearer tok" });
    expect(seen[0]?.body).toEqual({
      items: [
        { id: 11, name: "Zwiebel", description: "3 Stück", optional: false },
        { name: "Salz", description: "", optional: false },
      ],
    });
  });

  it.each([400, 401, 403, 404, 422, 502, 503])("reports HTTP %i as not applied, so a retry is safe", async (code) => {
    const gateway = new KitchenOwlPlannerGateway(await fake(), 2);
    status = code;
    await expect(
      gateway.addPlannerEntry({ recipeId: recipeId(1), date: planDate("2026-11-02"), portions: 2 }),
    ).rejects.toBeInstanceOf(ExportNotApplied);
    await expect(
      gateway.addShoppingListItems([{ name: "A", description: "", optional: false }]),
    ).rejects.toBeInstanceOf(ExportNotApplied);
  });

  it.each([500, 504])("leaves HTTP %i unconfirmed: KitchenOwl may have written before failing", async (code) => {
    const gateway = new KitchenOwlPlannerGateway(await fake(), 2);
    status = code;
    const error = await gateway
      .addShoppingListItems([{ name: "A", description: "", optional: false }])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ExportNotApplied);
  });

  it.each(["ECONNRESET", "UND_ERR_SOCKET", "ETIMEDOUT"])(
    "leaves a connection lost after sending (%s) unconfirmed: the request may have arrived",
    async (code) => {
      const lost = {
        addPlannerRecipe: async () => {
          throw new TypeError("fetch failed", { cause: { code } });
        },
        addShoppingListRecipeItems: async () => {
          throw new TypeError("fetch failed", { cause: { code } });
        },
      };
      const gateway = new KitchenOwlPlannerGateway(lost, 2);
      for (const result of [
        await gateway
          .addPlannerEntry({ recipeId: recipeId(1), date: planDate("2026-11-02"), portions: 2 })
          .catch((e: unknown) => e),
        await gateway.addShoppingListItems([{ name: "A", description: "", optional: false }]).catch((e: unknown) => e),
      ]) {
        expect(result).toBeInstanceOf(Error);
        expect(result).not.toBeInstanceOf(ExportNotApplied);
      }
    },
  );

  it("reports a refused connection as not applied but a lost answer as unconfirmed", async () => {
    const client = await fake();
    for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
    const refused = await new KitchenOwlPlannerGateway(client, 2)
      .addShoppingListItems([{ name: "A", description: "", optional: false }])
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ExportNotApplied);

    const timeout = new KitchenOwlPlannerGateway(
      {
        addPlannerRecipe: async () => Promise.reject(new DOMException("timed out", "TimeoutError")),
        addShoppingListRecipeItems: async () => {},
      },
      2,
    );
    const lost = await timeout
      .addPlannerEntry({ recipeId: recipeId(1), date: planDate("2026-11-02"), portions: 2 })
      .catch((e: unknown) => e);
    expect(lost).not.toBeInstanceOf(ExportNotApplied);
  });
});
