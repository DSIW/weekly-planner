import { z } from "zod";
import { encodeSession, SESSION_COOKIE, SESSION_DAYS } from "./session-cookie.js";
import type { RouteContext } from "./context.js";

const loginBody = z.object({ username: z.string().max(200), password: z.string().max(500) });
const REJECTIONS: Record<string, { status: number; error: string }> = {
  invalid_credentials: { status: 401, error: "invalid_credentials" },
  missing_credentials: { status: 400, error: "missing_credentials" },
  not_in_household: { status: 403, error: "not_in_household" },
};

export function registerAuthRoutes(ctx: RouteContext): void {
  const { app, api, options, memberOf, requireMember, now } = ctx;
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

  app.get(`${api}/links`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const { kitchenowl, householdId } = options.links ?? { kitchenowl: null, householdId: 0 };
    if (kitchenowl === null) return { links: null };
    const home = `${kitchenowl}/household/${householdId}`;
    return {
      links: {
        recipe: `${home}/recipes/details/{id}`,
        list: `${home}/items`,
        recipes: `${home}/recipes`,
        home,
      },
    };
  });
}
