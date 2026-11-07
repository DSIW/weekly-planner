import type { DraftRequestLog } from "@weekly-planner/application";
import { memberId, type MemberId } from "@weekly-planner/domain";
import type { Database } from "./database.js";

/** Adapter: the drafts members asked for, to count against the hourly allowance (kept across restarts). */
export class SqliteDraftRequestLog implements DraftRequestLog {
  constructor(private readonly db: Database) {}

  async add(request: { requestedBy: MemberId; requestedAt: number }): Promise<void> {
    this.db
      .prepare("insert into draft_request (requested_by, requested_at) values (?, ?)")
      .run(request.requestedBy, request.requestedAt);
  }

  async listSince(from: number): Promise<readonly { requestedBy: MemberId; requestedAt: number }[]> {
    return this.db
      .prepare("select requested_by, requested_at from draft_request where requested_at >= ? order by requested_at")
      .all(from)
      .map((r) => ({ requestedBy: memberId(r.requested_by as string), requestedAt: r.requested_at as number }));
  }
}
