import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AcceptProposal,
  CloseSession,
  GetCurrentSession,
  ListEligibleRecipes,
  ProposeRecipe,
  RefreshRecipes,
  StartSession,
  VetoProposal,
  type RecipeCatalog,
} from "@weekly-planner/application";
import { defaultPlanningConfig, memberId, recipeId, type CatalogEntry, type Recipe } from "@weekly-planner/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessEventHub } from "../../src/infrastructure/events/in-process-event-hub.js";
import { openDatabase, type Database } from "../../src/infrastructure/sqlite/database.js";
import { SqliteDinnerCalendar } from "../../src/infrastructure/sqlite/sqlite-dinner-calendar.js";
import { SqliteSessionRepository } from "../../src/infrastructure/sqlite/sqlite-session-repository.js";
import { SqliteUnitOfWork } from "../../src/infrastructure/sqlite/sqlite-unit-of-work.js";
import { UuidGenerator } from "../../src/infrastructure/system/system-services.js";
import { buildApp } from "../../src/interface/http/app.js";

// The whole server stack with real SQLite and the real use cases, two members signed in with their own cookies.
const SECRET = "x".repeat(32);
const NOW = Date.now();
const max = { id: memberId("2"), name: "Max" };
const ac = { id: memberId("3"), name: "AC" };
const cookies = new Map<string, string>();

const aRecipe = (id: number, name: string, over: Partial<Recipe> = {}): Recipe => ({
  id: recipeId(id),
  name,
  mealType: "main",
  base: "pasta",
  diet: "vegetarian",
  totalTimeMinutes: 30,
  isProven: true,
  wantsToTry: false,
  yields: 2,
  ...over,
});
const pasta = aRecipe(1, "Pasta");
const risotto = aRecipe(2, "Risotto");
const curry = aRecipe(3, "Curry");
const tiramisu = aRecipe(4, "Tiramisu", { mealType: "dessert" });
const braten = aRecipe(5, "Schmorbraten", { totalTimeMinutes: 120, diet: "meat" });
const recipes = [pasta, risotto, curry, tiramisu, braten];

let refreshes: number;
let catalogDown: boolean;
const catalog: RecipeCatalog = {
  async listAll() {
    if (catalogDown) throw new Error("KitchenOwl is down");
    return recipes.map((recipe): CatalogEntry => ({ kind: "ready", recipe }));
  },
  async find(id) {
    if (catalogDown) throw new Error("KitchenOwl is down");
    return recipes.find((r) => r.id === id) ?? null;
  },
  async refresh() {
    if (catalogDown) throw new Error("KitchenOwl is down");
    refreshes++;
  },
};
let logged: string[];

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  db = openDatabase(":memory:");
  const hub = new InProcessEventHub();
  refreshes = 0;
  catalogDown = false;
  logged = [];
  const deps = { sessions: new SqliteSessionRepository(db), events: hub, uow: new SqliteUnitOfWork(db) };
  const calendar = new SqliteDinnerCalendar(db);
  const ids = new UuidGenerator();
  const clock = {
    now: () => NOW,
    today: () => "2026-11-01" as never,
    localNow: () => ({ date: "2026-11-01" as never, hour: 12 }),
  };
  const webDist = mkdtempSync(join(tmpdir(), "web-"));
  writeFileSync(join(webDist, "index.html"), "<html></html>");
  app = await buildApp({
    signIn: {
      execute: async (cmd) =>
        cmd.username === "max"
          ? { ok: true, value: max }
          : cmd.username === "ac"
            ? { ok: true, value: ac }
            : { ok: false, reason: "invalid_credentials" },
    },
    getCurrentSession: new GetCurrentSession(deps.sessions),
    startSession: new StartSession({ ...deps, ids, clock }, defaultPlanningConfig),
    closeSession: new CloseSession(deps),
    listEligibleRecipes: new ListEligibleRecipes({ sessions: deps.sessions, catalog }, defaultPlanningConfig),
    proposeRecipe: new ProposeRecipe({ ...deps, catalog, ids }, defaultPlanningConfig),
    acceptProposal: new AcceptProposal({ ...deps, calendar }, defaultPlanningConfig),
    vetoProposal: new VetoProposal(deps),
    refreshRecipes: new RefreshRecipes(catalog),
    log: (line) => logged.push(line),
    subscribe: (l) => hub.subscribe(l),
    sessionSecret: SECRET,
    basePath: "/plan",
    webDist,
    cookieSecure: false,
    trustProxy: false,
    now: () => NOW,
  });
  // Each member signs in through the real login route and keeps the signed cookie it sets.
  for (const [name, member] of [
    ["max", max],
    ["ac", ac],
  ] as const) {
    const res = await app.inject({
      method: "POST",
      url: "/plan/api/login",
      payload: { username: name, password: "pw" },
    });
    cookies.set(member.id, `session=${res.cookies[0]!.value}`);
  }
});
afterEach(async () => {
  await app.close();
  db.close();
});

