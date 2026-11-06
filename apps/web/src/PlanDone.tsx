import type { ExportView } from "./api";
import { DayBadge } from "./DayBadge";
import { useLinks } from "./Links";

/** The page after a plan has been written to KitchenOwl: what went where, and the way to the shopping list. */
export function PlanDone({ done, onClose }: { done: ExportView; onClose: () => void }) {
  const links = useLinks();
  const lines = done.list.items.length;
  return (
    <section role="status" className="plan-done" aria-labelledby="done-title">
      <span className="done-mark" aria-hidden="true">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          width="40"
          height="40"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h2 id="done-title">Alles geplant</h2>
      <p className="muted plan-done-sub">
        {done.days.length} {done.days.length === 1 ? "Abendessen steht" : "Abendessen stehen"} im Planer
        {lines > 0 && ` und ${lines} ${lines === 1 ? "Eintrag" : "Einträge"} auf der Einkaufsliste`}.
      </p>
      <ul className="done-days" aria-label="Im Planer">
        {done.days.map((d) => (
          <li key={d.date} className="done-day">
            <DayBadge date={d.date} />
            <span className="done-recipe">{d.recipeName}</span>
          </li>
        ))}
      </ul>
      <div className="done-actions">
        {links && (
          <a className="button-link" href={links.list} target="_blank" rel="noopener noreferrer">
            Einkaufsliste öffnen
          </a>
        )}
        <button type="button" className="secondary" onClick={onClose}>
          Zur Startseite
        </button>
      </div>
    </section>
  );
}
