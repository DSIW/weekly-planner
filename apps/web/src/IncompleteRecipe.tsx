import { useRecipeHref } from "./Links";

const MISSING: Record<string, string> = {
  "no meal-type tag": "die Art (z. B. Hauptgericht)",
  "no diet tag": "die Ernährung (z. B. Vegetarisch)",
  "neither proven nor new": "Erprobt oder Neu",
  "tagged both proven and new": "nur eines von Erprobt und Neu",
};

/** What is wrong with a recipe's tags, in words for the household. */
const missingOne = (problem: string): string => {
  if (MISSING[problem]) return MISSING[problem];
  if (problem.startsWith("several base tags")) return "nur eine Basis (z. B. Pasta)";
  if (problem.startsWith("diet tags contradict")) return "eine eindeutige Ernährung";
  if (problem.startsWith("main dish also tagged")) return "nur eine Art (Hauptgericht und anderes zugleich)";
  return problem;
};
export const missingText = (problems: readonly string[]): string => problems.map(missingOne).join(", ");

/**
 * A recipe the planner cannot use yet because its tags in KitchenOwl are not complete. It stays visible, with what is
 * missing and the way to fix it, so the household knows it will work once the tags are set.
 */
export function IncompleteRecipe({ recipe }: { recipe: { id: number; name: string; problems: readonly string[] } }) {
  const href = useRecipeHref(recipe.id);
  return (
    <div className="recipe found-other incomplete" aria-disabled="true">
      <span className="recipe-line">
        <span className="recipe-line-text">
          <strong>{recipe.name}</strong>
          <span className="warn">
            <span aria-hidden="true">⚠︎ </span>Tags fehlen: {missingText(recipe.problems)}
          </span>
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer">
              In KitchenOwl ergänzen
            </a>
          )}
        </span>
      </span>
    </div>
  );
}
