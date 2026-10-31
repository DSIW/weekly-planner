import type { SessionRepository } from "@weekly-planner/application";
import {
  memberId,
  planDate,
  sessionId,
  type PassedSuggestion,
  type PlanDay,
  type PlanningSession,
  type Proposal,
  type Recipe,
  type SessionId,
} from "@weekly-planner/domain";
import type { SQLOutputValue } from "node:sqlite";
import type { Database } from "./database.js";

type Row = Record<string, SQLOutputValue>;

/** Adapter: planning sessions in SQLite, loaded and saved whole. */
export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async get(id: SessionId): Promise<PlanningSession | null> {
    const row = this.db.prepare("select * from planning_session where id = ?").get(id);
    return row ? this.load(row) : null;
  }

  async findOpen(): Promise<PlanningSession | null> {
    const row = this.db.prepare("select * from planning_session where status = 'open'").get();
    return row ? this.load(row) : null;
  }

  async listAll(): Promise<readonly PlanningSession[]> {
    return this.db
      .prepare("select * from planning_session order by started_at, id")
      .all()
      .map((row) => this.load(row));
  }

  async save(s: PlanningSession): Promise<void> {
    // Inside a unit of work the transaction already exists; alone, a save must still be all or nothing.
    const own = !this.db.isTransaction;
    if (own) this.db.exec("begin immediate");
    try {
      this.db
        .prepare(
          `insert into planning_session (id, status, started_by, started_at, reminder_sent, proposals_json, passes_json)
           values (?, ?, ?, ?, ?, ?, ?)
           on conflict (id) do update set status = excluded.status, reminder_sent = excluded.reminder_sent,
             proposals_json = excluded.proposals_json, passes_json = excluded.passes_json`,
        )
        .run(
          s.id,
          s.status,
          s.startedBy,
          s.startedAt,
          s.reminderSent ? 1 : 0,
          JSON.stringify(s.proposals),
          JSON.stringify(s.passes),
        );
      this.db.prepare("delete from plan_day where session_id = ?").run(s.id);
      const insertDay = this.db.prepare(
        "insert into plan_day (session_id, date, status, recipe_json) values (?, ?, ?, ?)",
      );
      for (const day of s.days) {
        insertDay.run(s.id, day.date, day.status, day.recipe ? JSON.stringify(day.recipe) : null);
      }
      if (own) this.db.exec("commit");
    } catch (error) {
      if (own) this.db.exec("rollback");
      throw error;
    }
  }

  private load(row: Row): PlanningSession {
    const id = row.id as string;
    const days = this.db
      .prepare("select date, status, recipe_json from plan_day where session_id = ? order by date")
      .all(id)
      .map((d): PlanDay => {
        const base = { date: planDate(d.date as string), status: d.status as PlanDay["status"] };
        return d.recipe_json === null ? base : { ...base, recipe: JSON.parse(d.recipe_json as string) as Recipe };
      });
    return {
      id: sessionId(id),
      status: row.status as PlanningSession["status"],
      startedBy: memberId(row.started_by as string),
      startedAt: row.started_at as number,
      days,
      proposals: JSON.parse(row.proposals_json as string) as Proposal[],
      passes: JSON.parse(row.passes_json as string) as PassedSuggestion[],
      reminderSent: row.reminder_sent === 1,
    };
  }
}
