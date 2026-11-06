import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerCatalogRoutes } from "./catalog-routes.js";
import type { AppOptions, RouteContext } from "./context.js";
import { registerEventRoutes } from "./event-routes.js";
import { registerFinalizeRoutes } from "./finalize-routes.js";
import { registerImportRoutes } from "./import-routes.js";
import { registerMealLogRoutes } from "./meal-log-routes.js";
import { registerPlanningRoutes } from "./planning-routes.js";
import { registerPushRoutes } from "./push-routes.js";
import { decodeSession, SESSION_COOKIE } from "./session-cookie.js";
import { serveWebApp } from "./static-files.js";

/** The HTTP interface: sets up Fastify, the logging hook and the error handler, then lets each context register its routes. */
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

  const requireMember: RouteContext["requireMember"] = (req, reply) => {
    const member = memberOf(req);
    if (!member) reply.code(401).send({ error: "not_signed_in" });
    return member;
  };
  const ctx: RouteContext = { app, api, options, now, memberOf, requireMember };
  registerAuthRoutes(ctx);
  registerImportRoutes(ctx);
  registerPushRoutes(ctx);
  registerPlanningRoutes(ctx);
  registerFinalizeRoutes(ctx);
  registerCatalogRoutes(ctx);
  registerMealLogRoutes(ctx);
  registerEventRoutes(ctx);

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
