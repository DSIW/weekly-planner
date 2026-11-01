import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  memberId,
  newExport,
  planDate,
  proposalId,
  recipeId,
  sessionId,
  startSession,
  type PlanningSession,
  type Recipe,
} from "@weekly-planner/domain";
import { DateTakenConflict, OpenSessionConflict } from "@weekly-planner/application";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/infrastructure/sqlite/migrations.js";
import { openDatabase, type Database } from "../../src/infrastructure/sqlite/database.js";
import { SqliteSessionRepository } from "../../src/infrastructure/sqlite/sqlite-session-repository.js";
import { SqliteExportRepository } from "../../src/infrastructure/sqlite/sqlite-export-repository.js";
import { SqliteDinnerCalendar } from "../../src/infrastructure/sqlite/sqlite-dinner-calendar.js";
import { SqliteUnitOfWork } from "../../src/infrastructure/sqlite/sqlite-unit-of-work.js";

const AC = memberId("3");
const MON = planDate("2026-11-02");
const TUE = planDate("2026-11-03");

const aSession = (id: string, dates = [MON, TUE]): PlanningSession => {
  const r = startSession({ id: sessionId(id), startedBy: AC, dates, now: 1_000 });
  if (!r.ok) throw new Error(r.reason);
  return r.value.state;
};

const open: Database[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});
const fresh = (path = ":memory:") => {
  const db = openDatabase(path);
  open.push(db);
  return { db, sessions: new SqliteSessionRepository(db), uow: new SqliteUnitOfWork(db) };
};

describe("SqliteSessionRepository", () => {
  it("returns null for an unknown session and for 'no open session'", async () => {
    const { sessions } = fresh();
    expect(await sessions.get(sessionId("nope"))).toBeNull();
    expect(await sessions.findOpen()).toBeNull();
  });

  it("saves and loads a session whole, days in date order", async () => {
    const { sessions } = fresh();
    const s = aSession("s1", [TUE, MON]);
    await sessions.save(s);
    expect(await sessions.get(s.id)).toEqual(s);
    expect((await sessions.get(s.id))?.days.map((d) => d.date)).toEqual([MON, TUE]);
  });

  it("keeps a planned day's recipe, pending proposals and passes", async () => {
    const { sessions } = fresh();
    const recipe: Recipe = {
      id: recipeId(7),
      name: "Pasta",
      mealType: "main",
      base: "pasta",
      diet: "vegetarian",
      totalTimeMinutes: 20,
      isProven: false,
      wantsToTry: true,
      yields: 2,
    };
    const base = aSession("s1");
    const s: PlanningSession = {
      ...base,
      days: [{ date: MON, status: "planned", recipe }, base.days[1]!],
      proposals: [{ id: proposalId("p1"), date: TUE, recipe, proposedBy: AC, status: "pending" }],
      passes: [{ recipeId: recipeId(8), passedBy: AC }],
      reminderSent: true,
    };
    await sessions.save(s);
    expect(await sessions.get(s.id)).toEqual(s);
  });

  it("updates in place on a second save, dropping days that are gone", async () => {
    const { sessions } = fresh();
    const s = aSession("s1");
    await sessions.save(s);
    const changed: PlanningSession = { ...s, status: "closed", days: [s.days[0]!] };
    await sessions.save(changed);
    expect(await sessions.get(s.id)).toEqual(changed);
    expect(await sessions.listAll()).toHaveLength(1);
  });

  it("finds the open session, and none once it is closed", async () => {
    const { sessions } = fresh();
    const s = aSession("s1");
    await sessions.save(s);
    expect((await sessions.findOpen())?.id).toBe(s.id);
    await sessions.save({ ...s, status: "closed" });
    expect(await sessions.findOpen()).toBeNull();
  });

  it("refuses a second open session even if a caller forgot to check", async () => {
    const { sessions } = fresh();
    await sessions.save(aSession("s1"));
    await expect(sessions.save(aSession("s2"))).rejects.toBeInstanceOf(OpenSessionConflict);
    expect(await sessions.listAll()).toHaveLength(1);
  });

  it("survives a restart: a new connection to the same file sees the data", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "planner-")), "planner.sqlite");
    const first = fresh(path);
    const s = aSession("s1");
    await first.sessions.save(s);
    first.db.close();
    open.splice(open.indexOf(first.db), 1);
    expect(await fresh(path).sessions.get(s.id)).toEqual(s);
  });
});

