import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  memberId,
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
import { openDatabase, type Database } from "../../src/infrastructure/sqlite/database.js";
import { SqliteSessionRepository } from "../../src/infrastructure/sqlite/sqlite-session-repository.js";
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
    expect(version).toEqual({ user_version: 3 });
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
