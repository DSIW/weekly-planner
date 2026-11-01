import type { PlanDate, RecipeId } from "@weekly-planner/domain";

/** The planner entry of one agreed day. */
export interface PlannerEntry {
  readonly recipeId: RecipeId;
  readonly date: PlanDate;
  readonly portions: number;
}

/** One line to put on the shopping list; `description` is the amount and unit, or empty. */
export interface ShoppingListItem {
  readonly id?: number;
  readonly name: string;
  readonly description: string;
  readonly optional: boolean;
}

/**
 * The write request was refused, or never reached the other side: nothing was written, so sending it again is safe.
 * Any other error from a gateway means "no answer": the request may or may not have been applied.
 */
export class ExportNotApplied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportNotApplied";
  }
}

/**
 * Port: the writes finalizing needs in KitchenOwl (planner and shopping list). None of them is idempotent, so the
 * caller sends each at most once on its own (decision D23).
 */
export interface PlannerGateway {
  addPlannerEntry(entry: PlannerEntry): Promise<void>;
  /** All items in one request. KitchenOwl adds the amounts to what is already on the list. */
  addShoppingListItems(items: readonly ShoppingListItem[]): Promise<void>;
}
