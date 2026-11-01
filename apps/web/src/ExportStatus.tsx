import type { ExportView, StepStatus } from "./api";
import { dayLabel } from "./dates";

interface Props {
  status: ExportView;
  onRetry: (resendUnconfirmed: boolean) => void;
  pending: boolean;
  error: string | null;
}

const STEP: Record<StepStatus, string> = {
  pending: "wartet",
  sending: "unklar, ob angekommen",
  done: "eingetragen",
};

/** A finalized plan whose export to KitchenOwl is not finished: what is done, what failed, and the retry. */
export function ExportStatus({ status, onRetry, pending, error }: Props) {
  const unsure =
    status.failure === "unconfirmed" ||
    status.days.some((d) => d.status === "sending") ||
    status.list.status === "sending";
  return (
    <section className="card">
      <h2>Eintragen in KitchenOwl</h2>
      <p className="muted">Die Planung ist abgeschlossen, aber noch nicht alles ist in KitchenOwl angekommen.</p>
      <ul className="plain" aria-label="Fortschritt">
        {status.days.map((d) => (
          <li key={d.date} className={d.status === "done" ? "" : "review"}>
            Planer {dayLabel(d.date)}, {d.recipeName}: {STEP[d.status]}
          </li>
        ))}
        <li className={status.list.status === "done" ? "" : "review"}>Einkaufsliste: {STEP[status.list.status]}</li>
      </ul>
      {status.failure === "refused" && (
        <p role="alert" className="error">
          KitchenOwl hat die Anfrage nicht angenommen. Nichts wurde doppelt eingetragen, ihr könnt es noch einmal
          versuchen.
        </p>
      )}
      {unsure && (
        <p role="alert" className="error">
          KitchenOwl hat nicht geantwortet, es ist unklar, ob der Schritt angekommen ist. Schaut in KitchenOwl nach.
          Fehlt er dort, sendet ihn noch einmal. Steht er schon da, würde er doppelt eingetragen.
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        {!unsure && (
          <button type="button" onClick={() => onRetry(false)} disabled={pending}>
            {pending ? "Sendet …" : "Erneut versuchen"}
          </button>
        )}
        {unsure && (
          <button type="button" onClick={() => onRetry(true)} disabled={pending}>
            {pending ? "Sendet …" : "Trotzdem erneut senden"}
          </button>
        )}
      </div>
    </section>
  );
}
