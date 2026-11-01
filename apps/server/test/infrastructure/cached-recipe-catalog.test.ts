import type { RecipeCatalog } from "@weekly-planner/application";
import { recipeId, type CatalogEntry, type Recipe } from "@weekly-planner/domain";
import { describe, expect, it } from "vitest";
import { CachedRecipeCatalog } from "../../src/infrastructure/kitchenowl/cached-recipe-catalog.js";

const recipe = (id: number, name: string): Recipe => ({
  id: recipeId(id),
  name,
  mealType: "main",
  base: "pasta",
  diet: "vegetarian",
  totalTimeMinutes: 30,
  isProven: true,
  wantsToTry: false,
  yields: 2,
});
const ready = (r: Recipe): CatalogEntry => ({ kind: "ready", recipe: r });

/** A source that counts reads and can be changed or broken, standing in for KitchenOwl. */
function source(entries: CatalogEntry[]) {
  const state = { entries, reads: 0, failing: false };
  const catalog: RecipeCatalog = {
    async listAll() {
      state.reads++;
      if (state.failing) throw new Error("KitchenOwl is down");
      return state.entries;
    },
    async itemIcons() {
      return null;
    },
    async find(id) {
      const e = state.entries.find((x) => x.kind === "ready" && x.recipe.id === id);
      return e?.kind === "ready" ? e.recipe : null;
    },
    async refresh() {},
    async photo(id) {
      return id === recipeId(1) ? { contentType: "image/png", data: new Uint8Array([7]) } : null;
    },
  };
  return { state, catalog };
}

const TTL = 10 * 60_000;
const make = (entries: CatalogEntry[]) => {
  const src = source(entries);
  let now = 0;
  const cached = new CachedRecipeCatalog(src.catalog, TTL, () => now);
  return { ...src, cached, advance: (ms: number) => (now += ms) };
};

describe("CachedRecipeCatalog", () => {
  it("reads the source once while the cache is fresh, for lists and lookups alike", async () => {
    const { cached, state } = make([ready(recipe(1, "Pasta"))]);
    await cached.listAll();
    await cached.listAll();
    expect((await cached.find(recipeId(1)))?.name).toBe("Pasta");
    expect(await cached.find(recipeId(99))).toBeNull();
    expect(state.reads).toBe(1);
  });

  it("reads again once the cache is older than its lifetime", async () => {
    const { cached, state, advance } = make([ready(recipe(1, "Pasta"))]);
    await cached.listAll();
    advance(TTL + 1);
    await cached.listAll();
    expect(state.reads).toBe(2);
  });

  it("shows a change made in the source right after a manual refresh", async () => {
    const { cached, state } = make([ready(recipe(1, "Pasta"))]);
    await cached.listAll();
    state.entries = [ready(recipe(1, "Pasta")), ready(recipe(2, "Risotto"))];
    expect(await cached.listAll()).toHaveLength(1);
    await cached.refresh();
    expect(await cached.listAll()).toHaveLength(2);
  });

  it("shares one read between simultaneous callers", async () => {
    const { cached, state } = make([ready(recipe(1, "Pasta"))]);
    await Promise.all([cached.listAll(), cached.listAll(), cached.find(recipeId(1))]);
    expect(state.reads).toBe(1);
  });

  it("keeps serving the old list when the source fails after the cache expired", async () => {
    const { cached, state, advance } = make([ready(recipe(1, "Pasta"))]);
    await cached.listAll();
    advance(TTL + 1);
    state.failing = true;
    expect(await cached.listAll()).toHaveLength(1);
  });

  it("fails when the source fails and there is nothing cached yet", async () => {
    const { cached, state } = make([]);
    state.failing = true;
    await expect(cached.listAll()).rejects.toThrow("KitchenOwl is down");
  });

  it("fails a manual refresh when the source is down, so the member is told", async () => {
    const { cached, state } = make([ready(recipe(1, "Pasta"))]);
    await cached.listAll();
    state.failing = true;
    await expect(cached.refresh()).rejects.toThrow("KitchenOwl is down");
    expect(await cached.listAll()).toHaveLength(1);
  });

  it("hands photo requests to the source, which has its own memory", async () => {
    const { cached } = make([ready(recipe(1, "Pasta"))]);
    expect((await cached.photo(recipeId(1)))?.contentType).toBe("image/png");
    expect(await cached.photo(recipeId(2))).toBeNull();
  });
});
