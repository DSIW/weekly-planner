import type { Base, Recipe, RecipeId } from "../catalog/recipe.js";
import { isVegetarian } from "../catalog/recipe.js";
import type { PlanningConfig } from "./config.js";
import { addDays, isWeekend, type PlanDate } from "./dates.js";
import { fitsWeekdayLimit, isDinnerCandidate } from "./eligibility.js";
import { nextOpenDay, passedRecipeIds, plannedDays, vetoedRecipeIds, type PlanningSession } from "./session.js";

/** What the household ate on a past day, as far as base variety is concerned. */
export interface MealLogHistory {
  readonly date: PlanDate;
  readonly base: Base;
}

export interface SuggestionInput {
  readonly session: PlanningSession;
  readonly candidates: readonly Recipe[];
  readonly history: readonly MealLogHistory[];
  /** Recipes planned within the recent window. */
  readonly recentlyPlanned: ReadonlySet<RecipeId>;
  /** Recipes with a confirmed cooking (CookedRecipe); they count as proven even if the import says otherwise. */
  readonly experienced: ReadonlySet<RecipeId>;
  readonly config: PlanningConfig;
  /** Uniform in [0, 1). Breaks ties between equally ranked recipes. */
  readonly random: () => number;
}

/**
 * The deck for the next open day: hard rules filter, soft preferences rank (spec: surface PlanningBoard).
 * In order of priority: base variety, mostly vegetarian, one new recipe per session, not planned recently.
 * Recipes that rank equally come in random order. The deck is not capped.
 */
export function suggestRecipes(input: SuggestionInput): Recipe[] {
  const { session, config } = input;
  const day = session.status === "open" ? nextOpenDay(session) : undefined;
  if (!day) return [];

  const planned = plannedDays(session).flatMap((d) => (d.recipe ? [d.recipe] : []));
  const excluded = new Set<RecipeId>([...vetoedRecipeIds(session), ...passedRecipeIds(session), ...planned.map((r) => r.id)]);
  const eligible = input.candidates.filter(
    (r) =>
      isDinnerCandidate(r) &&
      (isWeekend(day.date) || fitsWeekdayLimit(r, config.weekdayTimeLimitMinutes)) &&
      !excluded.has(r.id),
  );

  const usedBases = recentBases(input, day.date, planned);
  const vegetarianAtRisk = isVegetarianShareAtRisk(session, planned, config);
  const isNew = (r: Recipe) => !r.isProven && !input.experienced.has(r.id);
  const newWanted = planned.filter(isNew).length < config.newRecipesPerSession;

  const ranked = eligible.map((recipe) => ({
    recipe,
    key: [
      usedBases.has(recipe.base) ? 1 : 0,
      vegetarianAtRisk && !isVegetarian(recipe) ? 1 : 0,
      newnessKey(recipe, isNew(recipe), newWanted),
      input.recentlyPlanned.has(recipe.id) ? 1 : 0,
      input.random(),
    ],
  }));
  ranked.sort((a, b) => compareKeys(a.key, b.key));
  return ranked.map((r) => r.recipe);
}

/** Bases of the previous days and of the other days of this session; "other" is never held against a recipe. */
function recentBases(input: SuggestionInput, date: PlanDate, planned: readonly Recipe[]): Set<Base> {
  const from = addDays(date, -input.config.varietyWindowDays);
  const bases = new Set<Base>(planned.map((r) => r.base));
  for (const entry of input.history) if (entry.date >= from && entry.date < date) bases.add(entry.base);
  bases.delete("other");
  return bases;
}

/** Choosing a non-vegetarian dish now would make the vegetarian share unreachable for this session. */
function isVegetarianShareAtRisk(session: PlanningSession, planned: readonly Recipe[], config: PlanningConfig): boolean {
  const open = session.days.filter((d) => d.status === "open").length;
  const dinners = planned.length + open;
  const target = Math.ceil(config.vegetarianShare * dinners - 1e-9);
  const vegetarianSoFar = planned.filter(isVegetarian).length;
  return vegetarianSoFar + (open - 1) < target;
}

/** New recipes first (wants-to-try before the rest) until the session has its one; proven ones first afterwards. */
function newnessKey(recipe: Recipe, isNew: boolean, newWanted: boolean): number {
  if (!newWanted) return isNew ? 1 : 0;
  if (isNew) return recipe.wantsToTry ? 0 : 1;
  return 2;
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return 0;
}
