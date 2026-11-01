import type { RecipeExperienceRepository } from "@weekly-planner/application";
import { planDate, recipeId, type RecipeExperience, type RecipeId } from "@weekly-planner/domain";
import type { Database } from "./database.js";

/** Adapter: the recipes the household has confirmed cooking, with the day of the first time. */
export class SqliteRecipeExperienceRepository implements RecipeExperienceRepository {
  constructor(private readonly db: Database) {}

  async get(id: RecipeId): Promise<RecipeExperience | null> {
    const row = this.db.prepare("select recipe_id, first_cooked from recipe_experience where recipe_id = ?").get(id);
    return row
      ? { recipeId: recipeId(row.recipe_id as number), firstCooked: planDate(row.first_cooked as string) }
      : null;
  }

  async save(experience: RecipeExperience): Promise<void> {
    this.db
      .prepare(
        `insert into recipe_experience (recipe_id, first_cooked) values (?, ?)
         on conflict (recipe_id) do update set first_cooked = excluded.first_cooked`,
      )
      .run(experience.recipeId, experience.firstCooked);
  }

  async allRecipeIds(): Promise<ReadonlySet<RecipeId>> {
    return new Set(
      this.db
        .prepare("select recipe_id from recipe_experience")
        .all()
        .map((r) => recipeId(r.recipe_id as number)),
    );
  }
}
