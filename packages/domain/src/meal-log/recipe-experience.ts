import type { RecipeId } from "../catalog/recipe.js";
import type { PlanDate } from "../planning/dates.js";

/** A recipe the household has confirmed cooking at least once (spec: CookedRecipe). */
export interface RecipeExperience {
  readonly recipeId: RecipeId;
  readonly firstCooked: PlanDate;
}

/** Records the first confirmed cooking; later ones change nothing. */
export const registerCooking = (
  existing: RecipeExperience | null,
  recipeId: RecipeId,
  date: PlanDate,
): RecipeExperience => existing ?? { recipeId, firstCooked: date };
