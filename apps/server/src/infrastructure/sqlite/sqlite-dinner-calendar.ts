import type { DinnerCalendar } from "@weekly-planner/application";
import { planDate, type PlanDate, type SessionId } from "@weekly-planner/domain";
import type { Database } from "./database.js";

/** Adapter: asks the plan days of all sessions whether a dinner is already planned on a date; discarded sessions do not count. */
export class SqliteDinnerCalendar implements DinnerCalendar {
  constructor(private readonly db: Database) {}

  async isDateTaken(date: PlanDate, exceptSession: SessionId): Promise<boolean> {
    const row = this.db
      .prepare("select 1 as taken from plan_day where date = ? and blocks_date = 1 and session_id != ? limit 1")
      .get(date, exceptSession);
    return row !== undefined;
  }

  async takenDatesFrom(from: PlanDate): Promise<readonly PlanDate[]> {
    return this.db
      .prepare("select distinct date from plan_day where blocks_date = 1 and date >= ? order by date")
      .all(from)
      .map((r) => planDate(r.date as string));
  }
}
