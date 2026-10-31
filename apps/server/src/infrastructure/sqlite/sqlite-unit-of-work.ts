import type { UnitOfWork } from "@weekly-planner/application";
import type { Database } from "./database.js";

/**
 * One SQLite transaction per use case. Units of work run one after the other, because the connection is shared and
 * a request must not write into another request's open transaction while that one waits.
 */
export class SqliteUnitOfWork implements UnitOfWork {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: Database) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => this.transaction(work));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async transaction<T>(work: () => Promise<T>): Promise<T> {
    this.db.exec("begin immediate");
    try {
      const value = await work();
      this.db.exec("commit");
      return value;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }
}
