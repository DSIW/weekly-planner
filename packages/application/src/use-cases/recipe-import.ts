import {
  cleanText,
  splitPastedPicture,
  IMPORT_LIMITS,
  itemMatcher,
  relatedRecipes,
  reviewDraft,
  suggestItems,
  suggestTags,
  tagMatcher,
  type MemberId,
  type RecipeDraft,
  type RecipeIdeaId,
  type RelatedRecipe,
  type Result,
} from "@weekly-planner/domain";
import type { RecipeCatalog } from "../ports/recipe-catalog.js";
import type { Clock } from "../ports/services.js";
import type { RecipeIdeaRepository } from "../ports/recipe-ideas.js";
import {
  ExtractorNotConfigured,
  type DraftRequestLog,
  type ImageFetcher,
  type ImageShelf,
  type RecipeExtractor,
  type RecipeSource,
  type RecipeWriter,
} from "../ports/recipe-import.js";

const HOUR_MS = 3_600_000;

/** import/config.max_drafts_per_hour: per member, the Import tab and the ideas together. */
export const defaultDraftAllowance = { maxDraftsPerHour: 20 };

/**
 * rule ReadRecipe: a web link or pasted text becomes a draft for a member to review. The source is read, never
 * obeyed: the model only gets it as material, and its answer is checked by the domain before it is shown.
 */
export class DraftRecipeImport {
  constructor(
    private readonly deps: {
      source: RecipeSource;
      extractor: RecipeExtractor;
      writer: RecipeWriter;
      /** Without it a draft has no picture. */
      images?: { fetcher: ImageFetcher; shelf: ImageShelf };
      /** The drafts asked for, counted against the hourly allowance. */
      requests: DraftRequestLog;
      clock: Clock;
    },
    private readonly config: { maxDraftsPerHour: number } = defaultDraftAllowance,
  ) {}

  async execute(cmd: { member: MemberId; address?: string; text?: string }): Promise<Result<RecipeDraft>> {
    // Every draft costs money at the language model: a member past the allowance is refused before anything else.
    const now = this.deps.clock.now();
    const recent = (await this.deps.requests.listSince(now - HOUR_MS)).filter(
      (r) => r.requestedBy === cmd.member && r.requestedAt + HOUR_MS > now,
    );
    if (recent.length >= this.config.maxDraftsPerHour) return { ok: false, reason: "rate_limited" };

    const address = cmd.address?.trim() ?? "";
    const pasted = cmd.text?.trim() ?? "";
    if ((address === "") === (pasted === "")) return { ok: false, reason: "need_one_source" };

    // A pasted text may begin with the link of its picture.
    const split = splitPastedPicture(pasted);
    let text = split.text;
    let imageUrl: string | undefined = split.imageUrl;
    if (address !== "") {
      const read = await this.deps.source.read(address);
      if (!read.ok) return { ok: false, reason: read.reason };
      text = read.text;
      imageUrl = read.imageUrl;
    }
    text = text.slice(0, IMPORT_LIMITS.maxSourceCharacters);
    if (text.trim() === "") return { ok: false, reason: "empty" };

    let vocabulary: Awaited<ReturnType<RecipeWriter["vocabulary"]>>;
    try {
      vocabulary = await this.deps.writer.vocabulary();
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
    // The model is about to be asked: the draft counts, whatever it then answers.
    await this.deps.requests.add({ requestedBy: cmd.member, requestedAt: this.deps.clock.now() });
    let answer: unknown;
    try {
      answer = await this.deps.extractor.extract(text, vocabulary);
    } catch (e) {
      return { ok: false, reason: e instanceof ExtractorNotConfigured ? "not_configured" : "extraction_failed" };
    }
    const draft = reviewDraft(answer, vocabulary, address === "" ? undefined : address);
    if (!draft.ok || imageUrl === undefined || !this.deps.images) return draft;
    // The picture is a nicety: when it cannot be had, the draft is shown without it.
    const image = await this.deps.images.fetcher.fetch(imageUrl).catch(() => null);
    return image ? { ok: true, value: { ...draft.value, imageToken: this.deps.images.shelf.keep(image) } } : draft;
  }
}

export interface IngredientMatch {
  /** The name as it was typed. */
  readonly written: string;
  /** The household's item it stands for, else the name as typed. */
  readonly name: string;
  readonly isNewItem: boolean;
  readonly icon?: string;
}

/** A member renames an ingredient in the review: which of the household's items it is now, if any. */
export class MatchIngredients {
  constructor(private readonly deps: { writer: Pick<RecipeWriter, "vocabulary"> }) {}

  async execute(cmd: { names: readonly string[] }): Promise<Result<readonly IngredientMatch[]>> {
    let vocabulary: Awaited<ReturnType<RecipeWriter["vocabulary"]>>;
    try {
      vocabulary = await this.deps.writer.vocabulary();
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
    const match = itemMatcher(vocabulary);
    return {
      ok: true,
      value: cmd.names.map((typed) => {
        const written = cleanText(typed, IMPORT_LIMITS.maxIngredientName);
        const found = written === "" ? null : match(written);
        return {
          written,
          name: found?.name ?? written,
          isNewItem: found === null,
          ...(found?.icon ? { icon: found.icon } : {}),
        };
      }),
    };
  }
}

/** What a member may mean by the letters typed so far, from the household's own items or tags. */
export class SuggestNames {
  constructor(private readonly deps: { writer: Pick<RecipeWriter, "vocabulary"> }) {}

