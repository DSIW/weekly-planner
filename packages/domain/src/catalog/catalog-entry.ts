import type { Recipe, RecipeId } from "./recipe.js";

/**
 * What the recipe catalogue says about one recipe: either it carries every attribute the planning rules need,
 * or it is listed with the reasons it needs attention. Nothing is silently dropped.
 */
export type CatalogEntry =
  | { readonly kind: "ready"; readonly recipe: Recipe }
  | {
      readonly kind: "needs-data";
      readonly recipeId: RecipeId;
      readonly name: string;
      readonly problems: readonly string[];
    };
