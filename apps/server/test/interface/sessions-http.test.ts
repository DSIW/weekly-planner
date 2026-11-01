import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AcceptProposal,
  CloseSession,
  ExportFinalizedPlan,
  ExportNotApplied,
  FinalizePlan,
  GetCurrentSession,
  GetDeck,
  GetExport,
  GetFinalizePreview,
  GetRecipePhoto,
  MarkLeftoverDay,
  MovePlannedDay,
  PassSuggestion,
  SuggestRecipes,
  ListEligibleRecipes,
  ProposeRecipe,
  RefreshRecipes,
  ReopenDay,
  RetryExport,
  SendTestNotification,
  SubscribeToPush,
  UnsubscribeFromPush,
  StartSession,
  SwapPlannedDays,
  VetoProposal,
  WithdrawProposal,
  type PlannerEntry,
  type PlannerGateway,
  type RecipeCatalog,
  type ShoppingListItem,
} from "@weekly-planner/application";
import { defaultPlanningConfig, memberId, recipeId, type CatalogEntry, type Recipe } from "@weekly-planner/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessEventHub } from "../../src/infrastructure/events/in-process-event-hub.js";
import { openDatabase, type Database } from "../../src/infrastructure/sqlite/database.js";
import { NoMealsRecordedYet } from "../../src/infrastructure/meal-log/not-recorded-yet.js";
import { SystemRandomness, UuidGenerator } from "../../src/infrastructure/system/system-services.js";
import { SqliteExportRepository } from "../../src/infrastructure/sqlite/sqlite-export-repository.js";
import { SqliteDinnerCalendar } from "../../src/infrastructure/sqlite/sqlite-dinner-calendar.js";
import { SqlitePushSubscriptions } from "../../src/infrastructure/sqlite/sqlite-push-subscriptions.js";
import { SqliteSessionRepository } from "../../src/infrastructure/sqlite/sqlite-session-repository.js";
import { SqliteUnitOfWork } from "../../src/infrastructure/sqlite/sqlite-unit-of-work.js";
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
const pasta = aRecipe(1, "Pasta", {
  tags: ["🍝 Pasta", "🥬 Vegetarisch"],
  ingredients: [
    { id: 11, name: "Zwiebel", description: "2 Stück, gehackt", optional: false, category: "🥬 Obst & Gemüse" },
    { name: "Mehl", description: "400 g", optional: false, category: "Backen" },
  ],
});
const risotto = aRecipe(2, "Risotto");
const curry = aRecipe(3, "Curry", {
  yields: 4,
  ingredients: [
    { id: 11, name: "Zwiebel", description: "2 Stück", optional: false, category: "🥬 Obst & Gemüse" },
    { name: "Salz", description: "etwas", optional: false },
  ],
});
const tiramisu = aRecipe(4, "Tiramisu", { mealType: "dessert" });
const braten = aRecipe(5, "Schmorbraten", { totalTimeMinutes: 120, diet: "meat" });
const biga = aRecipe(6, "Pizza Biga", { totalTimeMinutes: 1285 });
const kuerbis = aRecipe(7, "Kürbissuppe", { isProven: false }); // never cooked: a new recipe
const ohneZeit = aRecipe(8, "Ohne Zeit", { totalTimeMinutes: null }); // nobody entered a time yet
const recipes = [pasta, risotto, curry, tiramisu, braten, biga, kuerbis, ohneZeit];

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
  async photo(id) {
    return id === recipeId(1) ? { contentType: "image/jpeg", data: new Uint8Array([255, 216, 1]) } : null;
  },
};
let logged: string[];

/** What reaches KitchenOwl; `fail` makes the next request throw. */
const sent: { entries: PlannerEntry[]; batches: (readonly ShoppingListItem[])[]; fail: Error[] } = {
  entries: [],
  batches: [],
  fail: [],
};
const planner: PlannerGateway = {
  async addPlannerEntry(entry) {
    const error = sent.fail.shift();
    if (error) throw error;
    sent.entries.push(entry);
  },
  async addShoppingListItems(items) {
    const error = sent.fail.shift();
    if (error) throw error;
    sent.batches.push(items);
  },
};

