import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SignIn } from "@weekly-planner/application";
import { memberId } from "@weekly-planner/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/interface/http/app.js";
import { decodeSession, encodeSession } from "../../src/interface/http/session-cookie.js";

const max = { id: memberId("2"), name: "Max" };
let attempts: { username: string; password: string }[];
const signIn: Pick<SignIn, "execute"> = {
  execute: async (cmd) => {
    attempts.push(cmd);
    if (cmd.username === "outsider") return { ok: false, reason: "not_in_household" };
    if (cmd.password === "") return { ok: false, reason: "missing_credentials" };
    return cmd.password === "right" ? { ok: true, value: max } : { ok: false, reason: "invalid_credentials" };
  },
};

/** The session routes have their own tests; these stand-ins keep the sign-in tests focused. */
const noSessions = {
  getCurrentSession: { execute: async () => null },
  startSession: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  closeSession: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  listEligibleRecipes: { execute: async () => null },
  proposeRecipe: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  acceptProposal: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  agreeInPerson: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  vetoProposal: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  withdrawProposal: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  refreshRecipes: { execute: async () => {} },
  getDeck: { execute: async () => null },
  passSuggestion: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  getRecipePhoto: { execute: async () => null },
  getItemIcons: { execute: async () => null },
  getExport: { execute: async () => null },
  getFinalizePreview: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  finalizePlan: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  retryExport: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  subscribeToPush: { execute: async () => {} },
  listMealLog: { execute: async () => [] },
  listRecipes: { execute: async () => [] },
  listTakenDates: { execute: async () => [] },
  confirmCooked: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  markNotCooked: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  removeLoggedMeal: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  correctLoggedMeal: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  addLoggedMeal: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  sendTestNotification: { execute: async () => 0 },
  unsubscribeFromPush: { execute: async () => {} },
  pushPublicKey: "unused",
  markLeftoverDay: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  reopenDay: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  swapPlannedDays: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  movePlannedDay: { execute: async () => ({ ok: false as const, reason: "unused" }) },
  planAheadMinutes: 360,
  subscribe: () => () => {},
};

let webDist: string;
let clock: number;
beforeEach(() => {
  logged = [];
  attempts = [];
  clock = 1_000_000;
  webDist = mkdtempSync(join(tmpdir(), "web-"));
  mkdirSync(join(webDist, "assets"));
  writeFileSync(join(webDist, "index.html"), "<html>planner</html>");
  writeFileSync(join(webDist, "assets", "app-123.js"), "console.log(1)");
  writeFileSync(join(webDist, "sw.js"), "// sw");
});

let logged: string[];
const app = (
  over: {
    basePath?: string;
    signIn?: Pick<SignIn, "execute">;
    links?: { kitchenowl: string | null; householdId: number };
  } = {},
) =>
  buildApp({
    ...noSessions,
    signIn,
    sessionSecret: "x".repeat(32),
    basePath: "/plan",
    webDist,
    cookieSecure: false,
    trustProxy: false,
    now: () => clock,
    log: (line) => logged.push(line),
    ...over,
  });

const login = async (a: Awaited<ReturnType<typeof app>>, password = "right") =>
  a.inject({ method: "POST", url: "/plan/api/login", payload: { username: "dsiw", password } });
const sessionCookie = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === "session");

