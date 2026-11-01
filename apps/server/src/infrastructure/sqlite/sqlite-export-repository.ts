import type { ExportRepository } from "@weekly-planner/application";
import type { FinalizeExport, SessionId } from "@weekly-planner/domain";
import type { Database } from "./database.js";

/** Adapter: the export state of finalized plans in SQLite, loaded and saved whole. */
export class SqliteExportRepository implements ExportRepository {
  constructor(private readonly db: Database) {}

  async get(sessionId: SessionId): Promise<FinalizeExport | null> {
    const row = this.db.prepare("select export_json from finalize_export where session_id = ?").get(sessionId);
    return row ? (JSON.parse(row.export_json as string) as FinalizeExport) : null;
  }

  async save(exported: FinalizeExport): Promise<void> {
    this.db
      .prepare(
        `insert into finalize_export (session_id, export_json) values (?, ?)
         on conflict (session_id) do update set export_json = excluded.export_json`,
      )
      .run(exported.sessionId, JSON.stringify(exported));
  }
}
