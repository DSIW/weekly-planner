import type { DraftImage, RecipeWriter } from "@weekly-planner/application";
import type { RecipeDraft, Vocabulary } from "@weekly-planner/domain";
import type { KitchenOwlClient, NewRecipe } from "./client.js";
import { canon, freeTags, tagsForDraft } from "./recipe-translator.js";

const TTL_MS = 5 * 60_000;

/** The recipe the way the household writes them: an italic line, then the steps as a numbered list. */
export function descriptionOf(draft: Pick<RecipeDraft, "subtitle" | "steps">): string {
  const steps = draft.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return draft.subtitle ? `_${draft.subtitle}_\n\n${steps}` : steps;
}

/** Adapter: KitchenOwl as the place recipes are checked against and created in. */
export class KitchenOwlRecipeWriter implements RecipeWriter {
  private cached: { at: number; items: string[]; icons: Record<string, string>; tags: string[] } | null = null;

  constructor(
    private readonly client: Pick<
      KitchenOwlClient,
      "listItems" | "listTagNames" | "createRecipe" | "uploadPhoto" | "setItemIcon"
    >,
    private readonly now: () => number = Date.now,
  ) {}

  private async names(): Promise<{ items: string[]; icons: Record<string, string>; tags: string[] }> {
    if (this.cached && this.now() - this.cached.at < TTL_MS) return this.cached;
    const [items, tags] = await Promise.all([this.client.listItems(), this.client.listTagNames()]);
    this.cached = {
      at: this.now(),
      items: items.map((i) => i.name),
      icons: Object.fromEntries(items.flatMap((i) => (i.icon ? [[i.name, i.icon]] : []))),
      tags,
    };
    return this.cached;
  }

  async vocabulary(): Promise<Vocabulary> {
    const { items, icons, tags } = await this.names();
    return { items, icons, tags: freeTags(tags) };
  }

  async create(draft: RecipeDraft, image?: DraftImage): Promise<{ recipeId: number; photoAttached: boolean }> {
    const { tags: existing } = await this.names();
    // A tag that the household already spells in its own way keeps that spelling.
    const spelled = new Map(existing.map((t) => [canon(t), t]));
    // The tags the rules read come from meal type, base and diet; a member's own tags are never one of those.
    const tags = [...new Set([...tagsForDraft(draft), ...freeTags(draft.tags)].map((t) => spelled.get(canon(t)) ?? t))];
    // A picture that KitchenOwl does not take must not cost the recipe.
    const photo = image ? await this.client.uploadPhoto(image.bytes, image.contentType).catch(() => null) : null;
    const recipe: NewRecipe = {
      name: draft.name,
      description: descriptionOf(draft),
      yields: draft.yields ?? 2,
      ...(draft.totalMinutes === undefined ? {} : { time: draft.totalMinutes }),
      ...(draft.source === undefined ? {} : { source: draft.source }),
      ...(photo === null ? {} : { photo }),
      items: draft.ingredients.map((i) => ({ name: i.name, description: i.amount, optional: i.optional })),
      tags,
    };
    const created = await this.client.createRecipe(recipe);
    const recipeId = created.id;
    // A new item gets the icon that was suggested for it; the recipe is there either way, so a failure costs the icon.
    for (const ingredient of draft.ingredients) {
      if (!ingredient.isNewItem || !ingredient.icon) continue;
      const item = created.items.find((i) => i.name.toLowerCase() === ingredient.name.toLowerCase());
      if (item && !item.icon) await this.client.setItemIcon(item.id, ingredient.icon).catch(() => undefined);
    }
    this.cached = null; // the new items and tags are part of the vocabulary now
    return { recipeId, photoAttached: photo !== null };
  }
}