describe("sign in", () => {
  it("returns the member and sets a signed, httpOnly session cookie scoped to the base path", async () => {
    const res = await login(await app());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ member: max });
    expect(res.cookies[0]).toMatchObject({ name: "session", httpOnly: true, sameSite: "Lax", path: "/plan" });
    expect(res.cookies[0]?.value).toContain("."); // signed
  });

  it("reports a failing KitchenOwl lookup as unavailable, never as a wrong password", async () => {
    // KitchenOwlError carries the HTTP status of the failed call; a 401 for the service token must not leak through.
    const failing: Pick<SignIn, "execute"> = {
      execute: async () => {
        throw Object.assign(new Error("KitchenOwl GET /household/2 failed with HTTP 401"), { status: 401 });
      },
    };
    const res = await login(await app({ signIn: failing }));
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: "unavailable" });
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("marks the cookie secure when configured", async () => {
    const res = await login(
      await app().then(() =>
        buildApp({
          ...noSessions,
          signIn,
          sessionSecret: "x".repeat(32),
          basePath: "/plan",
          webDist,
          cookieSecure: true,
          trustProxy: false,
        }),
      ),
    );
    expect(res.cookies[0]).toMatchObject({ secure: true });
  });

  it.each([
    ["wrong password", "wrong", 401, "invalid_credentials"],
    ["empty password", "", 400, "missing_credentials"],
  ])("rejects %s without a cookie", async (_n, password, status, error) => {
    const res = await login(await app(), password);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error });
    expect(sessionCookie(res)).toBeUndefined();
  });

  it("answers 403 for a KitchenOwl user outside the household", async () => {
    const res = await (await app()).inject({
      method: "POST",
      url: "/plan/api/login",
      payload: { username: "outsider", password: "x" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "not_in_household" });
  });

  it("rejects a malformed body without calling the use case", async () => {
    const res = await (await app()).inject({ method: "POST", url: "/plan/api/login", payload: { username: 1 } });
    expect(res.statusCode).toBe(400);
    expect(attempts).toEqual([]);
  });

  it("limits login attempts per client", async () => {
    const a = await app();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await login(a, "wrong")).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[11]).toBe(429);
  });
});

describe("who am I", () => {
  it("is 401 without a cookie, with a forged cookie, and after the session expired", async () => {
    const a = await app();
    expect((await a.inject({ method: "GET", url: "/plan/api/me" })).statusCode).toBe(401);
    expect(
      (await a.inject({ method: "GET", url: "/plan/api/me", cookies: { session: encodeSession(max, clock) } }))
        .statusCode,
    ).toBe(401); // unsigned
    const cookie = sessionCookie(await login(a))!.value;
    expect((await a.inject({ method: "GET", url: "/plan/api/me", cookies: { session: cookie } })).statusCode).toBe(200);
    clock += 31 * 86_400_000;
    expect((await a.inject({ method: "GET", url: "/plan/api/me", cookies: { session: cookie } })).statusCode).toBe(401);
  });

  it("returns the member for a valid session", async () => {
    const a = await app();
    const cookie = sessionCookie(await login(a))!.value;
    const res = await a.inject({ method: "GET", url: "/plan/api/me", cookies: { session: cookie } });
    expect(res.json()).toEqual({ member: max });
  });

  it("logout clears the cookie", async () => {
    const res = await (await app()).inject({ method: "POST", url: "/plan/api/logout" });
    expect(res.statusCode).toBe(204);
    expect(res.cookies[0]).toMatchObject({ name: "session", value: "" });
  });
});

describe("session cookie value", () => {
  it("round-trips and rejects garbage and expired values", () => {
    expect(decodeSession(encodeSession(max, 0), 1)).toEqual(max);
    expect(decodeSession("not-base64-json", 1)).toBeNull();
    expect(decodeSession(encodeSession(max, 0), 31 * 86_400_000)).toBeNull();
  });
});