describe("SqliteUnitOfWork", () => {
  it("commits what the work wrote", async () => {
    const { sessions, uow } = fresh();
    const s = aSession("s1");
    await uow.run(() => sessions.save(s));
    expect(await sessions.get(s.id)).toEqual(s);
  });

  it("rolls everything back when the work throws", async () => {
    const { sessions, uow } = fresh();
    await expect(
      uow.run(async () => {
        await sessions.save(aSession("s1"));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await sessions.listAll()).toEqual([]);
  });

  it("runs concurrent units of work one after the other", async () => {
    const { sessions, uow } = fresh();
    const order: string[] = [];
    const slow = uow.run(async () => {
      order.push("a-start");
      await new Promise((r) => setTimeout(r, 20));
      await sessions.save(aSession("a"));
      order.push("a-end");
    });
    const quick = uow.run(async () => {
      order.push("b-start");
    });
    await Promise.all([slow, quick]);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });
});

describe("migrations", () => {
  it("are idempotent: opening an existing file again changes nothing", () => {
    const path = join(mkdtempSync(join(tmpdir(), "planner-")), "planner.sqlite");
    const first = fresh(path);
    const version = first.db.prepare("pragma user_version").get();
    first.db.close();
    open.splice(open.indexOf(first.db), 1);
    expect(fresh(path).db.prepare("pragma user_version").get()).toEqual(version);
    expect(version).toEqual({ user_version: 5 });
  });
});

describe("migration 3 on a database that already holds sessions", () => {
  it("frees the dates of discarded sessions and keeps those of open and finalized ones", async () => {
    const raw = new DatabaseSync(":memory:");
    // The schema as released in v0.1.7 (migrations 1 and 2), with one session of each status.
    raw.exec(`
      create table planning_session (id text primary key, status text not null check (status in ('open', 'finalized', 'closed')),
        started_by text not null, started_at integer not null, reminder_sent integer not null default 0,
        proposals_json text not null default '[]', passes_json text not null default '[]');
      create unique index one_open_session on planning_session (status) where status = 'open';
      create table plan_day (session_id text not null references planning_session (id) on delete cascade, date text not null,
        status text not null check (status in ('open', 'planned', 'leftovers')), recipe_json text, primary key (session_id, date));
      create unique index one_dinner_per_date on plan_day (date) where status = 'planned';
      pragma user_version = 2;
      insert into planning_session (id, status, started_by, started_at) values ('old', 'closed', '3', 1), ('fin', 'finalized', '3', 1), ('now', 'open', '3', 1);
      insert into plan_day (session_id, date, status, recipe_json) values
        ('old', '2026-11-02', 'planned', '{}'), ('fin', '2026-11-03', 'planned', '{}'), ('now', '2026-11-04', 'planned', '{}');
    `);
    migrate(raw);
    const calendar = new SqliteDinnerCalendar(raw as unknown as Database);
    expect(await calendar.isDateTaken(MON, sessionId("x"))).toBe(false); // discarded
    expect(await calendar.isDateTaken(TUE, sessionId("x"))).toBe(true); // finalized
    expect(await calendar.isDateTaken(planDate("2026-11-04"), sessionId("x"))).toBe(true); // open
    expect(() =>
      raw.exec(
        "insert into plan_day (session_id, date, status, blocks_date) values ('now', '2026-11-02', 'planned', 1)",
      ),
    ).not.toThrow();
    expect(() =>
      raw.exec(
        "insert into plan_day (session_id, date, status, blocks_date) values ('fin', '2026-11-04', 'planned', 1)",
      ),
    ).toThrow(/UNIQUE/);
  });
});

describe("migration 4 and the export repository", () => {
  const exported = newExport(
    sessionId("s1"),
    [{ date: MON, recipeId: recipeId(7), recipeName: "Pasta", recipeYields: 2, portions: 2 }],
    [{ name: "Reis", description: "1 kg", needsReview: false, recipes: ["Pasta"] }],
  );

  it("keeps nothing for an unknown session and saves and replaces the export whole", async () => {
    const { db, sessions } = fresh();
    const exports = new SqliteExportRepository(db);
    expect(await exports.get(sessionId("s1"))).toBeNull();
    await sessions.save(aSession("s1"));
    await exports.save(exported);
    expect(await exports.get(sessionId("s1"))).toEqual(exported);
    const sending = {
      ...exported,
      list: { ...exported.list, status: "sending" as const },
      failure: "unconfirmed" as const,
    };
    await exports.save(sending);
    expect(await exports.get(sessionId("s1"))).toEqual(sending);
    expect(db.prepare("select count(*) as n from finalize_export").get()).toEqual({ n: 1 });
  });

  it("refuses an export for a session that does not exist, and goes with the session", async () => {
    const { db, sessions } = fresh();
    const exports = new SqliteExportRepository(db);
    await expect(exports.save(exported)).rejects.toThrow(/FOREIGN KEY/);
    await sessions.save(aSession("s1"));
    await exports.save(exported);
    db.exec("delete from planning_session where id = 's1'");
    expect(await exports.get(sessionId("s1"))).toBeNull();
  });

  it("is added to a database from v0.1.8 (version 3) without touching its sessions", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "planner-")), "planner.sqlite");
    const raw = new DatabaseSync(path);
    for (let i = 0; i < 3; i++) raw.exec("select 1");
    raw.close();
    const first = fresh(path);
    await first.sessions.save(aSession("keep"));
    first.db.exec(
      "drop table finalize_export; drop table push_subscription; drop table setting; pragma user_version = 3",
    );
    first.db.close();
    open.splice(open.indexOf(first.db), 1);
    const again = fresh(path);
    expect(again.db.prepare("pragma user_version").get()).toEqual({ user_version: 5 });
    expect((await again.sessions.get(sessionId("keep")))?.id).toBe("keep");
    await new SqliteExportRepository(again.db).save({ ...exported, sessionId: sessionId("keep") });
  });
});

