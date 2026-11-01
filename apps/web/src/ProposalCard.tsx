import type { Proposal } from "./api";
import { dayLabel } from "./dates";
import { RecipeCardBody } from "./RecipeCardBody";
import { Swipeable } from "./Swipeable";

interface Props {
  proposal: Proposal;
  mine: boolean;
  onAccept: () => void;
  onVeto: () => void;
  onWithdraw: () => void;
  pending: boolean;
  error: string | null;
}

export function ProposalCard({ proposal, mine, onAccept, onVeto, onWithdraw, pending, error }: Props) {
  const { recipe } = proposal;
  return (
    <section className="card">
      <h2>Vorschlag für {dayLabel(proposal.date)}</h2>
      {mine ? (
        <div className="proposal-card">
          <RecipeCardBody recipe={recipe} />
        </div>
      ) : (
        <Swipeable
          className="proposal-card"
          label={recipe.name}
          right="Passt"
          left="Nein"
          onRight={onAccept}
          onLeft={onVeto}
          disabled={pending}
        >
          <RecipeCardBody recipe={recipe} />
        </Swipeable>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {mine ? (
        <>
          <p className="muted">Du hast das vorgeschlagen. Warte auf die Antwort.</p>
          <div className="actions">
            <button type="button" className="secondary" onClick={onWithdraw} disabled={pending}>
              Zurückziehen
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="actions">
            <button type="button" onClick={onAccept} disabled={pending}>
              Passt
            </button>
            <button type="button" className="secondary" onClick={onVeto} disabled={pending}>
              Nein
            </button>
          </div>
          <p className="muted">Nach rechts wischen passt, nach links sagt nein.</p>
        </>
      )}
    </section>
  );
}
