import type { MealLogRepository, RecipeExperienceRepository } from "@weekly-planner/application";
import type { PlanDate, RecipeId } from "@weekly-planner/domain";

/**
 * Adapter stand-in until slice S5 records what was eaten: nothing was cooked and no recipe has an experience, so
 * the deck ranks on this session's days and on dinners planned in other sessions. S5 replaces it with SQLite.
 */
export class NoMealsRecordedYet
  implements Pick<MealLogRepository, "listSince">, Pick<RecipeExperienceRepository, "allRecipeIds">
{
  async listSince(_from: PlanDate) {
    return [];
  }

  async allRecipeIds(): Promise<ReadonlySet<RecipeId>> {
    return new Set();
  }
}
