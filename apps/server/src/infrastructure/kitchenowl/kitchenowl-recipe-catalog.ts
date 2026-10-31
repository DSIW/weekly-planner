import type { RecipeCatalog, RecipePhoto } from "@weekly-planner/application";
import type { CatalogEntry, Recipe, RecipeId } from "@weekly-planner/domain";
import type { KitchenOwlClient } from "./client.js";
import { toCatalogEntry } from "./recipe-translator.js";

/** Adapter: implements the RecipeCatalog port on top of the KitchenOwl REST API. */
export class KitchenOwlRecipeCatalog implements RecipeCatalog {
  /** Photo file per recipe, from the last time the list was read. */
  private photoFiles: Map<RecipeId, string> | null = null;

  constructor(private readonly client: Pick<KitchenOwlClient, "listRecipes" | "fetchPhoto">) {}

  async listAll(): Promise<readonly CatalogEntry[]> {
    const raw = await this.client.listRecipes();
    this.photoFiles = new Map(raw.flatMap((r) => (r.photo ? [[r.id as RecipeId, r.photo] as const] : [])));
    return raw.map(toCatalogEntry);
  }

  /** Always reads live; the cache is a decorator around this adapter. */
  async refresh(): Promise<void> {}

  async find(id: RecipeId): Promise<Recipe | null> {
    const entry = (await this.listAll()).find((e) => (e.kind === "ready" ? e.recipe.id : e.recipeId) === id);
    return entry?.kind === "ready" ? entry.recipe : null;
  }

  async photo(id: RecipeId): Promise<RecipePhoto | null> {
    if (!this.photoFiles) await this.listAll();
    const file = this.photoFiles?.get(id);
    return file ? this.client.fetchPhoto(file) : null;
  }
}
