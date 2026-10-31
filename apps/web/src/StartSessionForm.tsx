import { useState } from "react";
import { dayLabel, upcomingDates } from "./dates";

const MIN = 2;
const MAX = 3;

interface Props {
  onStart: (dates: string[]) => void;
  pending: boolean;
  error: string | null;
  /** Today's date; the form offers the following days. Injected for tests. */
  today?: Date;
}

export function StartSessionForm({ onStart, pending, error, today }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (date: string) =>
    setPicked((now) => (now.includes(date) ? now.filter((d) => d !== date) : now.length < MAX ? [...now, date] : now));
  return (
    <section className="card">
      <h2>Neue Planung</h2>
      <p className="muted">
        Wähle {MIN} oder {MAX} Tage, für die ihr das Abendessen festlegen wollt.
      </p>
      <fieldset className="chips">
        <legend className="sr-only">Tage</legend>
        {upcomingDates(7, today).map((date) => (
          <button
            key={date}
            type="button"
            className="chip"
            aria-pressed={picked.includes(date)}
            onClick={() => toggle(date)}
          >
            {dayLabel(date)}
          </button>
        ))}
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
  );
}
