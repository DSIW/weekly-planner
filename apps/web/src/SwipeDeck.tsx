import { useState } from "react";
import { photoUrl, type DeckCard } from "./api";
import { dayLabel } from "./dates";
import { timeLabel } from "./recipe-time";
import { Swipeable } from "./Swipeable";

const BASES: Record<string, string> = {
  pasta: "Pasta",
  rice: "Reis",
  potatoes: "Kartoffeln",
  grains: "Getreide",
  bread: "Brot",
  other: "Sonstiges",
};
const DIETS: Record<string, string> = { vegan: "Vegan", vegetarian: "Vegetarisch", fish: "Fisch", meat: "Fleisch" };

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
  const [noPhoto, setNoPhoto] = useState<number[]>([]);

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
          <Swipeable
            className="deck-card"
            label={card.name}
            right="Vorschlagen"
            left="Überspringen"
            onRight={() => onPropose(card)}
            onLeft={() => onPass(card)}
            disabled={pending}
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
          </Swipeable>
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
