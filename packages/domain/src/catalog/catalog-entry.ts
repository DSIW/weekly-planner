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
      /**
       * The recipe as far as it can be read, with placeholders for what the tags do not say (the meal log needs no more
       * than a name and a picture; the base is given by the member). Never offered to the planning rules.
       */
      readonly loggable?: Recipe;
    };
