import { useState } from "react";
import { BASES, type BaseName, type RecipeView } from "./api";
import { timeLabel } from "./recipe-time";

export const BASE_LABELS: Record<BaseName, string> = {
  pasta: "Pasta",
  rice: "Reis",
  potatoes: "Kartoffeln",
  grains: "Getreide",
  bread: "Brot",
  other: "Sonstiges",
};

interface Props {
  recipes: RecipeView[] | undefined;
  loading: boolean;
  loadFailed: boolean;
  /** A recipe brings its own base; a meal without a recipe is given by its base. */
  onChoose: (base: BaseName, recipe: RecipeView | null) => void;
  pending: boolean;
}

/** Names what was eaten: search a recipe, or give only the base when the meal is not in KitchenOwl. */
export function MealChooser({ recipes, loading, loadFailed, onChoose, pending }: Props) {
  const [mode, setMode] = useState<"recipe" | "base">("recipe");
  const [query, setQuery] = useState("");
  const shown = (recipes ?? []).filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="chooser">
      <fieldset className="switch">
        <legend className="sr-only">Wie benennen?</legend>
        <button type="button" aria-pressed={mode === "recipe"} onClick={() => setMode("recipe")}>
          Rezept
        </button>
        <button type="button" aria-pressed={mode === "base"} onClick={() => setMode("base")}>
          Nur Basis
        </button>
      </fieldset>
      {mode === "base" ? (
        <div className="chips">
          {BASES.map((b) => (
            <button key={b} type="button" className="chip" disabled={pending} onClick={() => onChoose(b, null)}>
              {BASE_LABELS[b]}
            </button>
          ))}
        </div>
      ) : (
        <>
          <label>
            Rezept suchen
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {loading && <p className="muted">Lädt …</p>}
          {loadFailed && (
            <p role="alert" className="error">
              Die Rezepte konnten nicht geladen werden.
            </p>
          )}
          <div className="recipes">
            {shown.map((r) => (
              <button
                key={r.id}
                type="button"
                className="recipe"
                disabled={pending}
                onClick={() => onChoose(r.base as BaseName, r)}
              >
                <span>{r.name}</span>
                <span className="muted">{timeLabel(r)}</span>
              </button>
            ))}
            {recipes && shown.length === 0 && <p className="muted">Kein Rezept gefunden.</p>}
          </div>
        </>
      )}
    </div>
  );
}
