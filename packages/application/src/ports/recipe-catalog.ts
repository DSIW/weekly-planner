import type { CatalogEntry } from "@weekly-planner/domain";

/** Port: where recipes come from. Implemented in the infrastructure layer (today: KitchenOwl). */
export interface RecipeCatalog {
  listAll(): Promise<readonly CatalogEntry[]>;
}
