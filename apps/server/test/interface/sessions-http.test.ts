import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloseSession, GetCurrentSession, StartSession } from "@weekly-planner/application";
import { defaultPlanningConfig, memberId } from "@weekly-planner/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessEventHub } from "../../src/infrastructure/events/in-process-event-hub.js";
import { openDatabase, type Database } from "../../src/infrastructure/sqlite/database.js";
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

let db: Database;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  db = openDatabase(":memory:");
  const hub = new InProcessEventHub();
  const deps = { sessions: new SqliteSessionRepository(db), events: hub, uow: new SqliteUnitOfWork(db) };
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
    startSession: new StartSession({ ...deps, ids: new UuidGenerator(), clock }, defaultPlanningConfig),
    closeSession: new CloseSession(deps),
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
