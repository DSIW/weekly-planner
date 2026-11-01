import type { PushSubscription, PushSubscriptions } from "@weekly-planner/application";
import { memberId, type MemberId } from "@weekly-planner/domain";
import type { Database } from "./database.js";

/** Adapter: the phones that asked for notifications, one row per push endpoint. */
export class SqlitePushSubscriptions implements PushSubscriptions {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  async save(member: MemberId, s: PushSubscription): Promise<void> {
    this.db
      .prepare(
        `insert into push_subscription (endpoint, member_id, p256dh, auth, created_at) values (?, ?, ?, ?, ?)
         on conflict (endpoint) do update set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(s.endpoint, member, s.p256dh, s.auth, this.now());
  }

  async remove(endpoint: string): Promise<void> {
    this.db.prepare("delete from push_subscription where endpoint = ?").run(endpoint);
  }

  async all() {
    const rows = this.db
      .prepare("select endpoint, member_id, p256dh, auth from push_subscription order by created_at, endpoint")
      .all();
    return rows.map((r) => ({
      member: memberId(r.member_id as string),
      subscription: { endpoint: r.endpoint as string, p256dh: r.p256dh as string, auth: r.auth as string },
    }));
  }
}
