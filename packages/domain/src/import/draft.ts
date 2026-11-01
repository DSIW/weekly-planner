import { BASES, DIETS, MEAL_TYPES, type Base, type Diet, type MealType } from "../catalog/recipe.js";
import { reject, succeed, type Result } from "../shared/result.js";

// rule ReadRecipe / CheckDraft / CreateImportedRecipe (spec/recipe-import.allium): what a language model made of a
// source is only ever a draft. These functions decide what of it a member gets to see and what may be created.

/** spec config: how much a draft may hold. */
export const IMPORT_LIMITS = {
  maxSourceCharacters: 12_000,
  maxSteps: 40,
  maxIngredients: 60,
  maxName: 120,
  maxStep: 800,
  maxIngredientName: 80,
  maxAmount: 40,
  maxRedirects: 3,
} as const;

export interface DraftIngredient {
  readonly name: string;
  /** As written: "2 Stück", "1 Prise"; empty when the source gives none. */
  readonly amount: string;
  readonly optional: boolean;
  /** No known item has this name: KitchenOwl will create it. */
  readonly isNewItem: boolean;
}

export interface RecipeDraft {
  readonly name: string;
  readonly subtitle?: string;
  readonly steps: readonly string[];
  readonly ingredients: readonly DraftIngredient[];
  readonly mealType: MealType;
  readonly base: Base;
  readonly diet: Diet;
  /** Only tags the household already has. */
  readonly tags: readonly string[];
  readonly totalMinutes?: number;
  readonly yields?: number;
  readonly source?: string;
}

/** What the household's KitchenOwl already holds: names a draft is checked against. */
export interface Vocabulary {
  readonly items: readonly string[];
  /** Tags a draft may carry besides the ones its meal type, base and diet stand for. */
  readonly tags: readonly string[];
}

/** Letters compared without case, accents, umlaut spelling or extra spaces: "Möhre" finds "möhre" and "Moehre". */
export const fold = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** Plain text: no markup, no links, no control characters, one line of spaces, at most `max` characters. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/\p{C}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;

const minutes = (value: unknown, max: number): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max ? value : undefined;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * rule CheckDraft: the model's answer, whatever it is, becomes a draft the household's vocabulary fits, or is
 * refused. Text is cleaned, an ingredient named like a known item takes that item's name, any other is marked new,
 * and a tag the household does not have is dropped.
 */
export function reviewDraft(raw: unknown, vocabulary: Vocabulary, source?: string): Result<RecipeDraft> {
  if (!isObject(raw)) return reject("not_a_recipe");
  const name = cleanText(raw.name, IMPORT_LIMITS.maxName);
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .map((s) => cleanText(s, IMPORT_LIMITS.maxStep))
    .filter((s) => s !== "");
  const mealType = oneOf(MEAL_TYPES, raw.mealType);
  const base = oneOf(BASES, raw.base);
  const diet = oneOf(DIETS, raw.diet);
  if (name === "" || steps.length === 0 || !mealType || !base || !diet) return reject("not_a_recipe");
  if (steps.length > IMPORT_LIMITS.maxSteps) return reject("too_many_steps");

  const known = new Map(vocabulary.items.map((i) => [fold(i), i]));
  const ingredients: DraftIngredient[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.ingredients) ? raw.ingredients : []) {
    if (!isObject(entry)) continue;
    const written = cleanText(entry.name, IMPORT_LIMITS.maxIngredientName);
    if (written === "") continue;
    const canonical = known.get(fold(written));
    const key = fold(canonical ?? written);
    if (seen.has(key)) continue;
    seen.add(key);
    ingredients.push({
      name: canonical ?? written,
      amount: cleanText(entry.amount, IMPORT_LIMITS.maxAmount),
      optional: entry.optional === true,
      isNewItem: canonical === undefined,
    });
  }
  if (ingredients.length === 0) return reject("not_a_recipe");
  if (ingredients.length > IMPORT_LIMITS.maxIngredients) return reject("too_many_ingredients");

  const ownTags = new Map(vocabulary.tags.map((t) => [fold(t), t]));
  const tags = [
    ...new Set(
      (Array.isArray(raw.tags) ? raw.tags : []).flatMap((t) => {
        const tag = typeof t === "string" ? ownTags.get(fold(t)) : undefined;
        return tag ? [tag] : [];
      }),
    ),
  ];
  const subtitle = cleanText(raw.subtitle, IMPORT_LIMITS.maxName * 2);
  const totalMinutes = minutes(raw.totalMinutes, 1440);
  const yields = minutes(raw.yields, 50);
  const sourceText = source === undefined ? "" : source.slice(0, 500);
  return succeed({
    name,
    ...(subtitle ? { subtitle } : {}),
    steps,
    ingredients,
    mealType,
    base,
    diet,
    tags,
    ...(totalMinutes === undefined ? {} : { totalMinutes }),
    ...(yields === undefined ? {} : { yields }),
    ...(sourceText ? { source: sourceText } : {}),
  });
}
