// The Recipe attributes the planning rules depend on (spec/weekly-planning.allium, external entity Recipe).

export const MEAL_TYPES = ["main", "side", "dessert", "baking", "breakfast", "snack", "drink"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const BASES = ["pasta", "rice", "potatoes", "grains", "bread", "other"] as const;
export type Base = (typeof BASES)[number];

export const DIETS = ["vegan", "vegetarian", "fish", "meat"] as const;
export type Diet = (typeof DIETS)[number];

/** Identity of a recipe. It is KitchenOwl's recipe id, but the domain does not know that. */
export type RecipeId = number & { readonly __brand: "RecipeId" };
export const recipeId = (n: number): RecipeId => n as RecipeId;

/** One ingredient line as the recipe source holds it; `description` is the amount and unit ("400 g, geschält"). */
export interface Ingredient {
  /** The source's item id, when it has one; lets the shopping list match the item without guessing by name. */
  readonly id?: number;
  readonly name: string;
  readonly description: string;
  readonly optional: boolean;
}

export interface Recipe {
  readonly id: RecipeId;
  readonly name: string;
  readonly mealType: MealType;
  readonly base: Base;
  readonly diet: Diet;
  /** Total cooking time in minutes; null when nobody entered it yet. */
  readonly totalTimeMinutes: number | null;
  /** Cooked before (from the imports). A confirmed cooking in the meal log also makes a recipe proven. */
  readonly isProven: boolean;
  readonly wantsToTry: boolean;
  /** Portions the recipe amounts are written for. */
  readonly yields: number;
  /**
   * What the recipe needs, as read from the catalogue. Absent on a recipe copied into a session before ingredients
   * were read; finalizing then looks them up again.
   */
  readonly ingredients?: readonly Ingredient[];
}

/** Vegan counts as vegetarian. */
export const isVegetarian = (r: Pick<Recipe, "diet">): boolean => r.diet === "vegan" || r.diet === "vegetarian";

/** A recipe without a time is still offered, but flagged so someone adds it. */
export const needsTime = (r: Pick<Recipe, "totalTimeMinutes">): boolean => r.totalTimeMinutes === null;
