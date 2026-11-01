import { useEffect, useRef, useState } from "react";
import { photoUrl } from "./api";

/**
 * A recipe's picture. While it loads a spinner shows, never the picture of the card before (give the component a
 * `key` of the recipe so a new recipe starts fresh); a recipe without a picture gets a placeholder.
 */
export function RecipeImage({ recipeId }: { recipeId: number }) {
  const [state, setState] = useState<"loading" | "loaded" | "missing">("loading");
  const img = useRef<HTMLImageElement>(null);

  // A picture from the cache can be complete before React listens for its load event.
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth > 0) setState("loaded");
  }, []);

  return (
    <div className="photo" data-state={state}>
      {state !== "missing" && (
        <img
          ref={img}
          className="deck-photo"
          src={photoUrl(recipeId)}
          alt=""
          draggable={false}
          onLoad={() => setState("loaded")}
          onError={() => setState("missing")}
        />
      )}
      {state === "loading" && <span className="spinner" role="status" aria-label="Bild wird geladen" />}
      {state === "missing" && (
        <span className="photo-placeholder" aria-hidden="true">
          🍽️
        </span>
      )}
    </div>
  );
}
