import type { DinnerCalendar } from "@weekly-planner/application";
import type { PlanDate, SessionId } from "@weekly-planner/domain";
import type { Database } from "./database.js";

/** Adapter: asks the plan days of all sessions whether a dinner is already planned on a date. */
export class SqliteDinnerCalendar implements DinnerCalendar {
  constructor(private readonly db: Database) {}

  async isDateTaken(date: PlanDate, exceptSession: SessionId): Promise<boolean> {
    const row = this.db
      .prepare("select 1 as taken from plan_day where date = ? and status = 'planned' and session_id != ? limit 1")
      .get(date, exceptSession);
    return row !== undefined;
  }
}
