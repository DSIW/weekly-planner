import type { PlanSession } from "./api";
import { dayLabel } from "./dates";

const STATUS = { open: "offen", planned: "geplant", leftovers: "Reste" } as const;

interface Props {
  session: PlanSession;
  onClose: () => void;
  pending: boolean;
  error: string | null;
}

export function PlanBoard({ session, onClose, pending, error }: Props) {
  return (
    <section className="card">
      <h2>Planung</h2>
      <ul className="days">
        {session.days.map((day) => (
          <li key={day.date}>
            <span>{dayLabel(day.date)}</span>
            <span className="muted">{STATUS[day.status]}</span>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="button" className="secondary" onClick={onClose} disabled={pending}>
        Planung verwerfen
      </button>
    </section>
  );
}
