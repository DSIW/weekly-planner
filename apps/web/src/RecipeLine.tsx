import type { ReactNode } from "react";
import type { RecipeView } from "./api";
import { useRecipeHref } from "./Links";
import { RecipeThumb } from "./RecipeThumb";
import { timeLabel } from "./recipe-time";

interface Props {
  recipe: RecipeView;
  /** Under the name; the recipe's time when omitted. */
  detail?: ReactNode;
  /** After the text: a button or a status. */
  end?: ReactNode;
  /** The name opens the recipe in KitchenOwl, when the server knows where that is. Not inside a button. */
  link?: boolean;
}

/** A recipe as one row: thumbnail, name and a line under it. Every list of chosen or choosable recipes uses it. */
export function RecipeLine({ recipe, detail, end, link = false }: Props) {
  const href = useRecipeHref(recipe.id);
  return (
    <span className="recipe-line">
      <RecipeThumb key={recipe.id} recipeId={recipe.id} />
      <span className="recipe-line-text">
        <strong>
          {link && href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {recipe.name}
            </a>
          ) : (
            recipe.name
          )}
        </strong>
        <span className="muted">{detail ?? timeLabel(recipe)}</span>
      </span>
      {end}
    </span>
  );
}
