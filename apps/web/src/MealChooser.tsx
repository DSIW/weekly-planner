import { useState } from "react";
import { BASES, type BaseName, type EligibleRecipes, type RecipeView } from "./api";
import { IncompleteRecipe } from "./IncompleteRecipe";
import { RecipeLine } from "./RecipeLine";
import { SearchField } from "./SearchField";

export const BASE_LABELS: Record<BaseName, string> = {
  pasta: "Pasta",
  rice: "Reis",
  potatoes: "Kartoffeln",
  grains: "Getreide",
  bread: "Brot",
  other: "Sonstiges",
};

/** The emoji KitchenOwl's base tags carry. */
export const BASE_EMOJI: Record<BaseName, string> = {
  pasta: "🍝",
  rice: "🍚",
  potatoes: "🥔",
  grains: "🌾",
  bread: "🥖",
  other: "🍽️",
};

interface Props {
  recipes: RecipeView[] | undefined;
  /** Recipes whose tags are not complete yet: shown, not choosable. */
  unavailable?: EligibleRecipes["unavailable"] | undefined;
  loading: boolean;
  loadFailed: boolean;
  /** A recipe brings its own base; a meal without a recipe is given by its base. */
  onChoose: (base: BaseName, recipe: { id: number } | null) => void;
  pending: boolean;
}

/**
 * Names what was eaten, one thing per day: search a recipe, or give only the base when the meal is not in KitchenOwl.
 * The two ways are tabs; what is chosen replaces whatever was there for that day.
 */
export function MealChooser({ recipes, unavailable = [], loading, loadFailed, onChoose, pending }: Props) {
  const [mode, setMode] = useState<"recipe" | "base">("recipe");
  const [query, setQuery] = useState("");
  // An incomplete recipe was picked: its base is named here, since its tags do not say.
  const [naming, setNaming] = useState<{ id: number; name: string } | null>(null);
  const shown = (recipes ?? []).filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
  const lacking = unavailable.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
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
      {naming ? (
        <>
          <p>
            <strong>{naming.name}</strong> hat noch nicht alle Tags. Welche Basis gab es?
          </p>
          <div className="base-grid">
            {BASES.map((b) => (
              <button
                key={b}
                type="button"
                className="base-tile"
                disabled={pending}
                onClick={() => onChoose(b, naming)}
              >
                <span aria-hidden="true">{BASE_EMOJI[b]}</span>
                {BASE_LABELS[b]}
              </button>
            ))}
          </div>
          <p className="muted">Die Tags lassen sich danach in KitchenOwl ergänzen.</p>
          <button type="button" className="secondary" onClick={() => setNaming(null)}>
            Zurück
          </button>
        </>
      ) : mode === "base" ? (
        <>
          <p className="muted">Für ein Essen, das nicht in KitchenOwl steht: nur die Beilage zählt.</p>
          <div className="base-grid">
            {BASES.map((b) => (
              <button key={b} type="button" className="base-tile" disabled={pending} onClick={() => onChoose(b, null)}>
                <span aria-hidden="true">{BASE_EMOJI[b]}</span>
                {BASE_LABELS[b]}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <SearchField value={query} onChange={setQuery} />
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
                <RecipeLine recipe={r} />
              </button>
            ))}
            {recipes && shown.length === 0 && lacking.length === 0 && <p className="muted">Kein Rezept gefunden.</p>}
            {lacking.length > 0 && (
              <>
                <h3 className="incomplete-title">Noch unvollständig</h3>
                <p className="muted incomplete-note">
                  Ihre Tags in KitchenOwl sind noch nicht vollständig. Du kannst sie trotzdem eintragen, wenn du die
                  Basis nennst.
                </p>
                {lacking.map((r) => (
                  <IncompleteRecipe key={r.id} recipe={r} onUse={() => setNaming({ id: r.id, name: r.name })} />
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
