import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type {
  AcceptProposal,
  AddLoggedMeal,
  ConfirmCooked,
  CorrectLoggedMeal,
  ListMealLog,
  ListRecipes,
  ListTakenDates,
  MarkNotCooked,
  CloseSession,
  DomainEvent,
  FinalizePlan,
  GetCurrentSession,
  GetDeck,
  GetExport,
  GetFinalizePreview,
  GetItemIcons,
  GetRecipePhoto,
  MarkLeftoverDay,
  MovePlannedDay,
  PassSuggestion,
  ListEligibleRecipes,
  ProposeRecipe,
  RefreshRecipes,
  ReopenDay,
  RetryExport,
  SendTestNotification,
  SubscribeToPush,
  UnsubscribeFromPush,
  SignIn,
  StartSession,
  SwapPlannedDays,
  VetoProposal,
  WithdrawProposal,
} from "@weekly-planner/application";
import {
  BASES,
  mealLogEntryId,
  memberId,
  needsPlanningAhead,
  exportComplete,
  isStaple,
  needsTime,
  planDate,
  proposalId,
  recipeId,
  sessionId,
  type FinalizeExport,
  type ListItem,
  type MealLogEntry,
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
  readonly withdrawProposal: Pick<WithdrawProposal, "execute">;
  readonly refreshRecipes: Pick<RefreshRecipes, "execute">;
  readonly getDeck: Pick<GetDeck, "execute">;
  readonly passSuggestion: Pick<PassSuggestion, "execute">;
  readonly markLeftoverDay: Pick<MarkLeftoverDay, "execute">;
  readonly reopenDay: Pick<ReopenDay, "execute">;
  readonly swapPlannedDays: Pick<SwapPlannedDays, "execute">;
  readonly movePlannedDay: Pick<MovePlannedDay, "execute">;
  readonly getRecipePhoto: Pick<GetRecipePhoto, "execute">;
  readonly getItemIcons: Pick<GetItemIcons, "execute">;
  readonly getExport: Pick<GetExport, "execute">;
  readonly getFinalizePreview: Pick<GetFinalizePreview, "execute">;
  readonly finalizePlan: Pick<FinalizePlan, "execute">;
  readonly retryExport: Pick<RetryExport, "execute">;
  readonly listMealLog: Pick<ListMealLog, "execute">;
  readonly listRecipes: Pick<ListRecipes, "execute">;
  readonly listTakenDates: Pick<ListTakenDates, "execute">;
  readonly confirmCooked: Pick<ConfirmCooked, "execute">;
  readonly markNotCooked: Pick<MarkNotCooked, "execute">;
  readonly correctLoggedMeal: Pick<CorrectLoggedMeal, "execute">;
  readonly addLoggedMeal: Pick<AddLoggedMeal, "execute">;
  readonly subscribeToPush: Pick<SubscribeToPush, "execute">;
  readonly sendTestNotification: Pick<SendTestNotification, "execute">;
  readonly unsubscribeFromPush: Pick<UnsubscribeFromPush, "execute">;
  /** The server's VAPID public key: a phone needs it to subscribe to notifications. */
  readonly pushPublicKey: string;
  /** Recipes longer than this need a day's lead time; the phones flag them. */
  readonly planAheadMinutes: number;
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
const recipeView = (r: Recipe, planAheadMinutes: number) => ({
  id: r.id,
  name: r.name,
  minutes: r.totalTimeMinutes,
  base: r.base,
  diet: r.diet,
  tags: r.tags ?? [],
  needsTime: needsTime(r),
  planAhead: needsPlanningAhead(r, { planAheadMinutes }),
});

const listLineView = (i: ListItem) => ({
  name: i.name,
  /** KitchenOwl's icon key of the item; the phones draw it with KitchenOwl's own icon font. */
  icon: i.icon ?? null,
  /** Salt, pepper, oil and water: the shopping list starts with these marked as at home. */
  staple: isStaple(i.name),
  description: i.description,
  needsReview: i.needsReview,
  recipes: i.recipes,
});

/** How far the export to KitchenOwl has come, for the finalize screen. */
const exportView = (e: FinalizeExport) => ({
  complete: exportComplete(e),
  failure: e.failure,
  days: e.days.map((d) => ({ date: d.date, recipeName: d.recipeName, status: d.status })),
  list: {
    status: e.list.status,
    items: e.list.items.map(listLineView),
  },
});

/** What the phones see of a session; passes and the rest join in the slices that show them. */
const sessionView = (s: PlanningSession, ahead: number, exported?: FinalizeExport | null) => ({
  ...(exported ? { export: exportView(exported) } : {}),
  id: s.id,
  status: s.status,
  startedBy: s.startedBy,
  reminderSent: s.reminderSent,
  days: s.days.map((d) => ({
    date: d.date,
    status: d.status,
    ...(d.recipe ? { recipe: recipeView(d.recipe, ahead) } : {}),
    ...(d.removedInPlanner ? { removedInPlanner: true } : {}),
  })),
  proposals: s.proposals.map((p) => ({
    id: p.id,
    date: p.date,
    recipe: recipeView(p.recipe, ahead),
    proposedBy: p.proposedBy,
    status: p.status,
    ...(p.decidedBy ? { decidedBy: p.decidedBy } : {}),
  })),
});

const pushSubscriptionBody = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
});
const pushEndpointBody = z.object({ endpoint: z.string().max(1000) });

