import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { createImport, draftImport, ImportFailed, type RecipeDraft } from "./api";
import { useLinks } from "./Links";

const MESSAGES: Record<string, string> = {
  need_one_source: "Bitte einen Link oder einen Text einfügen.",
  invalid_address: "Das ist kein gültiger Link.",
  address_not_public: "Diese Adresse darf nicht gelesen werden.",
  unreachable: "Die Seite war nicht erreichbar.",
  not_a_page: "Unter dem Link liegt keine Webseite.",
  too_large: "Die Seite ist zu groß.",
  empty: "Auf der Seite wurde kein Text gefunden.",
  not_configured: "Der Import ist auf dem Server noch nicht eingerichtet.",
  extraction_failed: "Das Rezept konnte nicht gelesen werden. Bitte später noch einmal versuchen.",
  not_a_recipe: "Darin wurde kein Rezept gefunden.",
  too_many_steps: "Das ist für ein Rezept zu lang.",
  too_many_ingredients: "Das ist für ein Rezept zu lang.",
  kitchenowl_unavailable: "KitchenOwl ist gerade nicht erreichbar.",
  rate_limited: "Zu viele Versuche. Bitte in einer Stunde noch einmal.",
};
const messageFor = (e: unknown): string =>
  MESSAGES[e instanceof ImportFailed ? e.reason : "unavailable"] ??
  "Das hat nicht geklappt. Bitte später noch einmal versuchen.";

const MEAL: Record<string, string> = {
  main: "Hauptgericht",
  side: "Beilage",
  dessert: "Dessert",
  baking: "Backen",
  breakfast: "Frühstück",
  snack: "Snack",
  drink: "Getränk",
  prep: "Mise en place",
};
const DIET: Record<string, string> = { vegan: "Vegan", vegetarian: "Vegetarisch", fish: "Fisch", meat: "Fleisch" };
const BASE: Record<string, string> = {
  pasta: "Pasta",
  rice: "Reis",
  potatoes: "Kartoffeln",
  grains: "Getreide",
  bread: "Brot",
  other: "Sonstiges",
};

const isLink = (s: string): boolean => /^https?:\/\/\S+$/i.test(s);

/** A link or a pasted text becomes a recipe in KitchenOwl: read, reviewed here, then created. */
export function ImportPanel() {
  const links = useLinks();
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const read = useMutation({
    mutationFn: (text: string) => draftImport(isLink(text) ? { address: text } : { text }),
    onSuccess: setDraft,
  });
  const create = useMutation({ mutationFn: createImport });

  if (create.data) {
    const recipeHref = links?.recipe.replace("{id}", String(create.data.recipeId));
    return (
      <section className="card">
        <h2>Rezept angelegt</h2>
        <p role="status" className="success">
          „{create.data.draft.name}“ ist jetzt in KitchenOwl.
        </p>
        {recipeHref && (
          <a className="link-button" href={recipeHref} target="_blank" rel="noopener noreferrer">
            In KitchenOwl öffnen
          </a>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            create.reset();
            read.reset();
            setDraft(null);
            setInput("");
          }}
        >
          Noch ein Rezept importieren
        </button>
      </section>
    );
  }

  if (draft) {
    const set = (change: Partial<RecipeDraft>) => setDraft({ ...draft, ...change });
    const facts = [
      MEAL[draft.mealType],
      BASE[draft.base],
      DIET[draft.diet],
      draft.totalMinutes ? `${draft.totalMinutes} Min.` : null,
      draft.yields ? `${draft.yields} Portionen` : null,
    ].filter((f): f is string => Boolean(f));
    return (
      <section className="card import-draft">
        <h2>Rezept prüfen</h2>
        <label>
          Name
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        {draft.subtitle && <p className="muted">{draft.subtitle}</p>}
        <ul className="chips" aria-label="Eigenschaften">
          {[...facts, ...draft.tags].map((f) => (
            <li key={f} className="badge">
              {f}
            </li>
          ))}
        </ul>
        <h3>Zutaten</h3>
        <ul className="plain import-ingredients" aria-label="Zutaten">
          {draft.ingredients.map((i) => (
            <li key={i.name}>
              <span className="import-name">{i.name}</span>
              <span className="tile-amount">{i.amount || "ohne Menge"}</span>
              {i.isNewItem && <span className="badge">neu</span>}
              {i.optional && <span className="badge">optional</span>}
              <button
                type="button"
                className="secondary small"
                aria-label={`${i.name} entfernen`}
                onClick={() => set({ ingredients: draft.ingredients.filter((x) => x !== i) })}
              >
                Entfernen
              </button>
            </li>
          ))}
        </ul>
        <h3>Schritte</h3>
        <ol className="import-steps" aria-label="Schritte">
          {draft.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {draft.source && <p className="muted">Quelle: {draft.source}</p>}
        {create.isError && (
          <p role="alert" className="error">
            {messageFor(create.error)}
          </p>
        )}
        <button
          type="button"
          disabled={create.isPending || draft.name.trim() === "" || draft.ingredients.length === 0}
          onClick={() => create.mutate(draft)}
        >
          {create.isPending ? "Wird angelegt …" : "In KitchenOwl anlegen"}
        </button>
        <button type="button" className="secondary" disabled={create.isPending} onClick={() => setDraft(null)}>
          Verwerfen
        </button>
      </section>
    );
  }

  const text = input.trim();
  return (
    <section className="card">
      <h2>Rezept importieren</h2>
      <label>
        Link oder Rezepttext
        <textarea
          rows={5}
          placeholder="https://… oder den Text eines Rezepts einfügen"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </label>
      {read.isError && (
        <p role="alert" className="error">
          {messageFor(read.error)}
        </p>
      )}
      <button type="button" disabled={read.isPending || text === ""} onClick={() => read.mutate(text)}>
        {read.isPending ? "Wird gelesen … das kann eine Minute dauern" : "Rezept lesen"}
      </button>
    </section>
  );
}
