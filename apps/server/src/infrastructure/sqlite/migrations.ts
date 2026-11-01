import type { DatabaseSync } from "node:sqlite";

/**
 * Applied in order, once each; `pragma user_version` remembers how many ran.
 * Never edit a migration that has shipped: add a new one.
 */
const MIGRATIONS: readonly string[] = [
  // 1: planning sessions and their days. Proposals and passes stay JSON on the session row until a slice
  // needs to query them (S2a normalises what its constraints require).
  `
  create table planning_session (
    id text primary key,
    status text not null check (status in ('open', 'finalized', 'closed')),
    started_by text not null,
    started_at integer not null,
    reminder_sent integer not null default 0,
    proposals_json text not null default '[]',
    passes_json text not null default '[]'
  );
  create unique index one_open_session on planning_session (status) where status = 'open';
  create table plan_day (
    session_id text not null references planning_session (id) on delete cascade,
    date text not null,
    status text not null check (status in ('open', 'planned', 'leftovers')),
    recipe_json text,
    primary key (session_id, date)
  );
  `,
  // 2: one planned dinner per date across all sessions (spec invariant OneDinnerPerDay); the use cases ask the
  // DinnerCalendar first, this makes a race between two sessions impossible.
  `
  create unique index one_dinner_per_date on plan_day (date) where status = 'planned';
  `,
  // 3: a discarded (closed) session no longer holds its dates. First real use: an agreed day of a plan that was
  // thrown away blocked accepting a dinner on that date.
  `
  alter table plan_day add column blocks_date integer not null default 0;
  update plan_day set blocks_date = 1
    where status = 'planned' and session_id in (select id from planning_session where status != 'closed');
  drop index one_dinner_per_date;
  create unique index one_dinner_per_date on plan_day (date) where blocks_date = 1;
  `,
  // 4: how far the export of a finalized plan to KitchenOwl has come (S4a). One row per session, the whole export as
  // JSON: it is only ever loaded and saved whole, and a step is recorded as sending before its request goes out (D23).
  `
  create table finalize_export (
    session_id text primary key references planning_session (id) on delete cascade,
    export_json text not null
  );
  `,
];

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("pragma user_version").get() as { user_version: number };
  for (let version = row.user_version; version < MIGRATIONS.length; version++) {
    db.exec("begin");
    try {
      db.exec(MIGRATIONS[version] as string);
      db.exec(`pragma user_version = ${version + 1}`);
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
  }
}