const cookieFor = (m: typeof max) => cookies.get(m.id)!;
const call = (method: "GET" | "POST", url: string, as?: typeof max, payload?: unknown) =>
  app.inject({
    method,
    url: `/plan/api${url}`,
    payload: payload as never,
    headers: as ? { cookie: cookieFor(as) } : {},
  });
const start = (as: typeof max, dates: string[]) => call("POST", "/sessions", as, { dates });

describe("sessions over HTTP", () => {
  it("needs a signed-in member for every route", async () => {
    expect((await call("GET", "/sessions/current")).statusCode).toBe(401);
    expect((await call("POST", "/sessions", undefined, { dates: [] })).statusCode).toBe(401);
    expect((await call("POST", "/sessions/x/close")).statusCode).toBe(401);
    expect((await call("GET", "/events")).statusCode).toBe(401);
  });

  it("shows no session before one is started", async () => {
    const res = await call("GET", "/sessions/current", max);
    expect(res.json()).toEqual({ session: null });
  });

  it("starts a session that the other member sees as the current one", async () => {
    const res = await start(max, ["2026-11-03", "2026-11-02"]);
    expect(res.statusCode).toBe(201);
    const { session } = res.json();
    expect(session).toMatchObject({
      status: "open",
      startedBy: "2",
      days: [
        { date: "2026-11-02", status: "open" },
        { date: "2026-11-03", status: "open" },
      ],
    });
    expect((await call("GET", "/sessions/current", ac)).json()).toEqual({ session });
  });

  it("refuses a second session while one is open, with 409", async () => {
    await start(max, ["2026-11-02", "2026-11-03"]);
    const res = await start(ac, ["2026-11-04", "2026-11-05"]);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "session_already_open" });
  });

  it("lets exactly one of two simultaneous starts win", async () => {
    const [a, b] = await Promise.all([
      start(max, ["2026-11-02", "2026-11-03"]),
      start(ac, ["2026-11-04", "2026-11-05"]),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    expect((await call("GET", "/sessions/current", max)).json().session).not.toBeNull();
  });

  it.each([
    [["2026-11-02"], 422, "too_few_days"],
    [["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"], 422, "too_many_days"],
    [["2026-11-02", "2026-11-02"], 422, "duplicate_dates"],
    [["2026-11-02", "not-a-date"], 400, "invalid_request"],
    [["2026-02-30", "2026-11-02"], 400, "invalid_request"],
  ])("rejects the dates %j with %i %s", async (dates, status, error) => {
    const res = await start(max, dates);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error });
  });

  it("rejects a body without dates", async () => {
    expect((await call("POST", "/sessions", max, { nope: 1 })).statusCode).toBe(400);
  });

  it("closes the session so a new one can start", async () => {
    const { session } = (await start(max, ["2026-11-02", "2026-11-03"])).json();
    const closed = await call("POST", `/sessions/${session.id}/close`, ac);
    expect(closed.statusCode).toBe(200);
    expect(closed.json().session.status).toBe("closed");
    expect((await call("GET", "/sessions/current", max)).json()).toEqual({ session: null });
    expect((await start(ac, ["2026-11-04", "2026-11-05"])).statusCode).toBe(201);
    expect((await call("POST", `/sessions/${session.id}/close`, ac)).statusCode).toBe(409);
    expect((await call("POST", "/sessions/unknown/close", ac)).statusCode).toBe(404);
  });
});

