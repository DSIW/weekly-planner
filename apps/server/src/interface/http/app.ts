import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type {
  AcceptProposal,
  CloseSession,
  DomainEvent,
  GetCurrentSession,
  ListEligibleRecipes,
  ProposeRecipe,
  RefreshRecipes,
  SignIn,
  StartSession,
  VetoProposal,
} from "@weekly-planner/application";
import {
  memberId,
  needsTime,
  planDate,
  proposalId,
  recipeId,
  sessionId,
  type PlanningSession,
  type Recipe,
} from "@weekly-planner/domain";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { decodeSession, encodeSession, SESSION_COOKIE, SESSION_DAYS } from "./session-cookie.js";
import { serveWebApp } from "./static-files.js";

interface AppOptions {
  readonly signIn: Pick<SignIn, "execute">;
  readonly getCurrentSession: Pick<GetCurrentSession, "execute">;
  readonly startSession: Pick<StartSession, "execute">;
  readonly closeSession: Pick<CloseSession, "execute">;
  readonly listEligibleRecipes: Pick<ListEligibleRecipes, "execute">;
  readonly proposeRecipe: Pick<ProposeRecipe, "execute">;
  readonly acceptProposal: Pick<AcceptProposal, "execute">;
  readonly vetoProposal: Pick<VetoProposal, "execute">;
  readonly refreshRecipes: Pick<RefreshRecipes, "execute">;
  /** Told about every committed change; returns the way to stop listening. */
  readonly subscribe: (listener: (event: DomainEvent) => void) => () => void;
  readonly sessionSecret: string;
  readonly basePath: string;
  readonly webDist: string;
  readonly cookieSecure: boolean;
  readonly trustProxy: boolean;
  readonly now?: () => number;
  /** Where failed API calls are written, one line each; defaults to the console. */
  readonly log?: (line: string) => void;
}

const loginBody = z.object({ username: z.string().max(200), password: z.string().max(500) });

const startBody = z.object({ dates: z.array(z.string()).max(10) });

/** What the phones see of a recipe: enough to choose by. */
const recipeView = (r: Recipe) => ({
  id: r.id,
  name: r.name,
  minutes: r.totalTimeMinutes,
  base: r.base,
  diet: r.diet,
  needsTime: needsTime(r),
});

/** What the phones see of a session; passes and the rest join in the slices that show them. */
const sessionView = (s: PlanningSession) => ({
  id: s.id,
  status: s.status,
  startedBy: s.startedBy,
  days: s.days.map((d) => ({ date: d.date, status: d.status, ...(d.recipe ? { recipe: recipeView(d.recipe) } : {}) })),
  proposals: s.proposals.map((p) => ({
    id: p.id,
    date: p.date,
    recipe: recipeView(p.recipe),
    proposedBy: p.proposedBy,
    status: p.status,
    ...(p.decidedBy ? { decidedBy: p.decidedBy } : {}),
  })),
});

const proposalBody = z.object({ date: z.string(), recipeId: z.number().int() });

const COMMAND_REJECTIONS: Record<string, number> = {
  session_already_open: 409,
  session_already_closed: 409,
  unknown_session: 404,
  unknown_recipe: 404,
  unknown_proposal: 404,
  unknown_day: 404,
  own_proposal: 403,
  not_next_open_day: 409,
  proposal_already_pending: 409,
  proposal_not_pending: 409,
  session_not_open: 409,
  day_not_open: 409,
  date_already_taken: 409,
  recipe_vetoed: 409,
  recipe_passed: 409,
  recipe_already_planned: 409,
  not_a_dinner: 422,
  too_long_for_weekday: 422,
  duplicate_dates: 422,
  too_few_days: 422,
  too_many_days: 422,
};

const REJECTIONS: Record<string, { status: number; error: string }> = {
  invalid_credentials: { status: 401, error: "invalid_credentials" },
  missing_credentials: { status: 400, error: "missing_credentials" },
  not_in_household: { status: 403, error: "not_in_household" },
};

