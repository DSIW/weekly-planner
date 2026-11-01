import type { Proposal } from "./api";
import { dayLabel } from "./dates";
import { RecipeCardBody } from "./RecipeCardBody";
import { Swipeable } from "./Swipeable";

interface Props {
  proposal: Proposal;
  onAccept: () => void;
  onVeto: () => void;
  pending: boolean;
  error: string | null;
}

/** The other member's proposal, for you to decide on: a card with the picture, swipe right to accept, left to veto. */
export function ProposalCard({ proposal, onAccept, onVeto, pending, error }: Props) {
  const { recipe } = proposal;
  return (
    <section className="card">
      <h2>Vorschlag für {dayLabel(proposal.date)}</h2>
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
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" onClick={onAccept} disabled={pending}>
          Passt
        </button>
        <button type="button" className="secondary" onClick={onVeto} disabled={pending}>
          Nein
        </button>
      </div>
      <p className="muted">Nach rechts wischen passt, nach links sagt nein.</p>
    </section>
  );
}
