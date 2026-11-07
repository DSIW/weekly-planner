import { memberId, recipeIdeaId } from "@weekly-planner/domain";
import { z } from "zod";
import { COMMAND_REJECTIONS, type RouteContext } from "./context.js";
import { importDraftBody } from "./import-routes.js";
import { ideaView } from "./views.js";

/** A link a member noted is shown as a link, so only web links are taken (never `javascript:` and the like). */
const webLink = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      const protocol = new URL(v).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  });
/** A field the form left empty is absent, not an empty text. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v.trim() === "" ? undefined : v.trim()));
const ideaBody = z.object({
  title: z
    .string()
    .max(200)
    .transform((v) => v.trim()),
  note: optionalText(2000),
  inspirationLink: z
    .union([webLink, z.literal(""), z.null()])
    .optional()
    .transform((v) => (v ? v : undefined)),
});
const ideaParam = z.object({ id: z.string().min(1).max(100) });
const memberParam = z.object({ id: z.string().min(1).max(40) });
const pickBody = z.object({ candidate: z.number().int().min(0).max(99) });
const ownBody = importDraftBody;

/** Recipe ideas (I1): the household's list, every member may change any idea; research (I2) and the member pictures. */
export function registerIdeaRoutes(ctx: RouteContext): void {
  const { app, api, options, requireMember } = ctx;
  const ideaChanged = () => options.ideaEvents.publish([{ type: "IdeasChanged" }]);
  const peopleOf = async () =>
    new Map((await options.listMembers.execute()).map((m) => [m.id as string, { name: m.name, avatar: m.avatar }]));

  app.get(`${api}/ideas`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const result = await options.listIdeas.execute();
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    const people = await peopleOf();
    return { ideas: result.value.map((i) => ideaView(i, people)) };
  });

  app.post(`${api}/ideas`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = ideaBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.noteIdea.execute({
      member: memberId(member.id),
      title: body.data.title,
      ...(body.data.note === undefined ? {} : { note: body.data.note }),
      ...(body.data.inspirationLink === undefined ? {} : { inspirationLink: body.data.inspirationLink }),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    await ideaChanged();
    return reply.code(201).send({
      idea: ideaView({ ...result.value, isStale: false }, await peopleOf()),
    });
  });

  app.put<{ Params: { id: string } }>(`${api}/ideas/:id`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const params = ideaParam.safeParse(req.params);
    const body = ideaBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.editIdea.execute({
      member: memberId(member.id),
      idea: recipeIdeaId(params.data.id),
      title: body.data.title,
      ...(body.data.note === undefined ? {} : { note: body.data.note }),
      ...(body.data.inspirationLink === undefined ? {} : { inspirationLink: body.data.inspirationLink }),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    await ideaChanged();
    return { idea: ideaView({ ...result.value, isStale: false }, await peopleOf()) };
  });

  app.post<{ Params: { id: string } }>(`${api}/ideas/:id/keep`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const params = ideaParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.keepIdea.execute({ member: memberId(member.id), idea: recipeIdeaId(params.data.id) });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    await ideaChanged();
    return { idea: ideaView({ ...result.value, isStale: false }, await peopleOf()) };
  });

  app.post<{ Params: { id: string } }>(`${api}/ideas/:id/archive`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const params = ideaParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.archiveIdea.execute({
      member: memberId(member.id),
      idea: recipeIdeaId(params.data.id),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    await ideaChanged();
    return { idea: ideaView({ ...result.value, isStale: false }, await peopleOf()) };
  });

  app.post<{ Params: { id: string } }>(`${api}/ideas/:id/restore`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const params = ideaParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.restoreIdea.execute({
      member: memberId(member.id),
      idea: recipeIdeaId(params.data.id),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    await ideaChanged();
    return { idea: ideaView({ ...result.value, isStale: false }, await peopleOf()) };
  });

  // Research (I2): the model proposes candidates; the answer is the idea with them.
  app.post<{ Params: { id: string } }>(`${api}/ideas/:id/research`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const params = ideaParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.researchIdea.execute({
      member: memberId(member.id),
      idea: recipeIdeaId(params.data.id),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    await ideaChanged();
    return { idea: ideaView({ ...result.value, isStale: false }, await peopleOf()) };
  });

  // Picking a candidate or handing over an own source starts the import: the answer is the import's draft, as from
  // /import/draft. The idea goes along when the phone creates the recipe (/import/create with `idea`).
  app.post<{ Params: { id: string } }>(`${api}/ideas/:id/pick`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const params = ideaParam.safeParse(req.params);
    const body = pickBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.pickCandidate.execute({
      member: memberId(member.id),
      idea: recipeIdeaId(params.data.id),
      candidate: body.data.candidate,
    });
    // The idea's clock moved even when the import refused.
    await ideaChanged();
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { draft: result.value };
  });

  app.post<{ Params: { id: string } }>(`${api}/ideas/:id/own`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const params = ideaParam.safeParse(req.params);
    const body = ownBody.safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.useOwnRecipe.execute({
      member: memberId(member.id),
      idea: recipeIdeaId(params.data.id),
      ...(body.data.address === undefined ? {} : { address: body.data.address }),
      ...(body.data.text === undefined ? {} : { text: body.data.text }),
    });
    await ideaChanged();
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { draft: result.value };
  });

  app.delete<{ Params: { id: string } }>(`${api}/ideas/:id`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const params = ideaParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.deleteIdea.execute({
      member: memberId(member.id),
      idea: recipeIdeaId(params.data.id),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    await ideaChanged();
    return reply.code(204).send();
  });

  // A member's own KitchenOwl picture, served by the planner (the phone never talks to KitchenOwl). The URL carries the
  // picture's file name as `v`, so a changed picture is a new URL and the old one may be cached for good.
  app.get<{ Params: { id: string } }>(`${api}/members/:id/avatar`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const params = memberParam.safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "invalid_request" });
    const photo = await options.getMemberAvatar.execute({ member: memberId(params.data.id) }).catch(() => null);
    if (!photo) return reply.code(404).send({ error: "not_found" });
    return reply
      .header("Cache-Control", "private, max-age=86400")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .type(photo.contentType)
      .send(Buffer.from(photo.data));
  });
}
