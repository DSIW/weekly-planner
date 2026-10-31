import { recipeId } from "@weekly-planner/domain";
import { describe, expect, it } from "vitest";
import { KitchenOwlRecipeCatalog } from "../../src/infrastructure/kitchenowl/kitchenowl-recipe-catalog.js";

const raw = (id: number, photo: string | null) => ({
  id,
  name: `R${id}`,
  time: 30,
  photo,
  tags: [{ name: "🍽️ Hauptgericht" }, { name: "🥬 Vegetarisch" }, { name: "✅ Erprobt" }],
  items: [],
});

function catalog(recipes = [raw(1, "one.jpg"), raw(2, null)]) {
  const state = { lists: 0, fetched: [] as string[] };
  const client = {
    async listRecipes() {
      state.lists++;
      return recipes as never;
    },
    async fetchPhoto(file: string) {
      state.fetched.push(file);
      return file === "gone.jpg" ? null : { contentType: "image/jpeg", data: new Uint8Array([9]) };
    },
  };
  return { state, catalog: new KitchenOwlRecipeCatalog(client) };
}

describe("KitchenOwlRecipeCatalog.photo", () => {
  it("fetches the file named on the recipe, reading the recipe list first when nobody did yet", async () => {
    const { catalog: c, state } = catalog();
    expect(await c.photo(recipeId(1))).toEqual({ contentType: "image/jpeg", data: new Uint8Array([9]) });
    expect(state.fetched).toEqual(["one.jpg"]);
    expect(state.lists).toBe(1);
    await c.photo(recipeId(1));
    expect(state.lists).toBe(1); // the list is remembered
  });

  it("is null for a recipe without a photo, an unknown recipe, and a file KitchenOwl lost", async () => {
    const { catalog: c } = catalog([raw(1, "gone.jpg"), raw(2, null)]);
    expect(await c.photo(recipeId(2))).toBeNull();
    expect(await c.photo(recipeId(99))).toBeNull();
    expect(await c.photo(recipeId(1))).toBeNull();
  });
});
