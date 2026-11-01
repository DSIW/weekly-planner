import { useState } from "react";
import type { ListLine } from "./api";
import { dayLabel } from "./dates";

interface Props {
  dinners: { date: string; recipeName: string }[] | undefined;
  items: ListLine[] | undefined;
  loading: boolean;
  loadFailed: boolean;
  /** `skip`: the names of the ingredients that are in stock and stay off the list. */
  onFinalize: (skip: string[]) => void;
  pending: boolean;
  error: string | null;
}

/** The consolidated shopping list as it will be sent, with the button that sends it. Lines to check stand out. */
export function FinalizePanel({ dinners, items, loading, loadFailed, onFinalize, pending, error }: Props) {
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const toggle = (name: string) =>
    setSkipped((now) => {
      const next = new Set(now);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  const review = items?.filter((i) => i.needsReview && !skipped.has(i.name)).length ?? 0;
  return (
    <section className="card">
      <h2>Einkaufsliste</h2>
      <p className="muted">
        Mit einem Tipp kommen die geplanten Tage in den Planer und die Zutaten (für 2 Portionen) auf die Einkaufsliste.
        Danach lässt sich die Planung nicht mehr ändern.
      </p>
      {loading && <p className="muted">Lädt …</p>}
      {loadFailed && (
        <p role="alert" className="error">
          Die Einkaufsliste konnte nicht geladen werden.
        </p>
      )}
      {dinners && (
        <ul className="plain">
          {dinners.map((d) => (
            <li key={d.date}>
              {dayLabel(d.date)}: {d.recipeName}
            </li>
          ))}
        </ul>
      )}
      {items && items.length === 0 && <p className="muted">Für diese Rezepte sind keine Zutaten hinterlegt.</p>}
      {items && items.length > 0 && (
        <>
          <p className="muted">Was ihr schon da habt, einfach abwählen. Es kommt dann nicht auf die Liste.</p>
          <ul className="ingredient-grid" aria-label="Einkaufsliste">
            {items.map((i) => (
              <li key={i.name} className={i.needsReview ? "review" : ""}>
                <label className={skipped.has(i.name) ? "tile off" : "tile"}>
                  <input type="checkbox" checked={!skipped.has(i.name)} onChange={() => toggle(i.name)} />
                  <span className="tile-icon" aria-hidden="true">
                    {i.icon ?? "🛒"}
                  </span>
                  <span className="tile-name">{i.name}</span>
                  <span className="tile-amount">{i.description || "ohne Menge"}</span>
                  {i.needsReview && <span className="badge">bitte prüfen</span>}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      {review > 0 && (
        <p className="hint">
          {review === 1 ? "Eine Menge konnte" : `${review} Mengen konnten`} nicht gelesen werden. Sie wird unverändert
          eingetragen.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="button" onClick={() => onFinalize([...skipped])} disabled={pending}>
        {pending ? "Wird eingetragen …" : "Einkaufsliste füllen"}
      </button>
    </section>
  );
}
