import { photoUrl, type Proposal } from "./api";
import { dayLabel } from "./dates";

interface Props {
  proposals: Proposal[];
  onWithdraw: (proposal: Proposal) => void;
  pending: boolean;
  error: string | null;
}

/** Your own proposals that wait for the other member's answer: short rows, so adding one moves nothing above. */
export function WaitingProposals({ proposals, onWithdraw, pending, error }: Props) {
  return (
    <section className="card">
      <h2>Wartet auf Antwort</h2>
      <ul className="waiting" aria-label="Wartet auf Antwort">
        {proposals.map((p) => (
          <li key={p.id}>
            <img className="thumb" src={photoUrl(p.recipe.id)} alt="" draggable={false} />
            <span className="waiting-text">
              <strong>{p.recipe.name}</strong>
              <span className="muted">{dayLabel(p.date)}</span>
            </span>
            <button type="button" className="secondary small" disabled={pending} onClick={() => onWithdraw(p)}>
              Zurückziehen
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
