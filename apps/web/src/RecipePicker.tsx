import { useState } from "react";
import type { RecipeView } from "./api";
import { dayLabel } from "./dates";
import { timeLabel } from "./recipe-time";

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
      <label>
        Rezept suchen
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="recipes">
        {shown.map((r) => (
          <button key={r.id} type="button" className="recipe" disabled={pending} onClick={() => onPick(r)}>
            <span>{r.name}</span>
            <span className="muted">{timeLabel(r)}</span>
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