const finalizeBody = z.object({ skip: z.array(z.string().max(200)).max(300).default([]) }).default({ skip: [] });

const BASE_NAMES = z.enum(BASES);
const mealBody = z.object({ base: BASE_NAMES, recipeId: z.number().int().nullable() });
const addMealBody = mealBody.extend({ date: z.string() });
const mealLogQuery = z.object({ days: z.coerce.number().int().min(0).max(90).default(14) });

/** What the phones see of a logged meal. */
const entryView = (e: MealLogEntry, ahead: number) => ({
  id: e.id,
  date: e.date,
  base: e.base,
  recipe: e.recipe ? recipeView(e.recipe, ahead) : null,
  source: e.source,
  confirmed: e.confirmed,
});

const retryBody = z.object({ resendUnconfirmed: z.boolean().optional() }).default({});

const passBody = z.object({ recipeId: z.number().int() });
const recipeParam = z.object({ id: z.coerce.number().int() });

const proposalBody = z.object({ date: z.string(), recipeId: z.number().int() });
const swapBody = z.object({ a: z.string(), b: z.string() });
const moveBody = z.object({ from: z.string(), to: z.string() });

const COMMAND_REJECTIONS: Record<string, number> = {
  session_already_open: 409,
  session_already_closed: 409,
  unknown_session: 404,
  nothing_planned: 409,
  session_not_finalized: 409,
  export_running: 409,
  step_unconfirmed: 409,
  step_already_done: 409,
  unknown_step: 409,
  no_export: 404,
  unknown_recipe: 404,
  unknown_proposal: 404,
  unknown_day: 404,
  unknown_entry: 404,
  no_recipe: 409,
  already_confirmed: 409,
  date_in_future: 422,
  own_proposal: 403,
  not_your_proposal: 403,
  not_next_open_day: 409,
  proposal_already_pending: 409,
  proposal_not_pending: 409,
  day_not_planned: 409,
  day_already_open: 409,
  target_not_open: 409,
  same_day: 422,
  session_not_open: 409,
  day_not_open: 409,
  date_already_taken: 409,
  recipe_vetoed: 409,
  recipe_already_proposed: 409,
  recipe_passed: 409,
  already_passed: 409,
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

  app.get(`${api}/push/key`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    return { key: options.pushPublicKey };
  });

  app.post(`${api}/push/subscription`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = pushSubscriptionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const { endpoint, keys } = body.data;
    await options.subscribeToPush.execute({
      member: memberId(member.id),
      subscription: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
    });
    return reply.code(204).send();
  });

  // Answers how many phones took the message, so the app can say when none did.
  app.post(`${api}/push/test`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    return { reached: await options.sendTestNotification.execute({ member: memberId(member.id) }) };
  });

  app.delete(`${api}/push/subscription`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const body = pushEndpointBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    await options.unsubscribeFromPush.execute({ endpoint: body.data.endpoint });
    return reply.code(204).send();
  });

  app.get(`${api}/sessions/current`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const session = await options.getCurrentSession.execute();
    if (!session) return { session: null };
    const exported = session.status === "finalized" ? await options.getExport.execute({ sessionId: session.id }) : null;
    return { session: sessionView(session, options.planAheadMinutes, exported) };
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
    return reply.code(201).send({ session: sessionView(result.value, options.planAheadMinutes) });
  });

  app.post<{ Params: { id: string } }>(`${api}/sessions/:id/close`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const result = await options.closeSession.execute({
      member: memberId(member.id),
      sessionId: sessionId(req.params.id),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { session: sessionView(result.value, options.planAheadMinutes) };
  });

  app.get<{ Params: { id: string } }>(`${api}/sessions/:id/finalize-preview`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const result = await options.getFinalizePreview.execute({ sessionId: sessionId(req.params.id) });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return {
      dinners: result.value.dinners,
      items: result.value.items.map(listLineView),
    };
  });

  // The plan is finalized even when KitchenOwl could not be reached; the answer then carries the failed export.
  app.post<{ Params: { id: string } }>(`${api}/sessions/:id/finalize`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = finalizeBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.finalizePlan.execute({
      member: memberId(member.id),
      sessionId: sessionId(req.params.id),
      skip: body.data.skip,
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { session: sessionView(result.value.session, options.planAheadMinutes, result.value.export) };
  });

  app.post<{ Params: { id: string } }>(`${api}/sessions/:id/export/retry`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const body = retryBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.retryExport.execute({
      sessionId: sessionId(req.params.id),
      resendUnconfirmed: body.data.resendUnconfirmed === true,
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { export: exportView(result.value) };
  });

  app.get<{ Params: { id: string } }>(`${api}/sessions/:id/recipes`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const list = await options.listEligibleRecipes.execute({ sessionId: sessionId(req.params.id) });
    if (!list) return reply.code(404).send({ error: "not_found" });
    return { date: list.date, recipes: list.recipes.map((r) => recipeView(r, options.planAheadMinutes)) };
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
    return reply.code(201).send({ session: sessionView(result.value, options.planAheadMinutes) });
  });

  for (const [verb, useCase] of [
    ["accept", options.acceptProposal],
    ["veto", options.vetoProposal],
    ["withdraw", options.withdrawProposal],
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
        return { session: sessionView(result.value, options.planAheadMinutes) };
      },
    );
  }

  for (const [verb, useCase] of [
    ["leftovers", options.markLeftoverDay],
    ["reopen", options.reopenDay],
  ] as const) {
    app.post<{ Params: { id: string; date: string } }>(`${api}/sessions/:id/days/:date/${verb}`, async (req, reply) => {
      const member = requireMember(req, reply);
      if (!member) return reply;
      let date: ReturnType<typeof planDate>;
      try {
        date = planDate(req.params.date);
      } catch {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const result = await useCase.execute({
        member: memberId(member.id),
        sessionId: sessionId(req.params.id),
        date,
      });
      if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
      return { session: sessionView(result.value, options.planAheadMinutes) };
    });
  }

  app.post<{ Params: { id: string } }>(`${api}/sessions/:id/swap`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = swapBody.safeParse(req.body);
    let dates: [ReturnType<typeof planDate>, ReturnType<typeof planDate>];
    try {
      if (!body.success) throw new Error("invalid");
      dates = [planDate(body.data.a), planDate(body.data.b)];
    } catch {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const result = await options.swapPlannedDays.execute({
      member: memberId(member.id),
      sessionId: sessionId(req.params.id),
      a: dates[0],
      b: dates[1],
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { session: sessionView(result.value, options.planAheadMinutes) };
  });

  app.post<{ Params: { id: string } }>(`${api}/sessions/:id/move`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = moveBody.safeParse(req.body);
    let dates: [ReturnType<typeof planDate>, ReturnType<typeof planDate>];
    try {
      if (!body.success) throw new Error("invalid");
      dates = [planDate(body.data.from), planDate(body.data.to)];
    } catch {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const result = await options.movePlannedDay.execute({
      member: memberId(member.id),
      sessionId: sessionId(req.params.id),
      from: dates[0],
      to: dates[1],
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { session: sessionView(result.value, options.planAheadMinutes) };
  });

  app.get<{ Params: { id: string } }>(`${api}/sessions/:id/deck`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const deck = await options.getDeck.execute({ sessionId: sessionId(req.params.id) });
    if (!deck) return reply.code(404).send({ error: "not_found" });
    return {
      date: deck.date,
      cards: deck.cards.map((c) => ({ ...recipeView(c.recipe, options.planAheadMinutes), isNew: c.isNew })),
    };
  });

  app.post<{ Params: { id: string } }>(`${api}/sessions/:id/passes`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = passBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.passSuggestion.execute({
      member: memberId(member.id),
      sessionId: sessionId(req.params.id),
      recipeId: recipeId(body.data.recipeId),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { session: sessionView(result.value, options.planAheadMinutes) };
  });

  app.get<{ Params: { id: string } }>(`${api}/recipes/:id/photo`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const params = recipeParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const photo = await options.getRecipePhoto.execute({ recipeId: recipeId(params.data.id) });
    if (!photo) return reply.code(404).send({ error: "not_found" });
    // File names in KitchenOwl are content hashes, so a picture never changes under its recipe.
    return reply
      .header("Cache-Control", "private, max-age=86400")
      .type(photo.contentType)
      .send(Buffer.from(photo.data));
  });

  app.get(`${api}/item-icons`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const font = await options.getItemIcons.execute().catch(() => null);
    if (!font) return reply.code(404).send({ error: "not_found" });
    return reply.header("Cache-Control", "private, max-age=86400").type(font.contentType).send(Buffer.from(font.data));
  });

  app.get(`${api}/recipes`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const recipes = await options.listRecipes.execute();
    return { recipes: recipes.map((r) => recipeView(r, options.planAheadMinutes)) };
  });

  app.get(`${api}/planned-dates`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    return { dates: await options.listTakenDates.execute() };
  });

  app.get(`${api}/meal-log`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const query = mealLogQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_request" });
    const entries = await options.listMealLog.execute({ days: query.data.days });
    return { entries: entries.map((e) => entryView(e, options.planAheadMinutes)) };
  });

  app.post(`${api}/meal-log`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = addMealBody.safeParse(req.body);
    let date: ReturnType<typeof planDate>;
    try {
      if (!body.success) throw new Error("invalid");
      date = planDate(body.data.date);
    } catch {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const result = await options.addLoggedMeal.execute({
      member: memberId(member.id),
      date,
      base: body.data.base,
      recipeId: body.data.recipeId === null ? null : recipeId(body.data.recipeId),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return reply.code(201).send({ entry: entryView(result.value, options.planAheadMinutes) });
  });

  for (const [verb, useCase] of [
    ["confirm", options.confirmCooked],
    ["not-cooked", options.markNotCooked],
  ] as const) {
    app.post<{ Params: { id: string } }>(`${api}/meal-log/:id/${verb}`, async (req, reply) => {
      const member = requireMember(req, reply);
      if (!member) return reply;
      const result = await useCase.execute({ member: memberId(member.id), entryId: mealLogEntryId(req.params.id) });
      if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
      return { entry: entryView(result.value, options.planAheadMinutes) };
    });
  }

  app.post<{ Params: { id: string } }>(`${api}/meal-log/:id/correct`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = mealBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.correctLoggedMeal.execute({
      member: memberId(member.id),
      entryId: mealLogEntryId(req.params.id),
      base: body.data.base,
      recipeId: body.data.recipeId === null ? null : recipeId(body.data.recipeId),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { entry: entryView(result.value, options.planAheadMinutes) };
  });

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
