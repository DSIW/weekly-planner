import { useState } from "react";
import type { RecipeView } from "./api";
import { dayLabel } from "./dates";
import { RecipeLine } from "./RecipeLine";
import { SearchField } from "./SearchField";

interface Props {
  date: string;
  recipes: RecipeView[];
  onPick: (recipe: RecipeView) => void;
  onRefresh: () => void;
  pending: boolean;
  refreshing: boolean;
  error: string | null;
}

export function RecipePicker({ date, recipes, onPick, onRefresh, pending, refreshing, error }: Props) {
  const [query, setQuery] = useState("");
  const shown = recipes.filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()));
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
        {shown.length === 0 && <p className="muted">Kein Rezept gefunden.</p>}
      </div>
      <button type="button" className="secondary" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? "Lädt …" : "Rezepte neu laden"}
      </button>
    </section>
  );
}
