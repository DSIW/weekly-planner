import type { RecipeCatalog, RecipePhoto } from "@weekly-planner/application";
import type { CatalogEntry, Recipe, RecipeId } from "@weekly-planner/domain";

/**
 * Adapter decorator: remembers the recipe list for a while, because every proposal and every list would
 * otherwise read all recipes from KitchenOwl. `refresh` reads again now, for when someone just fixed a tag there.
 * When KitchenOwl fails after the cache expired, the old list is kept so the planner stays usable.
 */
export class CachedRecipeCatalog implements RecipeCatalog {
  private entries: readonly CatalogEntry[] | null = null;
  private loadedAt = 0;
  private loading: Promise<readonly CatalogEntry[]> | null = null;

  constructor(
    private readonly source: Pick<RecipeCatalog, "listAll" | "photo">,
    private readonly lifetimeMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async listAll(): Promise<readonly CatalogEntry[]> {
    if (this.entries && this.now() - this.loadedAt < this.lifetimeMs) return this.entries;
    try {
      return await this.load();
    } catch (error) {
      if (this.entries) {
        console.warn(
          `recipes: KitchenOwl failed, serving the cached list: ${error instanceof Error ? error.message : error}`,
        );
        return this.entries;
      }
      throw error;
    }
  }

  async find(id: RecipeId): Promise<Recipe | null> {
    const entry = (await this.listAll()).find((e) => (e.kind === "ready" ? e.recipe.id : e.recipeId) === id);
    return entry?.kind === "ready" ? entry.recipe : null;
  }

  async refresh(): Promise<void> {
    await this.load();
  }

  /** Pictures are not kept here: the browser caches them, and the source remembers where each one lives. */
  photo(id: RecipeId): Promise<RecipePhoto | null> {
    return this.source.photo(id);
  }

  private load(): Promise<readonly CatalogEntry[]> {
    this.loading ??= this.source
      .listAll()
      .then((entries) => {
        this.entries = entries;
        this.loadedAt = this.now();
        return entries;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }
}
