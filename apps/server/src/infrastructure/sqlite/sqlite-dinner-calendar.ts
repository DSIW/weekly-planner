import type { DinnerCalendar, TakenDate } from "@weekly-planner/application";
import { planDate, type PlanDate, type SessionId } from "@weekly-planner/domain";
import type { Database } from "./database.js";
import { readRecipeSummary } from "./stored-json.js";

/** Adapter: asks the plan days of all sessions whether a dinner is already planned on a date; discarded sessions do not count. */
export class SqliteDinnerCalendar implements DinnerCalendar {
  constructor(private readonly db: Database) {}

  async isDateTaken(date: PlanDate, exceptSession: SessionId): Promise<boolean> {
    const row = this.db
      .prepare("select 1 as taken from plan_day where date = ? and blocks_date = 1 and session_id != ? limit 1")
      .get(date, exceptSession);
    return row !== undefined;
  }

  async takenDatesFrom(from: PlanDate): Promise<readonly TakenDate[]> {
    return this.db
      .prepare("select session_id, date, recipe_json from plan_day where blocks_date = 1 and date >= ? order by date")
      .all(from)
      .map((r) => {
        const recipe = r.recipe_json
          ? readRecipeSummary(r.recipe_json as string, `plan_day ${r.date as string}`)
          : null;
        return {
          date: planDate(r.date as string),
          recipeName: recipe?.name ?? "",
          sessionId: r.session_id as string,
          ...(typeof recipe?.id === "number" ? { recipeId: recipe.id } : {}),
        };
      });
  }
}
