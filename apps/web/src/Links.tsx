import { createContext, useContext } from "react";

/** Where KitchenOwl's pages are for the phones: a template with `{id}` for a recipe, and the shopping list. */
export interface KitchenOwlLinks {
  recipe: string;
  list: string;
}

export const LinksContext = createContext<KitchenOwlLinks | null>(null);

/** The KitchenOwl links, or null when the server was not told where KitchenOwl is. */
export const useLinks = (): KitchenOwlLinks | null => useContext(LinksContext);

/** The address of a recipe's page in KitchenOwl, or null without links. */
export function useRecipeHref(recipeId: number): string | null {
  return useLinks()?.recipe.replace("{id}", String(recipeId)) ?? null;
}