/** The HTTP interface: sign in and out, who am I, health, and the web app itself. */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const now = options.now ?? Date.now;
  const app = Fastify({ trustProxy: options.trustProxy, logger: false });
  await app.register(cookie, { secret: options.sessionSecret });
  await app.register(rateLimit, { global: false });

  const memberOf = (req: FastifyRequest) => {
    const raw = req.cookies[SESSION_COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : undefined;
    return unsigned?.valid && unsigned.value ? decodeSession(unsigned.value, now()) : null;
  };

  const api = `${options.basePath}/api`;

  // Every failed API call leaves one line (method, path without query, status, reason): without it a rejected
  // request is invisible on the server. Never the body, headers or cookies. "Nobody is signed in" on /me is normal.
  const log = options.log ?? ((line: string) => console.warn(line));
  app.addHook("onSend", async (req, reply, payload) => {
    const path = req.url.split("?")[0] ?? "";
    if (reply.statusCode < 400 || !path.startsWith(`${api}/`)) return payload;
    if (path === `${api}/me` && reply.statusCode === 401) return payload;
    let reason = "";
    try {
      const body = JSON.parse(String(payload)) as { error?: unknown; message?: unknown };
      reason = String(
        typeof body.error === "string" && body.error !== "Bad Request" ? body.error : (body.message ?? ""),
      );
    } catch {
      // Not JSON; the status says enough.
    }
    log(`${req.method} ${path} -> ${reply.statusCode}${reason ? ` ${reason.slice(0, 120)}` : ""}`);
    return payload;
  });

  app.get(`${api}/health`, async () => ({ status: "ok" }));

  app.post(`${api}/login`, { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    let result: Awaited<ReturnType<typeof options.signIn.execute>>;
    try {
      result = await options.signIn.execute(body.data);
    } catch (error) {
      // A failed KitchenOwl call (down, expired service token) is not the person's fault and must not look like a
      // wrong password; the status of the failed call would otherwise become ours.
      console.error(`sign-in failed: ${error instanceof Error ? error.message : String(error)}`);
      return reply.code(502).send({ error: "unavailable" });
    }
    if (!result.ok) {
      const r = REJECTIONS[result.reason] ?? { status: 401, error: "invalid_credentials" };
      return reply.code(r.status).send({ error: r.error });
    }
    reply.setCookie(SESSION_COOKIE, encodeSession(result.value, now()), {
      signed: true,
      httpOnly: true,
      sameSite: "lax",
      secure: options.cookieSecure,
      path: options.basePath === "" ? "/" : options.basePath,
      maxAge: SESSION_DAYS * 86_400,
    });
    return { member: result.value };
  });

  app.post(`${api}/logout`, async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: options.basePath === "" ? "/" : options.basePath });
    return reply.code(204).send();
  });

  app.get(`${api}/me`, async (req, reply) => {
    const member = memberOf(req);
    return member ? { member } : reply.code(401).send({ error: "not_signed_in" });
  });

  const requireMember = (req: FastifyRequest, reply: { code(n: number): { send(b: unknown): unknown } }) => {
    const member = memberOf(req);
    if (!member) reply.code(401).send({ error: "not_signed_in" });
    return member;
  };

  app.get(`${api}/sessions/current`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const session = await options.getCurrentSession.execute();
    return { session: session ? sessionView(session) : null };
  });

  app.post(`${api}/sessions`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = startBody.safeParse(req.body);
    let dates: ReturnType<typeof planDate>[] = [];
    try {
      if (body.success) dates = body.data.dates.map(planDate);
    } catch {
      return reply.code(400).send({ error: "invalid_request" });
    }
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.startSession.execute({ member: memberId(member.id), dates });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return reply.code(201).send({ session: sessionView(result.value) });
  });

  app.post<{ Params: { id: string } }>(`${api}/sessions/:id/close`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const result = await options.closeSession.execute({
      member: memberId(member.id),
      sessionId: sessionId(req.params.id),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { session: sessionView(result.value) };
  });

  app.get<{ Params: { id: string } }>(`${api}/sessions/:id/recipes`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const list = await options.listEligibleRecipes.execute({ sessionId: sessionId(req.params.id) });
    if (!list) return reply.code(404).send({ error: "not_found" });
    return { date: list.date, recipes: list.recipes.map(recipeView) };
  });

  app.post<{ Params: { id: string } }>(`${api}/sessions/:id/proposals`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = proposalBody.safeParse(req.body);
    let date: ReturnType<typeof planDate>;
    try {
      if (!body.success) throw new Error("invalid");
      date = planDate(body.data.date);
    } catch {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const result = await options.proposeRecipe.execute({
      member: memberId(member.id),
      sessionId: sessionId(req.params.id),
      date,
      recipeId: recipeId(body.data.recipeId),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return reply.code(201).send({ session: sessionView(result.value) });
  });

  for (const [verb, useCase] of [
    ["accept", options.acceptProposal],
    ["veto", options.vetoProposal],
  ] as const) {
    app.post<{ Params: { id: string; proposalId: string } }>(
      `${api}/sessions/:id/proposals/:proposalId/${verb}`,
      async (req, reply) => {
        const member = requireMember(req, reply);
        if (!member) return reply;
        const result = await useCase.execute({
          member: memberId(member.id),
          sessionId: sessionId(req.params.id),
          proposalId: proposalId(req.params.proposalId),
        });
        if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
        return { session: sessionView(result.value) };
      },
    );
  }

  app.post(`${api}/recipes/refresh`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    await options.refreshRecipes.execute();
    return reply.code(204).send();
  });

  // Server-Sent Events: a signal that something changed; the client refetches what it shows.
  const streams = new Set<{ end(): void }>();
  app.addHook("onClose", async () => {
    for (const stream of streams) stream.end();
  });
  app.get(`${api}/events`, (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\nevent: ready\ndata: {}\n\n");
    const unsubscribe = options.subscribe((event) =>
      res.write(`event: changed\ndata: ${JSON.stringify({ type: event.type })}\n\n`),
    );
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
    streams.add(res);
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(res);
    });
    return reply;
  });

  // What the routes do not catch is a failure of something we depend on (KitchenOwl, SQLite). It must not borrow that
  // dependency's status code: a 401 from KitchenOwl would otherwise look like "you are not signed in" to the client.
  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, req, reply) => {
    // Errors of Fastify and its plugins (bad JSON, rate limit) carry `statusCode`; a dependency's own error does not.
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply
        .code(error.statusCode)
        .send({ error: error.code?.toLowerCase() ?? "request_failed", message: error.message });
    }
    log(`${req.method} ${req.url.split("?")[0]} failed: ${error.message}`);
    return reply.code(502).send({ error: "unavailable" });
  });

  // Unknown API paths are errors, never the web app.
  app.all(`${api}/*`, async (_req, reply) => reply.code(404).send({ error: "not_found" }));

  serveWebApp(app, options.webDist, options.basePath);
  return app;
}
