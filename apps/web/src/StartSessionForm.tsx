import { useState } from "react";
import type { TakenDate } from "./api";
import { dayLabel, upcomingDates } from "./dates";
import { DayBadge } from "./DayBadge";
import { useLinks, useRecipeHref } from "./Links";
import { RecipeThumb } from "./RecipeThumb";

const MIN = 1;
const MAX = 5;

interface Props {
  onStart: (dates: string[]) => void;
  pending: boolean;
  error: string | null;
  /** Dates that already hold a planned dinner: they are shown with that dinner but cannot be picked. */
  takenDates?: TakenDate[];
  /** Today's date; the form offers the following days. Injected for tests. */
  today?: Date;
}

function PlannedName({ taken }: { taken: TakenDate }) {
  const href = useRecipeHref(taken.recipeId ?? 0);
  return taken.recipeId !== undefined && href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {taken.recipeName}
    </a>
  ) : (
    taken.recipeName
  );
}

export function StartSessionForm({ onStart, pending, error, takenDates = [], today }: Props) {
  const links = useLinks();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (date: string) =>
    setPicked((now) => (now.includes(date) ? now.filter((d) => d !== date) : now.length < MAX ? [...now, date] : now));
  return (
    <>
      {takenDates.some((t) => t.recipeId !== undefined) && (
        <section className="card">
          <h2>Schon geplant</h2>
          <ul className="plain planned-days" aria-label="Schon geplant">
            {takenDates.map((t) => (
              <li key={t.date} className="dinner">
                <DayBadge date={t.date} />
                <span className="recipe-line">
                  {t.recipeId !== undefined && <RecipeThumb key={t.recipeId} recipeId={t.recipeId} />}
                  <span className="recipe-line-text">
                    <strong>
                      <PlannedName taken={t} />
                    </strong>
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {links && (
            <a className="link-button" href={links.list} target="_blank" rel="noopener noreferrer">
              Einkaufsliste in KitchenOwl öffnen
            </a>
          )}
        </section>
      )}
      <section className="card">
        <h2>Neue Planung</h2>
        <fieldset className="day-chips">
          <legend className="sr-only">Tage</legend>
          {upcomingDates(7, today).map((date) => {
            const taken = takenDates.find((t) => t.date === date);
            return (
              <button
                key={date}
                type="button"
                className="chip day-chip"
                aria-pressed={picked.includes(date)}
                disabled={taken !== undefined}
                title={taken ? `Hier ist schon ein Essen geplant: ${taken.recipeName}` : undefined}
                onClick={() => toggle(date)}
              >
                <span>{dayLabel(date)}</span>
                {taken && <small>{taken.recipeName || "schon geplant"}</small>}
              </button>
            );
          })}
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="button" disabled={pending || picked.length < MIN} onClick={() => onStart([...picked].sort())}>
          {pending ? "Starte …" : "Planung starten"}
        </button>
      </section>
    </>
  );
}