describe("SqliteDinnerCalendar and one dinner per date", () => {
  const recipe: Recipe = {
    id: recipeId(7),
    name: "Pasta",
    mealType: "main",
    base: "pasta",
    diet: "vegetarian",
    totalTimeMinutes: 20,
    isProven: true,
    wantsToTry: false,
    yields: 2,
  };
  const planned = (s: PlanningSession, date: typeof MON): PlanningSession => ({
    ...s,
    days: s.days.map((d) => (d.date === date ? { date, status: "planned", recipe } : d)),
  });

  it("knows which dates another session planned, and ignores the asking session and open days", async () => {
    const { db, sessions } = fresh();
    const calendar = new SqliteDinnerCalendar(db);
    const first = { ...planned(aSession("s1"), MON), status: "finalized" as const };
    await sessions.save(first);
    expect(await calendar.isDateTaken(MON, sessionId("s2"))).toBe(true);
    expect(await calendar.isDateTaken(MON, first.id)).toBe(false);
    expect(await calendar.isDateTaken(TUE, sessionId("s2"))).toBe(false);
  });

  it("does not count a discarded session's planned dates, in the calendar or in the database", async () => {
    const { db, sessions } = fresh();
    const calendar = new SqliteDinnerCalendar(db);
    const first = { ...planned(aSession("s1"), MON), status: "open" as const };
    await sessions.save(first);
    expect(await calendar.isDateTaken(MON, sessionId("s2"))).toBe(true);
    await sessions.save({ ...first, status: "closed" });
    expect(await calendar.isDateTaken(MON, sessionId("s2"))).toBe(false);
    await expect(sessions.save(planned(aSession("s2"), MON))).resolves.toBeUndefined();
  });

  it("refuses a second planned dinner on one date even if a caller forgot to ask", async () => {
    const { sessions } = fresh();
    await sessions.save({ ...planned(aSession("s1"), MON), status: "finalized" });
    await expect(sessions.save(planned(aSession("s2"), MON))).rejects.toBeInstanceOf(DateTakenConflict);
    expect(await sessions.get(sessionId("s2"))).toBeNull();
  });

  it("allows the same date in several sessions as long as only one has it planned", async () => {
    const { sessions } = fresh();
    await sessions.save({ ...planned(aSession("s1"), MON), status: "closed" });
    await expect(sessions.save(aSession("s2"))).resolves.toBeUndefined();
  });
});
