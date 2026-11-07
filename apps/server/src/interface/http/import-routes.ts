import { memberId, recipeIdeaId } from "@weekly-planner/domain";
import { z } from "zod";
import { COMMAND_REJECTIONS, type RouteContext } from "./context.js";

export const importDraftBody = z.object({
  address: z.string().max(2000).optional(),
  text: z.string().max(60_000).optional(),
});
const importMatchBody = z.object({ names: z.array(z.string().max(200)).max(60) });
const importTagsBody = z.object({ names: z.array(z.string().max(200)).max(30) });
const importSuggestBody = z.object({ kind: z.enum(["item", "tag"]), query: z.string().max(200) });
const importRelatedBody = z.object({
  name: z.string().max(300),
  ingredients: z.array(z.string().max(200)).max(60),
  source: z.string().max(2000).optional(),
});
const importCreateBody = z.object({
  draft: z.record(z.string(), z.unknown()),
  // The idea this recipe realises: an id as the planner hands them out (UUIDs), nothing else.
  idea: z
    .string()
    .regex(/^[0-9a-zA-Z-]{1,100}$/)
    .optional(),
});

export function registerImportRoutes(ctx: RouteContext): void {
  const { app, api, options, requireMember } = ctx;
  // Every draft costs money at the language model: DraftRecipeImport holds the hourly allowance the import and the
  // idea routes share.
  app.post(`${api}/import/draft`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = importDraftBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.draftRecipeImport.execute({
      member: memberId(member.id),
      ...(body.data.address === undefined ? {} : { address: body.data.address }),
      ...(body.data.text === undefined ? {} : { text: body.data.text }),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { draft: result.value };
  });

  app.post(`${api}/import/match`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const body = importMatchBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.matchIngredients.execute({ names: body.data.names });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { items: result.value };
  });

  app.post(`${api}/import/match-tags`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const body = importTagsBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.matchTags.execute({ names: body.data.names });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { tags: result.value };
  });

  app.post(`${api}/import/suggest`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const body = importSuggestBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.suggestNames.execute(body.data);
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { names: result.value };
  });

  // Recipes the household already has that look like the draft: told before creating, never a block.
  app.post(`${api}/import/related`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const body = importRelatedBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const result = await options.findRelatedRecipes.execute({
      name: body.data.name,
      ingredients: body.data.ingredients,
      ...(body.data.source === undefined ? {} : { source: body.data.source }),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    return { related: result.value };
  });

  // The picture of a draft, for the review: served by the planner, so a phone never loads it from the other site.
  app.get(`${api}/import/image/:token`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    const { token } = req.params as { token: string };
    const image = /^[0-9a-f]{32}$/.test(token) ? options.draftImages?.get(token) : null;
    if (!image) return reply.code(404).send({ error: "not_found" });
    return reply
      .header("Content-Type", image.contentType)
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox")
      .send(Buffer.from(image.bytes));
  });

  app.post(`${api}/import/create`, async (req, reply) => {
    const member = requireMember(req, reply);
    if (!member) return reply;
    const body = importCreateBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });
    const idea = body.data.idea === undefined ? undefined : recipeIdeaId(body.data.idea);
    const result = await options.createImportedRecipe.execute({
      member: memberId(member.id),
      draft: body.data.draft,
      ...(idea === undefined ? {} : { idea }),
    });
    if (!result.ok) return reply.code(COMMAND_REJECTIONS[result.reason] ?? 422).send({ error: result.reason });
    if (idea !== undefined) await ctx.options.ideaEvents.publish([{ type: "IdeasChanged" }]);
    return reply.code(201).send({
      recipeId: result.value.recipeId,
      draft: result.value.draft,
      photoAttached: result.value.photoAttached,
    });
  });
}
