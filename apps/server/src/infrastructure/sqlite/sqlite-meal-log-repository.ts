import type { MealLogRepository } from "@weekly-planner/application";
import {
  mealLogEntryId,
  planDate,
  type Base,
  type MealLogEntry,
  type MealLogEntryId,
  type MealSource,
  type PlanDate,
  type Recipe,
} from "@weekly-planner/domain";
import type { Database } from "./database.js";

/** Adapter: what the household ate, one row per entry, plus the planned dates that already became an entry. */
export class SqliteMealLogRepository implements MealLogRepository {
  constructor(private readonly db: Database) {}

  async get(id: MealLogEntryId): Promise<MealLogEntry | null> {
    const row = this.db.prepare("select * from meal_log_entry where id = ?").get(id);
    return row ? this.load(row) : null;
  }

  async save(entry: MealLogEntry): Promise<void> {
    this.db
      .prepare(
        `insert into meal_log_entry (id, date, base, recipe_json, source, confirmed) values (?, ?, ?, ?, ?, ?)
         on conflict (id) do update set date = excluded.date, base = excluded.base, recipe_json = excluded.recipe_json,
           source = excluded.source, confirmed = excluded.confirmed`,
      )
      .run(
        entry.id,
        entry.date,
        entry.base,
        entry.recipe ? JSON.stringify(entry.recipe) : null,
        entry.source,
        entry.confirmed ? 1 : 0,
      );
    // An entry made from the plan marks its date as logged for good, even if the entry is removed later.
    if (entry.source === "from_plan")
      this.db.prepare("insert or ignore into logged_plan_date (date) values (?)").run(entry.date);
  }

  async remove(id: MealLogEntryId): Promise<void> {
    this.db.prepare("delete from meal_log_entry where id = ?").run(id);
  }

  async listSince(from: PlanDate): Promise<readonly MealLogEntry[]> {
    return this.db
      .prepare("select * from meal_log_entry where date >= ? order by date, id")
      .all(from)
      .map((row) => this.load(row));
  }

  async loggedPlanDates(): Promise<ReadonlySet<PlanDate>> {
    return new Set(
      this.db
        .prepare("select date from logged_plan_date")
        .all()
        .map((r) => planDate(r.date as string)),
    );
  }

  private load(row: Record<string, unknown>): MealLogEntry {
    return {
      id: mealLogEntryId(row.id as string),
      date: planDate(row.date as string),
      base: row.base as Base,
      recipe: row.recipe_json === null ? null : (JSON.parse(row.recipe_json as string) as Recipe),
      source: row.source as MealSource,
      confirmed: row.confirmed === 1,
    };
  }
}
