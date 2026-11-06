import { memberId, sessionId } from "@weekly-planner/domain";
import { z } from "zod";
import { COMMAND_REJECTIONS, type RouteContext } from "./context.js";
import { listLineView, exportView, sessionView } from "./views.js";

const finalizeBody = z.object({ skip: z.array(z.string().max(200)).max(300).default([]) }).default({ skip: [] });
const retryBody = z.object({ resendUnconfirmed: z.boolean().optional() }).default({});

export function registerFinalizeRoutes(ctx: RouteContext): void {
  const { app, api, options, requireMember } = ctx;
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
}
