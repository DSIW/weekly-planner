import type { Base, Diet, MealType, Recipe } from "@weekly-planner/domain";
import type { RawRecipe } from "./schemas.js";

/** Tags are compared without emoji variation selectors, case and surrounding space. */
const canon = (s: string): string => s.replace(/️/g, "").trim().toLowerCase();

const MEAL_TAGS: Record<string, MealType> = {
  "🍽️ Hauptgericht": "main",
  "🥦 Beilage": "side",
  "🍦 Dessert": "dessert",
  "🍰 Backen": "baking",
  "🥞 Frühstück": "breakfast",
  "🍿 Snack": "snack",
  "🍸 Getränk": "drink",
};
const BASE_TAGS: Record<string, Base> = {
  "🍝 Pasta": "pasta",
  "🍚 Reis": "rice",
  "🥔 Kartoffeln": "potatoes",
  "🌾 Getreide": "grains",
  "🥖 Brot": "bread",
};
const TAG = {
  vegan: "🌱 Vegan",
  vegetarian: "🥬 Vegetarisch",
  meat: "🥩 Fleisch",
  fish: "🐟 Fisch",
  proven: "✅ Erprobt",
  isNew: "🆕 Neu",
  wants: "⭐ Ausprobieren",
};

const lookup = <T>(table: Record<string, T>): Map<string, T> =>
  new Map(Object.entries(table).map(([k, v]) => [canon(k), v]));
const mealByTag = lookup(MEAL_TAGS);
const baseByTag = lookup(BASE_TAGS);

export interface DerivedRecipe {
  /** Present when meal type and diet could be determined. */
  recipe: Recipe | null;
  /** Reasons this recipe needs attention in the data (empty = fine). */
  problems: string[];
}

/**
 * Turns a KitchenOwl recipe into the attributes the planning rules use.
 * A missing time is not a problem here: such a recipe is offered with a reminder (see Recipe.needsTime).
 */
export function deriveRecipe(raw: RawRecipe): DerivedRecipe {
  const tags = new Set(raw.tags.map((t) => canon(t.name)));
  const has = (t: string): boolean => tags.has(canon(t));
  const problems: string[] = [];

  const meals = [...new Set([...tags].map((t) => mealByTag.get(t)).filter((m): m is MealType => m !== undefined))];
  let mealType: MealType | undefined;
  if (meals.length === 0) problems.push("no meal-type tag");
  else if (meals.includes("main") && meals.length > 1) problems.push(`main dish also tagged ${meals.filter((m) => m !== "main").join("/")}`);
  else mealType = meals.includes("main") ? "main" : meals[0];

  const bases = [...new Set([...tags].map((t) => baseByTag.get(t)).filter((b): b is Base => b !== undefined))];
  const base: Base = bases[0] ?? "other";
  if (bases.length > 1) problems.push(`several base tags: ${bases.join("/")}`);

  const animal = has(TAG.meat) ? "meat" : has(TAG.fish) ? "fish" : undefined;
  const plant = has(TAG.vegan) ? "vegan" : has(TAG.vegetarian) ? "vegetarian" : undefined;
  let diet: Diet | undefined;
  if (animal && plant) problems.push(`diet tags contradict each other (${animal} and ${plant})`);
  else diet = animal ?? plant;
  if (!animal && !plant) problems.push("no diet tag");

  const proven = has(TAG.proven);
  if (proven === has(TAG.isNew)) problems.push(proven ? "tagged both proven and new" : "neither proven nor new");

  const time = raw.time && raw.time > 0 ? raw.time : null;
  const recipe: Recipe | null =
    mealType && diet
      ? {
          id: raw.id,
          name: raw.name,
          mealType,
          base,
          diet,
          totalTimeMinutes: time,
          isProven: proven,
          wantsToTry: has(TAG.wants),
          yields: raw.yields && raw.yields > 0 ? raw.yields : 2,
        }
      : null;
  return { recipe, problems };
}
