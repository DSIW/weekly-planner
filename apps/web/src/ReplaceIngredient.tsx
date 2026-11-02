import { useEffect } from "react";
import { Suggest, type Suggestion } from "./Suggest";

interface Props {
  /** The ingredient that is being replaced. */
  name: string;
  onPick: (picked: Suggestion) => void;
  onClose: () => void;
}

/** A dialog to swap an ingredient of the draft for one of the household's items, found by typing. */
export function ReplaceIngredient({ name, onPick, onClose }: Props) {
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a tap outside closes it; Escape and the button do the same
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="replace-title">
        <h3 id="replace-title">„{name}“ ersetzen</h3>
        <p className="muted">Die Menge bleibt. Tippe, um eine Zutat aus KitchenOwl zu finden.</p>
        <Suggest
          kind="item"
          label="Neue Zutat"
          placeholder="Zutat suchen"
          autoFocus
          typedLabel={(text) => `„${text}“ als neue Zutat verwenden`}
          onPick={onPick}
        />
        <button type="button" className="secondary" onClick={onClose}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
