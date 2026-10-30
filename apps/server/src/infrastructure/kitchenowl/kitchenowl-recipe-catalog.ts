import type { RecipeCatalog } from "@weekly-planner/application";
import type { CatalogEntry } from "@weekly-planner/domain";
import type { KitchenOwlClient } from "./client.js";
import { toCatalogEntry } from "./recipe-translator.js";

/** Adapter: implements the RecipeCatalog port on top of the KitchenOwl REST API. */
export class KitchenOwlRecipeCatalog implements RecipeCatalog {
  constructor(private readonly client: Pick<KitchenOwlClient, "listRecipes">) {}

  async listAll(): Promise<readonly CatalogEntry[]> {
    return (await this.client.listRecipes()).map(toCatalogEntry);
  }
}
