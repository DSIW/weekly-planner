import {
  ExportNotApplied,
  type PlannerEntry,
  type PlannerGateway,
  type ShoppingListItem,
} from "@weekly-planner/application";
import { KitchenOwlError, type KitchenOwlClient } from "./client.js";

/** Cooking dates go to KitchenOwl as Unix milliseconds; noon UTC falls on the same calendar day in Europe. */
export const cookingDateOf = (date: string): number => Date.parse(`${date}T12:00:00Z`);

/** Errors that mean the request never reached KitchenOwl's application: nothing was written. */
const UNREACHED = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

/**
 * A request is known not to have been applied when KitchenOwl answered with a client error, or a proxy answered that
 * KitchenOwl is down (502, 503), or the connection was never made. A timeout, a 500 or a 504 may have written.
 */
function classify(error: unknown): Error {
  if (error instanceof KitchenOwlError && error.status !== undefined) {
    const s = error.status;
    if ((s >= 400 && s < 500) || s === 502 || s === 503) return new ExportNotApplied(error.message);
    return error;
  }
  const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  if (typeof code === "string" && UNREACHED.has(code)) return new ExportNotApplied(`KitchenOwl unreachable (${code})`);
  return error instanceof Error ? error : new Error(String(error));
}

/** Adapter: the writes finalizing needs, on KitchenOwl's planner and one shopping list. */
export class KitchenOwlPlannerGateway implements PlannerGateway {
  constructor(
    private readonly client: Pick<KitchenOwlClient, "addPlannerRecipe" | "addShoppingListRecipeItems">,
    private readonly shoppingListId: number,
  ) {}

  async addPlannerEntry(entry: PlannerEntry): Promise<void> {
    try {
      await this.client.addPlannerRecipe(entry.recipeId, cookingDateOf(entry.date), entry.portions);
    } catch (error) {
      throw classify(error);
    }
  }

  async addShoppingListItems(items: readonly ShoppingListItem[]): Promise<void> {
    try {
      await this.client.addShoppingListRecipeItems(this.shoppingListId, items);
    } catch (error) {
      throw classify(error);
    }
  }
}