const tested: string[] = [];
let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  db = openDatabase(":memory:");
  const hub = new InProcessEventHub();
  refreshes = 0;
  catalogDown = false;
  logged = [];
  sent.entries = [];
  sent.batches = [];
  sent.fail = [];
  const deps = { sessions: new SqliteSessionRepository(db), events: hub, uow: new SqliteUnitOfWork(db) };
  const calendar = new SqliteDinnerCalendar(db);
  const exports = new SqliteExportRepository(db);
  const exporter = new ExportFinalizedPlan({ exports, planner, events: hub, uow: deps.uow });
  const ids = new UuidGenerator();
  const noMeals = new NoMealsRecordedYet();
  const clock = {
    now: () => NOW,
    today: () => "2026-11-01" as never,
    localNow: () => ({ date: "2026-11-01" as never, hour: 12 }),
  };
  const suggest = new SuggestRecipes(
    {
      sessions: deps.sessions,
      catalog,
      mealLog: noMeals,
      experience: noMeals,
      clock,
      randomness: new SystemRandomness(),
    },
    defaultPlanningConfig,
  );
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
    getCurrentSession: new GetCurrentSession({ sessions: deps.sessions, exports }),
    getExport: new GetExport(exports),
    getFinalizePreview: new GetFinalizePreview({ sessions: deps.sessions, catalog }, defaultPlanningConfig),
    finalizePlan: new FinalizePlan({ ...deps, catalog, exports, exporter }, defaultPlanningConfig),
    retryExport: new RetryExport({ sessions: deps.sessions, exporter }),
    subscribeToPush: new SubscribeToPush(new SqlitePushSubscriptions(db)),
    sendTestNotification: new SendTestNotification({ test: async (member) => (tested.push(member), tested.length) }),
    unsubscribeFromPush: new UnsubscribeFromPush(new SqlitePushSubscriptions(db)),
    pushPublicKey: "public-key-of-the-server",
    startSession: new StartSession({ ...deps, ids, clock }, defaultPlanningConfig),
    closeSession: new CloseSession(deps),
    listEligibleRecipes: new ListEligibleRecipes({ sessions: deps.sessions, catalog }, defaultPlanningConfig),
    proposeRecipe: new ProposeRecipe({ ...deps, catalog, ids }, defaultPlanningConfig),
    acceptProposal: new AcceptProposal({ ...deps, calendar }, defaultPlanningConfig),
    vetoProposal: new VetoProposal(deps),
    withdrawProposal: new WithdrawProposal(deps),
    refreshRecipes: new RefreshRecipes(catalog),
    getDeck: new GetDeck({ sessions: deps.sessions, experience: noMeals, suggest }),
    passSuggestion: new PassSuggestion({ ...deps, catalog }),
    getRecipePhoto: new GetRecipePhoto(catalog),
    markLeftoverDay: new MarkLeftoverDay(deps),
    reopenDay: new ReopenDay(deps),
    swapPlannedDays: new SwapPlannedDays(deps, defaultPlanningConfig),
    movePlannedDay: new MovePlannedDay({ ...deps, calendar }, defaultPlanningConfig),
    planAheadMinutes: defaultPlanningConfig.planAheadMinutes,
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
const call = (method: "GET" | "POST" | "DELETE", url: string, as?: typeof max, payload?: unknown) =>
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
const decide = (as: typeof max, id: string, proposalId: string, what: "accept" | "veto" | "withdraw") =>
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
        {
          id: 3,
          name: "Curry",
          minutes: 30,
          base: "pasta",
          diet: "vegetarian",
          tags: [],
          needsTime: false,
          planAhead: false,
        },
        {
          id: 7,
          name: "Kürbissuppe",
          minutes: 30,
          base: "pasta",
          diet: "vegetarian",
          tags: [],
          needsTime: false,
          planAhead: false,
        },
        {
          id: 8,
          name: "Ohne Zeit",
          minutes: null,
          base: "pasta",
          diet: "vegetarian",
          tags: [],
          needsTime: true,
          planAhead: false,
        },
        {
          id: 1,
          name: "Pasta",
          minutes: 30,
          base: "pasta",
          diet: "vegetarian",
          tags: ["🍝 Pasta", "🥬 Vegetarisch"],
          needsTime: false,
          planAhead: false,
        },
        {
          id: 2,
          name: "Risotto",
          minutes: 30,
          base: "pasta",
          diet: "vegetarian",
          tags: [],
          needsTime: false,
          planAhead: false,
        },
      ],
    });
  });

  it("offers long recipes on a weekend", async () => {
    const { session } = (await start(max, [SAT, SUN])).json();
    expect((await eligible(ac, session.id)).recipes.map((r: { name: string }) => r.name)).toContain("Schmorbraten");
  });

  it("flags recipes that need planning ahead and lists them last", async () => {
    const { session } = (await start(max, [SAT, SUN])).json();
    const list = (await eligible(ac, session.id)).recipes as { name: string; planAhead: boolean }[];
    expect(list.at(-1)).toMatchObject({ name: "Pizza Biga", minutes: 1285, planAhead: true });
    expect(list.filter((r) => r.planAhead)).toHaveLength(1);
    expect(list.map((r) => r.name)).toContain("Schmorbraten"); // long, but not "plan ahead"
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

  it("lets the proposer withdraw, and nobody else; the day is open for a new proposal", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const proposal = pending((await propose(max, session.id, MON, pasta)).json().session)[0]!;
    const other = await decide(ac, session.id, proposal.id, "withdraw");
    expect(other.statusCode).toBe(403);
    expect(other.json()).toEqual({ error: "not_your_proposal" });
    const done = await decide(max, session.id, proposal.id, "withdraw");
    expect(done.statusCode).toBe(200);
    expect(done.json().session.proposals[0].status).toBe("withdrawn");
    expect(pending(done.json().session)).toHaveLength(0);
    expect((await propose(ac, session.id, MON, pasta)).statusCode).toBe(201);
    expect((await decide(max, session.id, proposal.id, "withdraw")).statusCode).toBe(409);
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

// Slice S2b: the ranked deck, passing, photos.
const deck = async (as: typeof max, id: string) => (await call("GET", `/sessions/${id}/deck`, as)).json();
const pass = (as: typeof max, id: string, recipe: Recipe) =>
  call("POST", `/sessions/${id}/passes`, as, { recipeId: recipe.id });
const cardNames = (d: { cards: { name: string }[] }) => d.cards.map((c) => c.name);

describe("the ranked deck over HTTP", () => {
  it("needs a signed-in member for every route", async () => {
    for (const [method, url] of [
      ["GET", "/sessions/x/deck"],
      ["POST", "/sessions/x/passes"],
      ["GET", "/recipes/1/photo"],
    ] as const) {
      expect((await call(method, url)).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("offers the next open day's eligible dinners as cards, with what the card shows", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const d = await deck(ac, session.id);
    expect(d.date).toBe(MON);
    expect(cardNames(d).sort()).toEqual(["Curry", "Kürbissuppe", "Ohne Zeit", "Pasta", "Risotto"]); // no dessert, no long recipe
    expect(d.cards.find((c: { name: string }) => c.name === "Pasta")).toEqual({
      id: 1,
      name: "Pasta",
      minutes: 30,
      base: "pasta",
      diet: "vegetarian",
      tags: ["🍝 Pasta", "🥬 Vegetarisch"],
      needsTime: false,
      planAhead: false,
      isNew: false,
    });
  });

  it("marks only recipes that were never cooked as new, and offers the new one first while the session has none", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const d = await deck(ac, session.id);
    const flags = Object.fromEntries(d.cards.map((c: { name: string; isNew: boolean }) => [c.name, c.isNew]));
    expect(flags).toEqual({ Kürbissuppe: true, "Ohne Zeit": false, Pasta: false, Curry: false, Risotto: false });
    expect(d.cards[0].name).toBe("Kürbissuppe"); // one new recipe per session is wanted, so the new one leads
  });

  it("flags a recipe without a time so the card can ask for it, and still offers it on a weekday", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const card = (await deck(ac, session.id)).cards.find((c: { name: string }) => c.name === "Ohne Zeit");
    expect(card).toMatchObject({ minutes: null, needsTime: true, planAhead: false });
  });

  it("keeps its order between requests and for both members, and puts plan-ahead recipes last", async () => {
    const { session } = (await start(max, [SAT, SUN])).json();
    const first = cardNames(await deck(max, session.id));
    for (let i = 0; i < 5; i++) expect(cardNames(await deck(i % 2 ? max : ac, session.id))).toEqual(first);
    expect(first.at(-1)).toBe("Pizza Biga");
  });

  it("drops a passed dish from the deck of both members, for this session only", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const passed = await pass(max, session.id, pasta);
    expect(passed.statusCode).toBe(200);
    expect(passed.json().session).toMatchObject({ id: session.id, status: "open" });
    expect(cardNames(await deck(ac, session.id))).not.toContain("Pasta");
    expect((await pass(ac, session.id, pasta)).statusCode).toBe(409);
    expect((await propose(ac, session.id, MON, pasta)).statusCode).toBe(409); // passed dishes are not proposed either

    await call("POST", `/sessions/${session.id}/close`, max);
    const { session: later } = (await start(max, [MON, TUE])).json();
    expect(cardNames(await deck(max, later.id))).toContain("Pasta");
  });

  it("answers 404 for the deck of an unknown or ended session, and for passing an unknown recipe", async () => {
    expect((await call("GET", "/sessions/unknown/deck", max)).statusCode).toBe(404);
    const { session } = (await start(max, [MON, TUE])).json();
    expect((await call("POST", `/sessions/${session.id}/passes`, max, { recipeId: 99 })).statusCode).toBe(404);
    expect((await call("POST", `/sessions/${session.id}/passes`, max, { recipeId: "x" })).statusCode).toBe(400);
    expect((await call("POST", `/sessions/${session.id}/passes`, max, { recipeId: "3" })).statusCode).toBe(400);
    expect((await call("POST", `/sessions/${session.id}/passes`, max, { recipeId: 1.5 })).statusCode).toBe(400);
    await call("POST", `/sessions/${session.id}/close`, max);
    expect((await call("GET", `/sessions/${session.id}/deck`, max)).statusCode).toBe(404);
  });

  it("serves a recipe's photo with its type, cacheable by the browser, and 404 without one", async () => {
    const res = await call("GET", "/recipes/1/photo", max);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toContain("max-age");
    expect([...res.rawPayload]).toEqual([255, 216, 1]);
    expect((await call("GET", "/recipes/2/photo", max)).statusCode).toBe(404);
    expect((await call("GET", "/recipes/abc/photo", max)).statusCode).toBe(400);
    expect((await call("GET", "/recipes/1.5/photo", max)).statusCode).toBe(400);
  });
});

describe("shaping the plan over HTTP", () => {
  const agree = async (id: string, date: string, recipe: Recipe) => {
    const proposed = await propose(max, id, date, recipe);
    const proposal = pending(proposed.json().session)[0]!;
    return (await decide(ac, id, proposal.id, "accept")).json().session;
  };
  const day = (session: { days: { date: string }[] }, date: string) => session.days.find((d) => d.date === date);
  const leftovers = (as: typeof max, id: string, date: string) =>
    call("POST", `/sessions/${id}/days/${date}/leftovers`, as);
  const reopen = (as: typeof max, id: string, date: string) => call("POST", `/sessions/${id}/days/${date}/reopen`, as);
  const swap = (as: typeof max, id: string, a: string, b: string) => call("POST", `/sessions/${id}/swap`, as, { a, b });
  const move = (as: typeof max, id: string, from: string, to: string) =>
    call("POST", `/sessions/${id}/move`, as, { from, to });

  it("needs a signed-in member for every route", async () => {
    for (const url of [
      "/sessions/x/days/2026-11-02/leftovers",
      "/sessions/x/days/2026-11-02/reopen",
      "/sessions/x/swap",
      "/sessions/x/move",
    ]) {
      expect((await call("POST", url)).statusCode, url).toBe(401);
    }
  });

  it("marks an open day as leftovers and reopens it, for both members", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const marked = await leftovers(max, session.id, MON);
    expect(marked.statusCode).toBe(200);
    expect(day(marked.json().session, MON)).toMatchObject({ status: "leftovers" });
    expect(day(await sessionOf(ac), MON)).toMatchObject({ status: "leftovers" });
    expect((await eligible(ac, session.id)).date).toBe(TUE);
    const back = await reopen(ac, session.id, MON);
    expect(day(back.json().session, MON)).toMatchObject({ status: "open" });
    expect((await eligible(max, session.id)).date).toBe(MON);
  });

  it("reopens an agreed day: the dish is free again and the day is offered again", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    await agree(session.id, MON, pasta);
    const back = await reopen(max, session.id, MON);
    expect(day(back.json().session, MON)).toEqual({ date: MON, status: "open" });
    expect((await eligible(max, session.id)).recipes.map((r: { name: string }) => r.name)).toContain("Pasta");
  });

  it("refuses to change a day while a proposal waits for an answer", async () => {
    const { session } = (await start(max, [MON, TUE, SAT])).json();
    await agree(session.id, MON, pasta);
    await propose(max, session.id, TUE, risotto);
    for (const res of [
      await leftovers(ac, session.id, TUE),
      await reopen(ac, session.id, MON),
      await move(ac, session.id, MON, SAT),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "proposal_already_pending" });
    }
    expect((await leftovers(ac, session.id, SAT)).statusCode).toBe(200);
  });

  it("frees the dates of a discarded plan: the same day can be agreed again in the next session", async () => {
    const first = (await start(max, [MON, TUE])).json().session;
    await agree(first.id, MON, pasta);
    await call("POST", `/sessions/${first.id}/close`, max);
    const next = (await start(max, [MON, TUE])).json().session;
    const agreed = await agree(next.id, MON, pasta);
    expect(day(agreed, MON)).toMatchObject({ status: "planned", recipe: { name: "Pasta" } });
  });

  it("swaps two agreed dishes and refuses a long one on a weekday, with the reason", async () => {
    const { session } = (await start(max, [MON, SAT, SUN])).json();
    await agree(session.id, MON, pasta);
    await agree(session.id, SAT, braten);
    const refused = await swap(ac, session.id, MON, SAT);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({ error: "too_long_for_weekday" });
    const sun = await agree(session.id, SUN, curry);
    expect(day(sun, SUN)).toMatchObject({ status: "planned" });
    const swapped = await swap(ac, session.id, SAT, SUN);
    expect(swapped.statusCode).toBe(200);
    expect(day(swapped.json().session, SAT)).toMatchObject({ recipe: { name: "Curry" } });
    expect(day(swapped.json().session, SUN)).toMatchObject({ recipe: { name: "Schmorbraten" } });
  });

  it("moves an agreed dish onto an open day and frees the old one", async () => {
    const { session } = (await start(max, [MON, SAT, SUN])).json();
    await agree(session.id, MON, pasta);
    await agree(session.id, SAT, braten);
    expect((await move(max, session.id, SAT, MON)).statusCode).toBe(409); // MON is agreed, not open
    const moved = await move(max, session.id, SAT, SUN);
    expect(moved.statusCode).toBe(200);
    expect(day(moved.json().session, SUN)).toMatchObject({ status: "planned", recipe: { name: "Schmorbraten" } });
    expect(day(moved.json().session, SAT)).toEqual({ date: SAT, status: "open" });
    const weekend = await move(max, session.id, MON, SAT);
    expect(weekend.statusCode).toBe(200); // pasta may go to a weekend day
  });

  it("refuses a long dish on an open weekday with the reason", async () => {
    const { session } = (await start(max, [MON, SAT, SUN])).json();
    await agree(session.id, MON, pasta);
    await agree(session.id, SAT, braten);
    await reopen(max, session.id, MON);
    const refused = await move(max, session.id, SAT, MON);
    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toEqual({ error: "too_long_for_weekday" });
  });

  it("answers 400, 404 and 409 for malformed or impossible requests", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    expect((await leftovers(max, session.id, "tomorrow")).statusCode).toBe(400);
    expect((await call("POST", `/sessions/${session.id}/swap`, max, { a: MON })).statusCode).toBe(400);
    expect((await call("POST", `/sessions/${session.id}/move`, max, { from: MON, to: "x" })).statusCode).toBe(400);
    expect((await leftovers(max, "nope", MON)).statusCode).toBe(404);
    expect((await leftovers(max, session.id, "2026-12-24")).statusCode).toBe(404);
    expect((await reopen(max, session.id, MON)).json()).toEqual({ error: "day_already_open" });
    expect((await swap(max, session.id, MON, MON)).json()).toEqual({ error: "same_day" });
    expect((await swap(max, session.id, MON, TUE)).json()).toEqual({ error: "day_not_planned" });
    expect((await move(max, session.id, MON, TUE)).json()).toEqual({ error: "day_not_planned" });
  });

  it("cannot be done once the session was discarded", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    await call("POST", `/sessions/${session.id}/close`, max);
    expect((await leftovers(max, session.id, MON)).json()).toEqual({ error: "session_not_open" });
  });
});