  async execute(cmd: {
    kind: "item" | "tag";
    query: string;
  }): Promise<Result<readonly { name: string; icon?: string }[]>> {
    let vocabulary: Awaited<ReturnType<RecipeWriter["vocabulary"]>>;
    try {
      vocabulary = await this.deps.writer.vocabulary();
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
    const typed = cleanText(cmd.query, IMPORT_LIMITS.maxIngredientName);
    return {
      ok: true,
      value:
        cmd.kind === "item"
          ? suggestItems(vocabulary, typed)
          : suggestTags(vocabulary.tags, typed).map((name) => ({ name })),
    };
  }
}

interface TagMatchResult {
  readonly written: string;
  readonly name: string;
  readonly isKnown: boolean;
}

/** A member renames or adds a tag in the review: the household's spelling, with its emoji, if it has the tag. */
export class MatchTags {
  constructor(private readonly deps: { writer: Pick<RecipeWriter, "vocabulary"> }) {}

  async execute(cmd: { names: readonly string[] }): Promise<Result<readonly TagMatchResult[]>> {
    let vocabulary: Awaited<ReturnType<RecipeWriter["vocabulary"]>>;
    try {
      vocabulary = await this.deps.writer.vocabulary();
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
    const match = tagMatcher(vocabulary.tags);
    return {
      ok: true,
      value: cmd.names.map((typed) => {
        const written = cleanText(typed, IMPORT_LIMITS.maxTag);
        const found = written === "" ? { name: "", isKnown: false } : match(written);
        return { written, name: found.name, isKnown: found.isKnown };
      }),
    };
  }
}

/**
 * rule CreateImportedRecipe: what a member confirmed is checked again (a phone's word is not trusted) and created.
 */
export class CreateImportedRecipe {
  constructor(
    private readonly deps: {
      writer: RecipeWriter;
      shelf?: ImageShelf;
      /** Told to read the recipes again: the planner offers a new recipe at once, not when its copy runs out. */
      catalog?: Pick<RecipeCatalog, "refresh">;
      /** Rule ForgetRealisedIdea: the idea a recipe was created for goes with it. */
      ideas?: Pick<RecipeIdeaRepository, "remove">;
    },
  ) {}

  async execute(cmd: {
    member: MemberId;
    draft: unknown;
    /** The idea this recipe realises; it is removed only once the recipe exists. */
    idea?: RecipeIdeaId;
  }): Promise<Result<{ recipeId: number; draft: RecipeDraft; photoAttached: boolean }>> {
    let vocabulary: Awaited<ReturnType<RecipeWriter["vocabulary"]>>;
    try {
      vocabulary = await this.deps.writer.vocabulary();
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
    const source = (cmd.draft as { source?: unknown } | null)?.source;
    const checked = reviewDraft(cmd.draft, vocabulary, typeof source === "string" ? source : undefined, {
      newTags: true,
    });
    if (!checked.ok) return checked;
    const { imageToken } = checked.value;
    const image = imageToken === undefined ? null : (this.deps.shelf?.get(imageToken) ?? null);
    try {
      const { recipeId, photoAttached } = await this.deps.writer.create(checked.value, image ?? undefined);
      // The recipe exists now; failing to refresh only means it shows up when the catalogue renews itself.
      await this.deps.catalog?.refresh().catch(() => undefined);
      // An idea deleted meanwhile is simply gone; the recipe is created all the same.
      if (cmd.idea !== undefined) await this.deps.ideas?.remove(cmd.idea).catch(() => undefined);
      return { ok: true, value: { recipeId, draft: checked.value, photoAttached } };
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
  }
}

/**
 * rule FindRelatedRecipes: the household's recipes that look like a draft, for the member to see before creating it.
 * Only informs: it never stops a recipe from being created.
 */
export class FindRelatedRecipes {
  constructor(private readonly deps: { catalog: Pick<RecipeCatalog, "listAll"> }) {}

  async execute(cmd: {
    name: string;
    ingredients: readonly string[];
    source?: string;
  }): Promise<Result<readonly RelatedRecipe[]>> {
    let entries: Awaited<ReturnType<RecipeCatalog["listAll"]>>;
    try {
      entries = await this.deps.catalog.listAll();
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
    const known = entries.map((e) =>
      e.kind === "ready"
        ? {
            id: e.recipe.id as number,
            name: e.recipe.name,
            ingredients: (e.recipe.ingredients ?? []).map((i) => i.name),
            ...(e.recipe.source ? { source: e.recipe.source } : {}),
          }
        : { id: e.recipeId as number, name: e.name, ingredients: [] },
    );
    return {
      ok: true,
      value: relatedRecipes(
        {
          name: cleanText(cmd.name, IMPORT_LIMITS.maxName),
          ingredients: cmd.ingredients.map((i) => cleanText(i, IMPORT_LIMITS.maxIngredientName)),
          ...(cmd.source === undefined ? {} : { source: cmd.source }),
        },
        known,
      ),
    };
  }
}
