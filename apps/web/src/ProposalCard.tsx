import type { Proposal } from "./api";
import { dayLabel } from "./dates";
import { timeLabel } from "./recipe-time";

interface Props {
  proposal: Proposal;
  mine: boolean;
  onAccept: () => void;
  onVeto: () => void;
  pending: boolean;
  error: string | null;
}

export function ProposalCard({ proposal, mine, onAccept, onVeto, pending, error }: Props) {
  const { recipe } = proposal;
  return (
    <section className="card">
      <h2>Vorschlag für {dayLabel(proposal.date)}</h2>
      <p className="proposal">{recipe.name}</p>
      <p className="muted">{timeLabel(recipe)}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {mine ? (
        <p className="muted">Du hast das vorgeschlagen. Warte auf die Antwort.</p>
      ) : (
        <div className="actions">
          <button type="button" onClick={onAccept} disabled={pending}>
            Passt
          </button>
          <button type="button" className="secondary" onClick={onVeto} disabled={pending}>
            Nein
          </button>
        </div>
      )}
    </section>
  );
}
