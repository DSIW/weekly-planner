import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { type RelatedRecipe, relatedRecipes } from "./api";
import { useRecipeHref } from "./Links";

const WHY: Record<RelatedRecipe["reasons"][number], string> = {
  same_source: "gleiche Quelle",
  similar_name: "ähnlicher Name",
  shared_ingredients: "",
};

const why = (r: RelatedRecipe): string =>
  r.reasons
    .map((reason) => (reason === "shared_ingredients" ? `${r.sharedIngredients} gleiche Zutaten` : WHY[reason]))
    .join(", ");

function Related({ recipe }: { recipe: RelatedRecipe }) {
  const href = useRecipeHref(recipe.id);
  return (
    <li>
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {recipe.name}
        </a>
      ) : (
        <strong>{recipe.name}</strong>
      )}
      <span className="muted"> – {why(recipe)}</span>
    </li>
  );
}

/** A value that follows `value` a moment after it stopped changing, so typing does not ask the server every letter. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Recipes the household already has that look like the draft. It only tells: the member decides whether the recipe
 * is still wanted. It follows the draft as it is edited (the name, the ingredients), and says nothing when there is
 * nothing, or when the check did not work.
 */
export function RelatedRecipes({
  name,
  ingredients,
  source,
}: {
  name: string;
  ingredients: string[];
  source?: string | undefined;
}) {
  const asked = useSettled(JSON.stringify({ name: name.trim(), ingredients, source }), 400);
  const related = useQuery({
    queryKey: ["related", asked],
    queryFn: () => relatedRecipes(JSON.parse(asked) as Parameters<typeof relatedRecipes>[0]),
    enabled: name.trim() !== "",
    retry: false,
    staleTime: 60_000,
  });
  if (!related.data || related.data.length === 0) return null;
  const sameSource = related.data.some((r) => r.reasons.includes("same_source"));
  return (
    <section className="related" aria-label="Ähnliche Rezepte">
      <h3>{sameSource ? "Dieses Rezept gibt es schon" : "Ähnliche Rezepte in KitchenOwl"}</h3>
      <ul>
        {related.data.map((r) => (
          <Related key={r.id} recipe={r} />
        ))}
      </ul>
      <p className="muted">Du entscheidest, ob du es trotzdem anlegen möchtest.</p>
    </section>
  );
}