describe("finalizing over HTTP", () => {
  const finalize = (as: typeof max | undefined, id: string, payload?: unknown) =>
    call("POST", `/sessions/${id}/finalize`, as, payload);
  const retry = (as: typeof max | undefined, id: string, payload?: unknown) =>
    call("POST", `/sessions/${id}/export/retry`, as, payload);
  const preview = (as: typeof max | undefined, id: string) => call("GET", `/sessions/${id}/finalize-preview`, as);

  /** Two agreed days: Pasta on Monday, Curry on Tuesday. */
  async function planned() {
    const { session } = (await start(max, [MON, TUE])).json();
    for (const [date, recipe] of [
      [MON, pasta],
      [TUE, curry],
    ] as const) {
      const proposed = await call("POST", `/sessions/${session.id}/proposals`, max, { date, recipeId: recipe.id });
      const id = proposed.json().session.proposals.find((p: { status: string }) => p.status === "pending").id;
      expect((await call("POST", `/sessions/${session.id}/proposals/${id}/accept`, ac)).statusCode).toBe(200);
    }
    return session.id as string;
  }

  it("needs a signed-in member for every route", async () => {
    expect((await preview(undefined, "x")).statusCode).toBe(401);
    expect((await finalize(undefined, "x")).statusCode).toBe(401);
    expect((await retry(undefined, "x")).statusCode).toBe(401);
  });

  it("previews the consolidated, scaled list before anything is written", async () => {
    const id = await planned();
    const res = await preview(max, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      dinners: [
        { date: MON, recipeName: "Pasta" },
        { date: TUE, recipeName: "Curry" },
      ],
      items: [
        { name: "Zwiebel", icon: "🥬", description: "3 Stück", needsReview: false, recipes: ["Pasta", "Curry"] },
        { name: "Mehl", icon: null, description: "400 g", needsReview: false, recipes: ["Pasta"] },
        { name: "Salz", icon: null, description: "etwas", needsReview: true, recipes: ["Curry"] },
      ],
    });
    expect(sent.entries).toEqual([]);
  });

  it("leaves the ingredients the members have in stock off the list that is sent", async () => {
    const id = await planned();
    const res = await finalize(ac, id, { skip: ["zwiebel", "Unbekannt"] });
    expect(res.statusCode).toBe(200);
    expect(res.json().session.export.list.items.map((i: { name: string }) => i.name)).toEqual(["Mehl", "Salz"]);
    expect(sent.batches.flat().map((i) => i.name)).toEqual(["Mehl", "Salz"]);
  });

  it("refuses a skip list that is not a list of names", async () => {
    const id = await planned();
    expect((await finalize(ac, id, { skip: "Zwiebel" })).statusCode).toBe(400);
    expect((await finalize(ac, id, { skip: [1] })).statusCode).toBe(400);
    expect((await sessionOf(ac)).status).toBe("open");
  });

  it("finalizes: both phones see the finished export, and the session leaves the board", async () => {
    const id = await planned();
    const res = await finalize(ac, id);
    expect(res.statusCode).toBe(200);
    const { session } = res.json();
    expect(session).toMatchObject({
      status: "finalized",
      export: {
        complete: true,
        failure: null,
        days: [
          { date: MON, status: "done" },
          { date: TUE, status: "done" },
        ],
        list: { status: "done" },
      },
    });
    expect(sent.entries.map((e) => [e.recipeId, e.date, e.portions])).toEqual([
      [1, MON, 2],
      [3, TUE, 2],
    ]);
    expect(sent.batches).toHaveLength(1);
    expect((await call("GET", "/sessions/current", max)).json()).toEqual({ session: null });
  });

  it("keeps a failed export on the board, shows it to the other member and retries without duplicates", async () => {
    const id = await planned();
    sent.fail.push(new ExportNotApplied("HTTP 503"));
    const first = (await finalize(max, id)).json().session;
    expect(first.status).toBe("finalized");
    expect(first.export).toMatchObject({ complete: false, failure: "refused" });
    const seen = (await call("GET", "/sessions/current", ac)).json().session;
    expect(seen).toMatchObject({ id, status: "finalized", export: { complete: false, failure: "refused" } });
    const retried = await retry(ac, id);
    expect(retried.statusCode).toBe(200);
    expect(retried.json().export).toMatchObject({ complete: true, failure: null });
    expect(sent.entries).toHaveLength(2);
    expect(sent.batches).toHaveLength(1);
    expect((await retry(ac, id)).json().export.complete).toBe(true);
    expect(sent.batches).toHaveLength(1);
  });

  it("asks before sending a step again that may have arrived", async () => {
    const id = await planned();
    sent.fail.push(new Error("timeout"));
    expect((await finalize(max, id)).json().session.export.failure).toBe("unconfirmed");
    const refused = await retry(ac, id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "step_unconfirmed" });
    expect((await retry(ac, id, { resendUnconfirmed: true })).json().export.complete).toBe(true);
    expect((await retry(ac, id, { resendUnconfirmed: "yes" })).statusCode).toBe(400);
  });

  it("answers with the rule's reason and logs it when a request cannot be done", async () => {
    const { session } = (await start(max, [MON, TUE])).json();
    const empty = await finalize(max, session.id);
    expect(empty.statusCode).toBe(409);
    expect(empty.json()).toEqual({ error: "nothing_planned" });
    expect((await preview(max, session.id)).json()).toEqual({ error: "nothing_planned" });
    expect((await preview(max, "nope")).statusCode).toBe(404);
    expect((await finalize(max, "nope")).statusCode).toBe(404);
    expect((await retry(max, "nope")).statusCode).toBe(404);
    expect((await retry(max, session.id)).json()).toEqual({ error: "session_not_finalized" });
    expect(logged.some((l) => /POST \/plan\/api\/sessions\/[^ ]+\/finalize -> 409 nothing_planned/.test(l))).toBe(true);
    await call("POST", `/sessions/${session.id}/close`, max);
    const id = await planned();
    await finalize(max, id);
    expect((await finalize(ac, id)).json()).toEqual({ error: "session_not_open" });
    expect((await preview(max, id)).json()).toEqual({ error: "session_not_open" });
  });

  it("answers 502 and logs it when KitchenOwl is down while the preview reads the recipes", async () => {
    const id = await planned();
    catalogDown = true;
    const res = await preview(max, id);
    expect(res.statusCode).toBe(502);
    expect(logged.some((l) => l.includes("finalize-preview failed: KitchenOwl is down"))).toBe(true);
    expect((await finalize(max, id)).statusCode).toBe(502);
    expect((await call("GET", "/sessions/current", max)).json().session.status).toBe("open");
  });

  it("gives each line the leading emoji of its category, in the preview and in the export", async () => {
    const original = pasta.ingredients;
    (pasta as { ingredients?: Recipe["ingredients"] }).ingredients = [
      { name: "Eis", description: "1 Packung", optional: false, category: "❄️ Tiefkühl" },
      { name: "Brötchen", description: "4 Stück", optional: false, category: "🧑‍🍳 Bäckerei" },
      { name: "Kuchen", description: "1 Stück", optional: false, category: "Backen 🍰" },
      { name: "Senf", description: "etwas", optional: false, category: "  🌭 Würzen" },
    ];
    try {
      const id = await planned();
      const icons = (items: { name: string; icon: string | null }[]) =>
        Object.fromEntries(items.map((i) => [i.name, i.icon]));
      const expected = { Eis: "❄️", Brötchen: "🧑‍🍳", Kuchen: null, Senf: "🌭", Zwiebel: "🥬", Salz: null };
      expect(icons((await preview(max, id)).json().items)).toEqual(expected);
      expect(icons((await finalize(ac, id)).json().session.export.list.items)).toEqual(expected);
    } finally {
      (pasta as { ingredients?: Recipe["ingredients"] }).ingredients = original;
    }
  });

  it("refuses a skip list that is too long or names something too long", async () => {
    const id = await planned();
    expect((await finalize(ac, id, { skip: Array.from({ length: 301 }, (_, n) => `x${n}`) })).statusCode).toBe(400);
    expect((await finalize(ac, id, { skip: ["x".repeat(201)] })).statusCode).toBe(400);
    expect((await sessionOf(ac)).status).toBe("open");
    expect((await finalize(ac, id, { skip: Array.from({ length: 300 }, () => "x".repeat(200)) })).statusCode).toBe(200);
  });
});

