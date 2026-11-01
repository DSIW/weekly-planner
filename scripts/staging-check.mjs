// Contract check of the two KitchenOwl writes against a STAGING instance (never the real one): the real client and
// gateway code put a recipe on the planner and its ingredients on a shopping list, then the result is read back.
// Needs .env.staging (KITCHENOWL_URL, KITCHENOWL_TOKEN, KITCHENOWL_HOUSEHOLD_ID, SHOPPING_LIST_ID) and
// `npm run build` is not required. Run: node scripts/staging-check.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.staging"), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const url = env.KITCHENOWL_URL ?? "https://kitchenowl-staging.s.dsiw-it.de";
assert.ok(url?.includes("staging"), "KITCHENOWL_URL in .env.staging must be the staging instance");
const household = Number(env.KITCHENOWL_HOUSEHOLD_ID ?? 2);
const listId = Number(env.SHOPPING_LIST_ID ?? 2);

const out = join(root, "node_modules/.cache/staging-entry.mjs");
await build({
  stdin: {
    contents: `export { KitchenOwlClient } from "./apps/server/src/infrastructure/kitchenowl/client.ts";
export { KitchenOwlPlannerGateway } from "./apps/server/src/infrastructure/kitchenowl/kitchenowl-planner-gateway.ts";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: out,
  logLevel: "error",
});
const { KitchenOwlClient, KitchenOwlPlannerGateway } = await import(out);

const auth = { Authorization: `Bearer ${env.KITCHENOWL_TOKEN}` };
const get = async (path) => {
  const res = await fetch(`${url}/api${path}`, { headers: auth });
  assert.ok(res.ok, `GET ${path} -> ${res.status}`);
  return res.json();
};
const client = new KitchenOwlClient({
  kitchenowlUrl: url,
  kitchenowlToken: env.KITCHENOWL_TOKEN,
  householdId: household,
});
const gateway = new KitchenOwlPlannerGateway(client, listId);

const recipe = (await client.listRecipes()).find((r) => r.items.length > 1);
const date = "2030-03-05";
console.log(`recipe ${recipe.id} "${recipe.name}", ${recipe.items.length} items; date ${date}`);

await gateway.addPlannerEntry({ recipeId: recipe.id, date, portions: 3 });
const planner = await get(`/household/${household}/planner`);
console.log("planner after write:", JSON.stringify(planner).slice(0, 300));
const entry = planner.find((p) => p.recipe?.id === recipe.id);
assert.ok(entry, "the planner entry did not appear");
console.log("cooking_date stored:", entry.cooking_date, "->", new Date(entry.cooking_date).toISOString());
assert.equal(new Date(entry.cooking_date).toISOString().slice(0, 10), date, "planner date is on another day");

await gateway.addShoppingListItems(
  recipe.items.map((i) => ({ id: i.id, name: i.name, description: i.description ?? "", optional: false })),
);
const list = await get(`/shoppinglist/${listId}/items`);
const names = new Set(list.map((i) => i.name));
for (const i of recipe.items) assert.ok(names.has(i.name), `list item missing: ${i.name}`);
console.log(`list ${listId}: ${list.length} items, all ${recipe.items.length} recipe items present`);
console.log("OK");
