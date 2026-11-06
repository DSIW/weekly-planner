import { memberId, planDate, proposalId, recipeId, sessionId } from "@weekly-planner/domain";
import { z } from "zod";
import { COMMAND_REJECTIONS, type RouteContext } from "./context.js";
import { recipeView, sessionView } from "./views.js";

const startBody = z.object({ dates: z.array(z.string()).max(10) });
const passBody = z.object({ recipeId: z.number().int() });
const proposalBody = z.object({ date: z.string(), recipeId: z.number().int() });
const swapBody = z.object({ a: z.string(), b: z.string() });
const moveBody = z.object({ from: z.string(), to: z.string() });

export function registerPlanningRoutes(ctx: RouteContext): void {
  const { app, api, options, requireMember } = ctx;
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
    ["agree", options.agreeInPerson],
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
}
