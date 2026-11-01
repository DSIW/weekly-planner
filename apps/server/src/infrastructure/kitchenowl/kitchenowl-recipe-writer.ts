import type { RecipeWriter } from "@weekly-planner/application";
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
  private cached: { at: number; items: string[]; tags: string[] } | null = null;

  constructor(
    private readonly client: Pick<KitchenOwlClient, "listItemNames" | "listTagNames" | "createRecipe">,
    private readonly now: () => number = Date.now,
  ) {}

  private async names(): Promise<{ items: string[]; tags: string[] }> {
    if (this.cached && this.now() - this.cached.at < TTL_MS) return this.cached;
    const [items, tags] = await Promise.all([this.client.listItemNames(), this.client.listTagNames()]);
    this.cached = { at: this.now(), items, tags };
    return this.cached;
  }

  async vocabulary(): Promise<Vocabulary> {
    const { items, tags } = await this.names();
    return { items, tags: freeTags(tags) };
  }

  async create(draft: RecipeDraft): Promise<{ recipeId: number }> {
    const { tags: existing } = await this.names();
    // A tag that the household already spells in its own way keeps that spelling.
    const spelled = new Map(existing.map((t) => [canon(t), t]));
    const tags = [...new Set([...tagsForDraft(draft), ...draft.tags].map((t) => spelled.get(canon(t)) ?? t))];
    const recipe: NewRecipe = {
      name: draft.name,
      description: descriptionOf(draft),
      yields: draft.yields ?? 2,
      ...(draft.totalMinutes === undefined ? {} : { time: draft.totalMinutes }),
      ...(draft.source === undefined ? {} : { source: draft.source }),
      items: draft.ingredients.map((i) => ({ name: i.name, description: i.amount, optional: i.optional })),
      tags,
    };
    const recipeId = await this.client.createRecipe(recipe);
    this.cached = null; // the new items and tags are part of the vocabulary now
    return { recipeId };
  }
}
