import { useState } from "react";
import type { EligibleRecipes, Hindrance, RecipeView } from "./api";
import { dayLabel } from "./dates";
import { useRecipeHref } from "./Links";
import { RecipeLine } from "./RecipeLine";
import { SearchField } from "./SearchField";

interface Props {
  date: string;
  recipes: RecipeView[];
  /** Found only by searching: each with what is against it. */
  others?: EligibleRecipes["others"];
  unavailable?: EligibleRecipes["unavailable"];
  /** `despiteTime`: the member was warned that the recipe is too long for a weekday and chose it anyway. */
  onPick: (recipe: RecipeView, despiteTime?: boolean) => void;
  onRefresh: () => void;
  pending: boolean;
  refreshing: boolean;
  error: string | null;
}

const WHY: Record<Exclude<Hindrance, "too_long_for_weekday">, string> = {
  not_a_dinner: "Kein Hauptgericht (Beilage, Dessert, Frühstück …): das gibt es nicht als Abendessen.",
  vetoed: "In dieser Planung schon abgelehnt.",
  waiting: "Wartet an einem anderen Tag auf eine Antwort.",
  passed: "In dieser Planung schon übersprungen.",
  planned: "In dieser Planung schon eingeplant.",
};

const MISSING: Record<string, string> = {
  "no meal-type tag": "die Art (z. B. Hauptgericht)",
  "no diet tag": "die Ernährung (z. B. Vegetarisch)",
  "neither proven nor new": "Erprobt oder Neu",
  "tagged both proven and new": "nur eines von Erprobt und Neu",
};
const missingText = (problems: string[]): string => problems.map((p) => MISSING[p] ?? p).join(", ");

function Unavailable({ recipe }: { recipe: EligibleRecipes["unavailable"][number] }) {
  const href = useRecipeHref(recipe.id);
  return (
    <div className="recipe found-other" aria-disabled="true">
      <span className="recipe-line">
        <span className="recipe-line-text">
          <strong>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {recipe.name}
              </a>
            ) : (
              recipe.name
            )}
          </strong>
          <span className="muted">In KitchenOwl fehlt noch: {missingText(recipe.problems)}.</span>
        </span>
      </span>
    </div>
  );
}

export function RecipePicker({
  date,
  recipes,
  others = [],
  unavailable = [],
  onPick,
  onRefresh,
  pending,
  refreshing,
  error,
}: Props) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(needle);
  const shown = recipes.filter((r) => matches(r.name));
  // Everything else is found by searching, and only then: the plain list stays what it was.
  const more = needle === "" ? [] : others.filter((r) => matches(r.name));
  const lacking = needle === "" ? [] : unavailable.filter((r) => matches(r.name));
  const none = shown.length === 0 && more.length === 0 && lacking.length === 0;
  return (
    <section className="card">
      <h2>Abendessen am {dayLabel(date)}</h2>
      <SearchField value={query} onChange={setQuery} />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="recipes">
        {shown.map((r) => (
          <button key={r.id} type="button" className="recipe" disabled={pending} onClick={() => onPick(r)}>
            <RecipeLine recipe={r} />
          </button>
        ))}
        {more.length + lacking.length > 0 && <h3 className="found-heading">Weitere Treffer</h3>}
        {more.map((r) => {
          const tooLongOnly = r.hindrances.length === 1 && r.hindrances[0] === "too_long_for_weekday";
          if (tooLongOnly)
            return (
              <button
                key={r.id}
                type="button"
                className="recipe found-other"
                disabled={pending}
                onClick={() => onPick(r, true)}
              >
                <RecipeLine
                  recipe={r}
                  detail={
                    <span className="warn">
                      <span aria-hidden="true">⚠︎ </span>
                      {r.minutes} Min. – lang für einen Wochentag
                    </span>
                  }
                />
              </button>
            );
          return (
            <div key={r.id} className="recipe found-other" aria-disabled="true">
              <RecipeLine
                recipe={r}
                link
                detail={r.hindrances
                  .filter((h): h is Exclude<Hindrance, "too_long_for_weekday"> => h !== "too_long_for_weekday")
                  .map((h) => WHY[h])
                  .join(" ")}
              />
            </div>
          );
        })}
        {lacking.map((r) => (
          <Unavailable key={r.id} recipe={r} />
        ))}
        {none && <p className="muted">Kein Rezept gefunden.</p>}
      </div>
      <button type="button" className="secondary" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? "Lädt …" : "Rezepte neu laden"}
      </button>
    </section>
  );
}
