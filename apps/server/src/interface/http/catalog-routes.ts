import { recipeId } from "@weekly-planner/domain";
import { z } from "zod";
import type { RouteContext } from "./context.js";
import { recipeView } from "./views.js";

const recipeParam = z.object({ id: z.coerce.number().int() });

export function registerCatalogRoutes(ctx: RouteContext): void {
  const { app, api, options, requireMember } = ctx;
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
    return {
      recipes: recipes.map((r) => recipeView(r, options.planAheadMinutes)),
      // Recipes whose tags are not complete yet: listed, with what is missing, so that they get fixed in KitchenOwl.
      unavailable: await options.listRecipes.incomplete(),
    };
  });

  app.get(`${api}/planned-dates`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    return { dates: await options.listTakenDates.execute() };
  });

  app.post(`${api}/recipes/refresh`, async (req, reply) => {
    if (!requireMember(req, reply)) return reply;
    await options.refreshRecipes.execute();
    return reply.code(204).send();
  });
}
