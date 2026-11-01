import { useState } from "react";
import type { ListLine, RecipeView } from "./api";
import { DayBadge } from "./DayBadge";
import { ItemIcon } from "./ItemIcon";
import { RecipeLine } from "./RecipeLine";

interface Props {
  /** The agreed dishes, in date order. */
  dinners: { date: string; recipe: RecipeView }[];
  items: ListLine[] | undefined;
  loading: boolean;
  loadFailed: boolean;
  /** `skip`: the names of the ingredients that are in stock and stay off the list. */
  onFinalize: (skip: string[]) => void;
  onBack: () => void;
  pending: boolean;
  error: string | null;
}

/**
 * The last step: the consolidated shopping list as it will be sent, with the button that sends it. What a kitchen has
 * anyway (salt, pepper, oil, water) starts off the list; a tap on any tile flips it. Lines to check stand out.
 */
export function FinalizePanel({ dinners, items, loading, loadFailed, onFinalize, onBack, pending, error }: Props) {
  // The names whose default was flipped: a staple put back on the list, or anything else taken off it.
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const toggle = (name: string) =>
    setFlipped((now) => {
      const next = new Set(now);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  const isOff = (i: ListLine) => (i.staple === true) !== flipped.has(i.name);
  const off = items?.filter(isOff) ?? [];
  const review = items?.filter((i) => i.needsReview && !isOff(i)).length ?? 0;
  return (
    <section className="card">
      <h2>Einkaufsliste</h2>
      <ul className="plain" aria-label="Gerichte">
        {dinners.map((d) => (
          <li key={d.date} className="dinner">
            <DayBadge date={d.date} />
            <RecipeLine recipe={d.recipe} />
          </li>
        ))}
      </ul>
      {loading && <p className="muted">Lädt …</p>}
      {loadFailed && (
        <p role="alert" className="error">
          Die Einkaufsliste konnte nicht geladen werden.
        </p>
      )}
      {items && items.length === 0 && <p className="muted">Für diese Rezepte sind keine Zutaten hinterlegt.</p>}
      {items && items.length > 0 && (
        <ul className="ingredient-grid" aria-label="Einkaufsliste">
          {items.map((i) => (
            <li key={i.name} className={i.needsReview ? "review" : ""}>
              <label className={isOff(i) ? "tile off" : "tile"}>
                <input type="checkbox" checked={!isOff(i)} onChange={() => toggle(i.name)} />
                <ItemIcon icon={i.icon ?? null} name={i.name} />
                <span className="tile-name">{i.name}</span>
                <span className="tile-amount">{i.description || "ohne Menge"}</span>
                {i.needsReview && <span className="badge">bitte prüfen</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {review > 0 && (
        <p className="hint">
          {review === 1 ? "Eine Menge konnte" : `${review} Mengen konnten`} nicht gelesen werden (markiert mit „bitte
          prüfen“). {review === 1 ? "Sie kommt" : "Sie kommen"} so auf die Liste, wie sie im Rezept steht.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="button" onClick={() => onFinalize(off.map((i) => i.name))} disabled={pending || loading}>
        {pending ? "Wird eingetragen …" : "Einkaufsliste füllen"}
      </button>
      <button type="button" className="secondary" onClick={onBack} disabled={pending}>
        Zurück zu den Gerichten
      </button>
    </section>
  );
}
