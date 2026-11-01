import type { ListLine } from "./api";
import { dayLabel } from "./dates";

interface Props {
  dinners: { date: string; recipeName: string }[] | undefined;
  items: ListLine[] | undefined;
  loading: boolean;
  loadFailed: boolean;
  onFinalize: () => void;
  pending: boolean;
  error: string | null;
}

/** The consolidated shopping list as it will be sent, with the button that sends it. Lines to check stand out. */
export function FinalizePanel({ dinners, items, loading, loadFailed, onFinalize, pending, error }: Props) {
  const review = items?.filter((i) => i.needsReview).length ?? 0;
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
        <ul className="list-preview" aria-label="Einkaufsliste">
          {items.map((i) => (
            <li key={i.name} className={i.needsReview ? "review" : ""}>
              <span>{i.name}</span>
              <span>{i.description || "ohne Menge"}</span>
              {i.needsReview && <span className="badge">bitte prüfen</span>}
            </li>
          ))}
        </ul>
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
      <button type="button" onClick={onFinalize} disabled={pending}>
        {pending ? "Wird eingetragen …" : "Einkaufsliste füllen"}
      </button>
    </section>
  );
}
