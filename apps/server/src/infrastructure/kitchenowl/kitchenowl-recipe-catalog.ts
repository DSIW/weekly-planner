import type { RecipeCatalog } from "@weekly-planner/application";
import type { CatalogEntry, Recipe, RecipeId } from "@weekly-planner/domain";
import type { KitchenOwlClient } from "./client.js";
import { toCatalogEntry } from "./recipe-translator.js";

/** Adapter: implements the RecipeCatalog port on top of the KitchenOwl REST API. */
export class KitchenOwlRecipeCatalog implements RecipeCatalog {
  constructor(private readonly client: Pick<KitchenOwlClient, "listRecipes">) {}

  async listAll(): Promise<readonly CatalogEntry[]> {
    return (await this.client.listRecipes()).map(toCatalogEntry);
  }

  /** Always reads live; the cache is a decorator around this adapter. */
  async refresh(): Promise<void> {}

  async find(id: RecipeId): Promise<Recipe | null> {
    const entry = (await this.listAll()).find((e) => (e.kind === "ready" ? e.recipe.id : e.recipeId) === id);
    return entry?.kind === "ready" ? entry.recipe : null;
  }
}
