import { useState } from "react";
import { photoUrl } from "./api";

/** A small picture of a recipe; the same placeholder as on the cards when it has none. Give it a `key` of the recipe. */
export function RecipeThumb({ recipeId }: { recipeId: number }) {
  const [missing, setMissing] = useState(false);
  return (
    <span className="thumb" data-missing={missing}>
      {missing ? (
        <span aria-hidden="true">🍽️</span>
      ) : (
        <img src={photoUrl(recipeId)} alt="" draggable={false} loading="lazy" onError={() => setMissing(true)} />
      )}
    </span>
  );
}
