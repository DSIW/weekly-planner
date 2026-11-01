import type { RecipeView } from "./api";
import { timeLabel } from "./recipe-time";
import { RecipeImage } from "./RecipeImage";

const BASES: Record<string, string> = {
  pasta: "Pasta",
  rice: "Reis",
  potatoes: "Kartoffeln",
  grains: "Getreide",
  bread: "Brot",
  other: "Sonstiges",
};
const DIETS: Record<string, string> = { vegan: "Vegan", vegetarian: "Vegetarisch", fish: "Fisch", meat: "Fleisch" };

interface Props {
  recipe: RecipeView & { isNew?: boolean };
  /** The "time is missing" hint belongs where a member can still act on it. */
  hint?: boolean;
}

/**
 * What a recipe card shows: picture, name, time and the tags as KitchenOwl names them (emoji included). A recipe
 * copied before tags were kept falls back to its base and diet.
 */
export function RecipeCardBody({ recipe, hint = true }: Props) {
  const tags = recipe.tags?.length
    ? recipe.tags
    : [BASES[recipe.base] ?? recipe.base, DIETS[recipe.diet] ?? recipe.diet];
  return (
    <>
      <RecipeImage key={recipe.id} recipeId={recipe.id} />
      <h3>{recipe.name}</h3>
      <p className="muted">{timeLabel(recipe)}</p>
      <p className="badges">
        {tags.map((t) => (
          <span key={t} className="badge">
            {t}
          </span>
        ))}
        {recipe.isNew && <span className="badge new">Neu</span>}
      </p>
      {hint && recipe.needsTime && <p className="hint">Zeit fehlt: bitte in KitchenOwl eintragen.</p>}
    </>
  );
}
