import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { CloseSession, DomainEvent, GetCurrentSession, SignIn, StartSession } from "@weekly-planner/application";
import { memberId, planDate, sessionId, type PlanningSession } from "@weekly-planner/domain";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { decodeSession, encodeSession, SESSION_COOKIE, SESSION_DAYS } from "./session-cookie.js";
import { serveWebApp } from "./static-files.js";

interface AppOptions {
  readonly signIn: Pick<SignIn, "execute">;
  readonly getCurrentSession: Pick<GetCurrentSession, "execute">;
  readonly startSession: Pick<StartSession, "execute">;
  readonly closeSession: Pick<CloseSession, "execute">;
  /** Told about every committed change; returns the way to stop listening. */
  readonly subscribe: (listener: (event: DomainEvent) => void) => () => void;
  readonly sessionSecret: string;
  readonly basePath: string;
  readonly webDist: string;
  readonly cookieSecure: boolean;
  readonly trustProxy: boolean;
  readonly now?: () => number;
}

const loginBody = z.object({ username: z.string().max(200), password: z.string().max(500) });

const startBody = z.object({ dates: z.array(z.string()).max(10) });

/** What the phones see of a session; recipes, proposals and passes join in the slices that show them. */
const sessionView = (s: PlanningSession) => ({
  id: s.id,
  status: s.status,
  startedBy: s.startedBy,
  days: s.days.map((d) => ({ date: d.date, status: d.status })),
});

const COMMAND_REJECTIONS: Record<string, number> = {
  session_already_open: 409,
  session_already_closed: 409,
  unknown_session: 404,
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

  // Unknown API paths are errors, never the web app.
  app.all(`${api}/*`, async (_req, reply) => reply.code(404).send({ error: "not_found" }));

  serveWebApp(app, options.webDist, options.basePath);
  return app;
}