describe("notifications over HTTP", () => {
  const phone = { endpoint: "https://push.example/abc", keys: { p256dh: "pk", auth: "au" } };
  const stored = () => new SqlitePushSubscriptions(db).all();

  it("needs a signed-in member", async () => {
    expect((await call("GET", "/push/key")).statusCode).toBe(401);
    expect((await call("POST", "/push/subscription", undefined, phone)).statusCode).toBe(401);
    expect((await call("DELETE", "/push/subscription", undefined, { endpoint: phone.endpoint })).statusCode).toBe(401);
    expect(await stored()).toEqual([]);
  });

  it("gives the server's public key to subscribe with", async () => {
    expect((await call("GET", "/push/key", max)).json()).toEqual({ key: "public-key-of-the-server" });
  });

  it("stores a phone for the member who subscribed and forgets it again", async () => {
    expect((await call("POST", "/push/subscription", ac, phone)).statusCode).toBe(204);
    expect(await stored()).toEqual([
      { member: "3", subscription: { endpoint: phone.endpoint, p256dh: "pk", auth: "au" } },
    ]);
    expect((await call("DELETE", "/push/subscription", ac, { endpoint: phone.endpoint })).statusCode).toBe(204);
    expect(await stored()).toEqual([]);
  });

  it.each([
    {},
    { endpoint: "not a url", keys: { p256dh: "pk", auth: "au" } },
    { endpoint: phone.endpoint },
    { endpoint: phone.endpoint, keys: { p256dh: "", auth: "au" } },
    { endpoint: phone.endpoint, keys: { p256dh: "pk", auth: "" } },
  ])("refuses a subscription that is not one: %j", async (body) => {
    expect((await call("POST", "/push/subscription", max, body)).statusCode).toBe(400);
    expect(await stored()).toEqual([]);
  });

  it("refuses to forget without an endpoint", async () => {
    expect((await call("DELETE", "/push/subscription", max, {})).statusCode).toBe(400);
  });

  it("sends a test message to the member who asked, and says how many phones took it", async () => {
    expect((await call("POST", "/push/test")).statusCode).toBe(401);
    tested.length = 0;
    const res = await call("POST", "/push/test", ac);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reached: 1 });
    expect(tested).toEqual(["3"]);
  });

  it("shows on the session whether the reminder went out, for the banner", async () => {
    const { session } = (await start(max, ["2026-11-02", "2026-11-03"])).json();
    expect(session.reminderSent).toBe(false);
    const sessions = new SqliteSessionRepository(db);
    const saved = (await sessions.listAll())[0]!;
    await sessions.save({ ...saved, reminderSent: true });
    expect((await call("GET", "/sessions/current", ac)).json().session.reminderSent).toBe(true);
  });

  it("asks no phone without a signed-in member, and hands the phone count on as it is", async () => {
    tested.length = 0;
    expect((await call("POST", "/push/test")).statusCode).toBe(401);
    expect(tested).toEqual([]);
    expect((await call("POST", "/push/test", ac)).json()).toEqual({ reached: 1 });
    expect((await call("POST", "/push/test", ac)).json()).toEqual({ reached: 2 });
  });
});
