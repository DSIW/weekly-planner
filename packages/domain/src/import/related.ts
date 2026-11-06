import { cleanSourceAddress, fold, stemKey } from "./draft.js";

// rule FindRelatedRecipes (spec/recipe-import.allium): before a member creates an imported recipe they are told which
// recipes the household already has that look like it. This only informs; it never stops anything.

/** What is known of a recipe the household already has. */
export interface KnownRecipe {
  readonly id: number;
  readonly name: string;
  /** Empty when the recipe's ingredients are not known (a recipe that still needs data). */
  readonly ingredients: readonly string[];
  readonly source?: string;
}

export type RelatedReason = "same_source" | "similar_name" | "shared_ingredients";

export interface RelatedRecipe {
  readonly id: number;
  readonly name: string;
  readonly reasons: readonly RelatedReason[];
  readonly sharedIngredients: number;
}

const MAX_RELATED = 3;
const MIN_SHARED = 4;
const MIN_OVERLAP = 0.6;
/** Every kitchen has these: sharing them says nothing about two recipes being alike. */
const STAPLES = new Set(["salz", "pfeffer", "wasser", "zucker", "oel", "olivenoel", "mehl"]);
const FILLER = new Set([
  "mit",
  "und",
  "oder",
  "der",
  "die",
  "das",
  "dem",
  "den",
  "in",
  "im",
  "vom",
  "von",
  "aus",
  "an",
  "auf",
  "a",
  "al",
  "alla",
  "all",
]);

/** The link as one comparable form: no www, no trailing slash, no tracking parameters, any scheme. */
function sourceKey(address: string | undefined): string | null {
  const cleaned = address === undefined ? null : cleanSourceAddress(address);
  if (cleaned === null) return null;
  const url = new URL(cleaned);
  return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/+$/, "")}${url.search}`;
}

const words = (name: string): Set<string> =>
  new Set(
    fold(name)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1 && !FILLER.has(w))
      .map(stemKey),
  );

/** Names alike: one holds all the words of the other (and one is a real word), or they are the same name but for a slip. */
function similarNames(a: string, b: string): boolean {
  const [wa, wb] = [words(a), words(b)];
  if (wa.size === 0 || wb.size === 0) return false;
  const [small, large] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  const covered = [...small].every((w) => large.has(w));
  if (covered && [...small].some((w) => w.length >= 5)) return true;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / (wa.size + wb.size - shared) >= MIN_OVERLAP;
}

const ingredientKeys = (names: readonly string[]): Set<string> =>
  new Set(names.map((n) => stemKey(fold(n))).filter((k) => k !== "" && !STAPLES.has(k)));

/**
 * The household's recipes that look like the draft, best first: the same source link, a similar name, or most of the
 * ingredients in common (staples like salt do not count). At most three.
 */
export function relatedRecipes(
  draft: { readonly name: string; readonly ingredients: readonly string[]; readonly source?: string },
  known: readonly KnownRecipe[],
  limit = MAX_RELATED,
): RelatedRecipe[] {
  const mine = ingredientKeys(draft.ingredients);
  const link = sourceKey(draft.source);
  const found: { recipe: RelatedRecipe; score: number }[] = [];
  for (const k of known) {
    const reasons: RelatedReason[] = [];
    let score = 0;
    if (link !== null && sourceKey(k.source) === link) {
      reasons.push("same_source");
      score += 100;
    }
    if (similarNames(draft.name, k.name)) {
      reasons.push("similar_name");
      score += 50;
    }
    const theirs = ingredientKeys(k.ingredients);
    const shared = [...mine].filter((i) => theirs.has(i)).length;
    const overlap = shared / Math.max(1, mine.size + theirs.size - shared);
    if (shared >= MIN_SHARED && overlap >= MIN_OVERLAP) {
      reasons.push("shared_ingredients");
      score += 40 * overlap;
    }
    if (reasons.length > 0)
      found.push({ recipe: { id: k.id, name: k.name, reasons, sharedIngredients: shared }, score });
  }
  return found
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name, "de"))
    .slice(0, limit)
    .map((f) => f.recipe);
}
