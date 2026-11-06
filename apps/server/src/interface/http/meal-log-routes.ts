import { BASES, mealLogEntryId, memberId, planDate, recipeId } from "@weekly-planner/domain";
import { z } from "zod";
import { COMMAND_REJECTIONS, type RouteContext } from "./context.js";
import { entryView } from "./views.js";

const BASE_NAMES = z.enum(BASES);
const mealBody = z.object({ base: BASE_NAMES, recipeId: z.number().int().nullable() });
const addMealBody = mealBody.extend({ date: z.string() });
const mealLogQuery = z.object({ days: z.coerce.number().int().min(0).max(90).default(14) });

export function registerMealLogRoutes(ctx: RouteContext): void {
  const { app, api, options, requireMember } = ctx;
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
    ["remove", options.removeLoggedMeal],
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
}