describe("live updates (Server-Sent Events)", () => {
  it("tells a connected member when the other one starts a session", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const controller = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${port}/plan/api/events`, {
      headers: { cookie: cookieFor(ac) },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const readUntil = async (needle: string) => {
      while (!received.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value);
      }
    };
    await readUntil("event: ready");
    await fetch(`http://127.0.0.1:${port}/plan/api/sessions`, {
      method: "POST",
      headers: { cookie: cookieFor(max), "content-type": "application/json" },
      body: JSON.stringify({ dates: ["2026-11-02", "2026-11-03"] }),
    });
    await readUntil("event: changed");
    expect(received).toContain('data: {"type":"SessionStarted"}');
    controller.abort();
  });
});

// Slice S2a: agreeing a dinner. Two members, real use cases, real SQLite.
const MON = "2026-11-02";
const TUE = "2026-11-03";
const SAT = "2026-11-07";
const SUN = "2026-11-08";
const sessionOf = async (as: typeof max) => (await call("GET", "/sessions/current", as)).json().session;
const eligible = async (as: typeof max, id: string) => (await call("GET", `/sessions/${id}/recipes`, as)).json();
const propose = (as: typeof max, id: string, date: string, recipe: Recipe) =>
  call("POST", `/sessions/${id}/proposals`, as, { date, recipeId: recipe.id });
const decide = (as: typeof max, id: string, proposalId: string, what: "accept" | "veto") =>
  call("POST", `/sessions/${id}/proposals/${proposalId}/${what}`, as);
const pending = (session: { proposals: { id: string; status: string }[] }) =>
  session.proposals.filter((p) => p.status === "pending");