describe("health and web app", () => {
  it("reports health without a session", async () => {
    expect((await (await app()).inject({ method: "GET", url: "/plan/api/health" })).json()).toEqual({ status: "ok" });
  });

  it("serves index.html for the base path and client-side routes, files with cache headers", async () => {
    const a = await app();
    expect((await a.inject({ method: "GET", url: "/plan/" })).body).toContain("planner");
    expect((await a.inject({ method: "GET", url: "/plan/some/route" })).body).toContain("planner");
    expect((await a.inject({ method: "GET", url: "/plan" })).statusCode).toBe(302);
    const asset = await a.inject({ method: "GET", url: "/plan/assets/app-123.js" });
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect(asset.headers["content-type"]).toContain("javascript");
    expect((await a.inject({ method: "GET", url: "/plan/sw.js" })).headers["cache-control"]).toBe("no-cache");
  });

  it("returns 404 for a missing file and for unknown API paths, never the app", async () => {
    const a = await app();
    expect((await a.inject({ method: "GET", url: "/plan/assets/missing.js" })).statusCode).toBe(404);
    expect((await a.inject({ method: "GET", url: "/plan/api/nope" })).statusCode).toBe(404);
  });

  it("does not serve files outside the web root", async () => {
    const a = await app();
    for (const url of [
      "/plan/..%2f..%2fetc%2fpasswd",
      "/plan/..%2f..%2f..%2f..%2fetc%2fpasswd.txt",
      "/plan/%2e%2e/%2e%2e/etc/passwd",
    ]) {
      const res = await a.inject({ method: "GET", url });
      expect(res.body).not.toContain("root:");
      expect(res.body === "<html>planner</html>" || res.statusCode === 404 || res.statusCode === 400).toBe(true);
    }
  });

  it("works at the root when no base path is configured", async () => {
    const a = await app({ basePath: "" });
    expect((await a.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    expect((await a.inject({ method: "GET", url: "/" })).body).toContain("planner");
  });
});

describe("the error log", () => {
  it("records every failed API call with method, path, status and the reason, nothing else", async () => {
    const a = await app();
    await a.inject({ method: "POST", url: "/plan/api/login", payload: { username: "dsiw", password: "secret-pw" } });
    await a.inject({
      method: "POST",
      url: "/plan/api/login",
      payload: "not json",
      headers: { "content-type": "application/json" },
    });
    await a.inject({ method: "GET", url: "/plan/api/nope?token=abc" });
    expect(logged).toEqual([
      "POST /plan/api/login -> 401 invalid_credentials",
      expect.stringMatching(/^POST \/plan\/api\/login -> 400 /),
      "GET /plan/api/nope -> 404 not_found",
    ]);
    expect(logged.join("\n")).not.toMatch(/secret-pw|token|abc/);
  });

  it("stays quiet about successes, the normal 'nobody is signed in' answer of /me, and the web app", async () => {
    const a = await app();
    await login(a);
    await a.inject({ method: "GET", url: "/plan/api/health" });
    await a.inject({ method: "GET", url: "/plan/api/me" });
    await a.inject({ method: "GET", url: "/plan/" });
    await a.inject({ method: "GET", url: "/plan/assets/missing.js" });
    expect(logged).toEqual([]);
  });
});

describe("links to KitchenOwl", () => {
  const get = async (links?: { kitchenowl: string | null; householdId: number }) => {
    const a = await app(links ? { links } : {});
    const cookie = sessionCookie(await login(a))!;
    return a.inject({ method: "GET", url: "/plan/api/links", cookies: { session: cookie.value } });
  };

  it("gives templates for a recipe and the shopping list, on KitchenOwl's own address", async () => {
    expect((await get({ kitchenowl: "https://ko.test", householdId: 2 })).json()).toEqual({
      links: {
        recipe: "https://ko.test/household/2/recipes/details/{id}",
        list: "https://ko.test/household/2/items",
      },
    });
  });

  it("works on a shared host (empty address) and gives none when KitchenOwl's address is not set", async () => {
    expect((await get({ kitchenowl: "", householdId: 2 })).json().links.list).toBe("/household/2/items");
    expect((await get({ kitchenowl: null, householdId: 2 })).json()).toEqual({ links: null });
    expect((await get()).json()).toEqual({ links: null });
  });

  it("is for signed-in members only", async () => {
    const res = await (await app()).inject({ method: "GET", url: "/plan/api/links" });
    expect(res.statusCode).toBe(401);
  });
});
