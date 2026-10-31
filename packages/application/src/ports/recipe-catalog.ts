import type { CatalogEntry, Recipe, RecipeId } from "@weekly-planner/domain";

/** A recipe's picture as the source holds it. */
export interface RecipePhoto {
  readonly contentType: string;
  readonly data: Uint8Array;
}

/** Port: where recipes come from. Implemented in the infrastructure layer (today: KitchenOwl). */
export interface RecipeCatalog {
  listAll(): Promise<readonly CatalogEntry[]>;
  /** A recipe with every attribute the rules need, or null when it is unknown or still needs data. */
  find(id: RecipeId): Promise<Recipe | null>;
  /** Re-reads the recipes from their source, so a change made there shows up now. A no-op without a cache. */
  refresh(): Promise<void>;
  /** The recipe's picture, or null when it has none or is unknown. */
  photo(id: RecipeId): Promise<RecipePhoto | null>;
}
