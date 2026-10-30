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
}

/** Vegan counts as vegetarian. */
export const isVegetarian = (r: Pick<Recipe, "diet">): boolean => r.diet === "vegan" || r.diet === "vegetarian";

/** A recipe without a time is still offered, but flagged so someone adds it. */
export const needsTime = (r: Pick<Recipe, "totalTimeMinutes">): boolean => r.totalTimeMinutes === null;
