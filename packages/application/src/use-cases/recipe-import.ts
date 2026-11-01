import {
  cleanText,
  IMPORT_LIMITS,
  itemMatcher,
  reviewDraft,
  type MemberId,
  type RecipeDraft,
  type Result,
} from "@weekly-planner/domain";
import {
  ExtractorNotConfigured,
  type RecipeExtractor,
  type RecipeSource,
  type RecipeWriter,
} from "../ports/recipe-import.js";

/**
 * rule ReadRecipe: a web link or pasted text becomes a draft for a member to review. The source is read, never
 * obeyed: the model only gets it as material, and its answer is checked by the domain before it is shown.
 */
export class DraftRecipeImport {
  constructor(private readonly deps: { source: RecipeSource; extractor: RecipeExtractor; writer: RecipeWriter }) {}

  async execute(cmd: { member: MemberId; address?: string; text?: string }): Promise<Result<RecipeDraft>> {
    const address = cmd.address?.trim() ?? "";
    const pasted = cmd.text?.trim() ?? "";
    if ((address === "") === (pasted === "")) return { ok: false, reason: "need_one_source" };

    let text = pasted;
    if (address !== "") {
      const read = await this.deps.source.read(address);
      if (!read.ok) return { ok: false, reason: read.reason };
      text = read.text;
    }
    text = text.slice(0, IMPORT_LIMITS.maxSourceCharacters);
    if (text.trim() === "") return { ok: false, reason: "empty" };

    let vocabulary: Awaited<ReturnType<RecipeWriter["vocabulary"]>>;
    try {
      vocabulary = await this.deps.writer.vocabulary();
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
    let answer: unknown;
    try {
      answer = await this.deps.extractor.extract(text, vocabulary);
    } catch (e) {
      return { ok: false, reason: e instanceof ExtractorNotConfigured ? "not_configured" : "extraction_failed" };
    }
    return reviewDraft(answer, vocabulary, address === "" ? undefined : address);
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

/**
 * rule CreateImportedRecipe: what a member confirmed is checked again (a phone's word is not trusted) and created.
 */
export class CreateImportedRecipe {
  constructor(private readonly deps: { writer: RecipeWriter }) {}

  async execute(cmd: { member: MemberId; draft: unknown }): Promise<Result<{ recipeId: number; draft: RecipeDraft }>> {
    let vocabulary: Awaited<ReturnType<RecipeWriter["vocabulary"]>>;
    try {
      vocabulary = await this.deps.writer.vocabulary();
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
    const source = (cmd.draft as { source?: unknown } | null)?.source;
    const checked = reviewDraft(cmd.draft, vocabulary, typeof source === "string" ? source : undefined);
    if (!checked.ok) return checked;
    try {
      const { recipeId } = await this.deps.writer.create(checked.value);
      return { ok: true, value: { recipeId, draft: checked.value } };
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
  }
}
