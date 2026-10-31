import type { Recipe } from "../catalog/recipe.js";
import type { PlanningConfig } from "./config.js";

/** Hard rule: only main dishes are proposed for dinner (no desserts, cakes, breakfast, snacks or drinks). */
export const isDinnerCandidate = (r: Pick<Recipe, "mealType">): boolean => r.mealType === "main";

/**
 * Hard rule: on a weekday a recipe must fit the time limit. A recipe without a known time is not excluded;
 * it is offered with a reminder to add the time.
 */
export const fitsWeekdayLimit = (r: Pick<Recipe, "totalTimeMinutes">, limitMinutes: number): boolean =>
  r.totalTimeMinutes === null || r.totalTimeMinutes <= limitMinutes;

/** A long recipe (dough that rests overnight, a marinade) stays eligible on a weekend but needs a day's lead time. */
export const needsPlanningAhead = (
  r: Pick<Recipe, "totalTimeMinutes">,
  config: Pick<PlanningConfig, "planAheadMinutes">,
): boolean => r.totalTimeMinutes !== null && r.totalTimeMinutes > config.planAheadMinutes;
