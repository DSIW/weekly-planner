import type { DeckCard } from "./api";
import { dayLabel } from "./dates";
import { RecipeCardBody } from "./RecipeCardBody";
import { Swipeable } from "./Swipeable";

/** How many cards wait visibly behind the top one; they also load their pictures early. */
const BEHIND = 2;

interface Props {
  date: string;
  cards: DeckCard[];
  onPropose: (card: DeckCard) => void;
  onPass: (card: DeckCard) => void;
  pending: boolean;
  error: string | null;
}

export function SwipeDeck({ date, cards, onPropose, onPass, pending, error }: Props) {
  const card = cards[0];
  const behind = cards.slice(1, 1 + BEHIND);

  return (
    <section className="card">
      <h2>Abendessen am {dayLabel(date)}</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {card ? (
        <>
          <div className="deck-stack">
            {behind.map((c, i) => (
              <div key={c.id} className={`deck-card behind behind-${i + 1}`} aria-hidden="true">
                <RecipeCardBody recipe={c} hint={false} />
              </div>
            ))}
            <Swipeable
              key={card.id}
              className="deck-card"
              label={card.name}
              right="Vorschlagen"
              left="Überspringen"
              onRight={() => onPropose(card)}
              onLeft={() => onPass(card)}
              disabled={pending}
            >
              <RecipeCardBody recipe={card} />
            </Swipeable>
          </div>
          <div className="actions">
            <button type="button" className="secondary" disabled={pending} onClick={() => onPass(card)}>
              Überspringen
            </button>
            <button type="button" disabled={pending} onClick={() => onPropose(card)}>
              Vorschlagen
            </button>
          </div>
          <p className="muted">Nach rechts wischen schlägt vor, nach links überspringt.</p>
        </>
      ) : (
        <p className="muted">Keine Vorschläge mehr. Über „Liste“ kannst du alle Rezepte durchsuchen.</p>
      )}
    </section>
  );
}
