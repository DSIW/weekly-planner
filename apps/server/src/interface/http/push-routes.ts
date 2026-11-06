import { memberId } from "@weekly-planner/domain";
import { z } from "zod";
import type { RouteContext } from "./context.js";

const pushSubscriptionBody = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
});
const pushEndpointBody = z.object({ endpoint: z.string().max(1000) });

export function registerPushRoutes(ctx: RouteContext): void {
  const { app, api, options, requireMember } = ctx;
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
}
