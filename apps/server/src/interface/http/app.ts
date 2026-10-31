import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { SignIn } from "@weekly-planner/application";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { decodeSession, encodeSession, SESSION_COOKIE, SESSION_DAYS } from "./session-cookie.js";
import { serveWebApp } from "./static-files.js";

interface AppOptions {
  readonly signIn: Pick<SignIn, "execute">;
  readonly sessionSecret: string;
  readonly basePath: string;
  readonly webDist: string;
  readonly cookieSecure: boolean;
  readonly trustProxy: boolean;
  readonly now?: () => number;
}

const loginBody = z.object({ username: z.string().max(200), password: z.string().max(500) });

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

  // Unknown API paths are errors, never the web app.
  app.all(`${api}/*`, async (_req, reply) => reply.code(404).send({ error: "not_found" }));

  serveWebApp(app, options.webDist, options.basePath);
  return app;
}
