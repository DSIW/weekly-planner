import { useRef, useState, type PointerEvent } from "react";
import { photoUrl, type DeckCard } from "./api";
import { dayLabel } from "./dates";
import { timeLabel } from "./recipe-time";

const BASES: Record<string, string> = {
  pasta: "Pasta",
  rice: "Reis",
  potatoes: "Kartoffeln",
  grains: "Getreide",
  bread: "Brot",
  other: "Sonstiges",
};
const DIETS: Record<string, string> = { vegan: "Vegan", vegetarian: "Vegetarisch", fish: "Fisch", meat: "Fleisch" };

/** How far a card has to be dragged sideways before it counts as a decision. */
const THRESHOLD = 90;

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
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  const [noPhoto, setNoPhoto] = useState<number[]>([]);

  const down = (e: PointerEvent<HTMLElement>) => {
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (startX.current !== null) setDx(e.clientX - startX.current);
  };
  const up = (e: PointerEvent<HTMLElement>) => {
    if (startX.current === null || !card || pending) return reset();
    const moved = e.clientX - startX.current;
    reset();
    if (moved > THRESHOLD) onPropose(card);
    else if (moved < -THRESHOLD) onPass(card);
  };
  const reset = () => {
    startX.current = null;
    setDx(0);
  };

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
          <article
            className="deck-card"
            aria-label={card.name}
            style={{
              transform: `translateX(${dx}px) rotate(${dx / 25}deg)`,
              transition: dx === 0 ? "transform 0.2s" : "none",
            }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={reset}
          >
            {!noPhoto.includes(card.id) && (
              <img
                className="deck-photo"
                src={photoUrl(card.id)}
                alt=""
                draggable={false}
                onError={() => setNoPhoto((ids) => [...ids, card.id])}
              />
            )}
            <h3>{card.name}</h3>
            <p className="muted">{timeLabel(card)}</p>
            <p className="badges">
              <span className="badge">{BASES[card.base] ?? card.base}</span>
              <span className="badge">{DIETS[card.diet] ?? card.diet}</span>
              {card.isNew && <span className="badge new">Neu</span>}
            </p>
            {card.needsTime && <p className="hint">Zeit fehlt: bitte in KitchenOwl eintragen.</p>}
          </article>
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