describe("agreeing a dinner over HTTP", () => {
  it("needs a signed-in member for every route", async () => {
    for (const [method, url] of [
      ["GET", "/sessions/x/recipes"],
      ["POST", "/sessions/x/proposals"],
      ["POST", "/sessions/x/proposals/p/accept"],
      ["POST", "/sessions/x/proposals/p/veto"],
      ["POST", "/recipes/refresh"],
    ] as const) {
      expect((await call(method, url)).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("offers the next open day's dinners by name: no desserts, no long recipes on a weekday", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    expect(await eligible(ac, session.id)).toEqual({
      date: MON,
      recipes: [
        { id: 3, name: "Curry", minutes: 30, base: "pasta", diet: "vegetarian", needsTime: false },
        { id: 1, name: "Pasta", minutes: 30, base: "pasta", diet: "vegetarian", needsTime: false },
        { id: 2, name: "Risotto", minutes: 30, base: "pasta", diet: "vegetarian", needsTime: false },
      ],
    });
  });

  it("offers long recipes on a weekend", async () => {
    const { session } = (await start(max, [SAT, SUN])).json();
    expect((await eligible(ac, session.id)).recipes.map((r: { name: string }) => r.name)).toContain("Schmorbraten");
  });

  it("answers 404 for the list of an unknown session", async () => {
    expect((await call("GET", "/sessions/unknown/recipes", max)).statusCode).toBe(404);
  });

  it("lets one member propose and the other accept: the day is planned and the next one comes up", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const proposed = await propose(max, session.id, MON, pasta);
    expect(proposed.statusCode).toBe(201);
    const proposal = pending(proposed.json().session)[0]!;
    expect(proposal).toMatchObject({ date: MON, proposedBy: "2", status: "pending", recipe: { id: 1, name: "Pasta" } });
    expect(pending(await sessionOf(ac))).toHaveLength(1);

    expect((await decide(max, session.id, proposal.id, "accept")).statusCode).toBe(403); // not their own
    const accepted = await decide(ac, session.id, proposal.id, "accept");
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().session.days[0]).toMatchObject({ date: MON, status: "planned", recipe: { name: "Pasta" } });
    expect(pending(accepted.json().session)).toHaveLength(0);

    const next = await eligible(max, session.id);
    expect(next.date).toBe(TUE);
    expect(next.recipes.map((r: { name: string }) => r.name)).not.toContain("Pasta"); // already planned
  });

  it("keeps a vetoed dish out of the rest of this session, but not out of the next one", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const proposal = pending((await propose(max, session.id, MON, pasta)).json().session)[0]!;
    expect((await decide(ac, session.id, proposal.id, "veto")).statusCode).toBe(200);
    expect((await eligible(max, session.id)).recipes.map((r: { name: string }) => r.name)).not.toContain("Pasta");
    expect((await propose(ac, session.id, MON, pasta)).statusCode).toBe(409);

    await call("POST", `/sessions/${session.id}/close`, max);
    const { session: later } = (await start(max, [MON, TUE])).json();
    expect((await eligible(max, later.id)).recipes.map((r: { name: string }) => r.name)).toContain("Pasta");
  });

  it("lets exactly one of two simultaneous proposals through; the other member votes on it", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const [a, b] = await Promise.all([propose(max, session.id, MON, pasta), propose(ac, session.id, MON, risotto)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json()).toEqual({ error: "proposal_already_pending" });
    expect(pending(await sessionOf(max))).toHaveLength(1);
  });

  it.each([
    ["a day that is not the next open one", TUE, 1, 409, "not_next_open_day"],
    ["a dessert", MON, 4, 422, "not_a_dinner"],
    ["a long recipe on a weekday", MON, 5, 422, "too_long_for_weekday"],
    ["a recipe that does not exist", MON, 99, 404, "unknown_recipe"],
  ])("refuses to propose %s", async (_what, date, id, status, error) => {
    const { session } = (await start(max, [MON, TUE])).json();
    const res = await call("POST", `/sessions/${session.id}/proposals`, max, { date, recipeId: id });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error });
  });

  it("rejects malformed proposals and decisions about things that do not exist", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    expect(
      (await call("POST", `/sessions/${session.id}/proposals`, max, { date: "nope", recipeId: 1 })).statusCode,
    ).toBe(400);
    expect((await call("POST", `/sessions/${session.id}/proposals`, max, { date: MON })).statusCode).toBe(400);
    expect((await decide(ac, session.id, "unknown", "accept")).statusCode).toBe(404);
    expect((await decide(ac, "unknown", "p", "veto")).statusCode).toBe(404);
  });

  it("cannot decide a proposal once the session was discarded", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const proposal = pending((await propose(max, session.id, MON, pasta)).json().session)[0]!;
    await call("POST", `/sessions/${session.id}/close`, max);
    expect((await decide(ac, session.id, proposal.id, "veto")).statusCode).toBe(409);
    expect((await decide(ac, session.id, proposal.id, "accept")).statusCode).toBe(409);
  });

  it("refreshes the recipes on request and says so when KitchenOwl is down", async () => {
    expect((await call("POST", "/recipes/refresh", max)).statusCode).toBe(204);
    expect(refreshes).toBe(1);
    catalogDown = true;
    expect((await call("POST", "/recipes/refresh", max)).statusCode).toBe(502);
  });

  it("does not turn a KitchenOwl failure into a 'not signed in' or 'wrong password'", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    catalogDown = true;
    const res = await propose(max, session.id, MON, pasta);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "unavailable" });
    expect(logged.join("\n")).toContain("-> 502 unavailable");
  });
});
