import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  addMeal,
  confirmMeal,
  correctMeal,
  fetchMealLog,
  fetchRecipes,
  notCooked,
  removeMeal,
  type MealEntry,
} from "./api";
import { dayLabel, recentDates, todayPlanDate } from "./dates";
import { DayBadge } from "./DayBadge";
import { BASE_EMOJI, BASE_LABELS, MealChooser } from "./MealChooser";
import { RecipeCardBody } from "./RecipeCardBody";
import { RecipeLine } from "./RecipeLine";

const HISTORY_DAYS = 14;

interface Props {
  /** Turns a failure into what a member reads. */
  messageFor: (error: unknown) => string | null;
  /** Today's date; injected for tests. */
  today?: string;
}

/** A meal that came from the plan and nobody has answered yet: asked about the day after. */
const isDue = (e: MealEntry, today: string): boolean => e.source === "from_plan" && !e.confirmed && e.date < today;

const mealName = (e: MealEntry): string => e.recipe?.name ?? `${BASE_LABELS[e.base]} (ohne Rezept)`;

/** The day after: "did you cook it?" for each planned dinner. Shown with the plan, since it asks for an answer. */
export function DueMeals({ messageFor, today = todayPlanDate() }: Props) {
  const client = useQueryClient();
  const log = useQuery({ queryKey: ["meal-log"], queryFn: () => fetchMealLog(HISTORY_DAYS) });
  const [choosing, setChoosing] = useState<string | null>(null);
  const recipes = useQuery({
    queryKey: ["meal-log", "recipes"],
    queryFn: fetchRecipes,
    enabled: choosing !== null,
  });
  const done = () => client.invalidateQueries({ queryKey: ["meal-log"] });
  const confirm = useMutation({ mutationFn: confirmMeal, onSettled: done });
  const skip = useMutation({ mutationFn: notCooked, onSettled: done });
  const correct = useMutation({
    mutationFn: (v: { id: string; base: Parameters<typeof correctMeal>[1]; recipeId: number | null }) =>
      correctMeal(v.id, v.base, v.recipeId),
    onSuccess: () => setChoosing(null),
    onSettled: done,
  });

  const entries = log.data ?? [];
  const due = entries.filter((e) => isDue(e, today)).sort((a, b) => a.date.localeCompare(b.date));
  const failure = messageFor(confirm.error ?? skip.error ?? correct.error);
  const busy = confirm.isPending || skip.isPending || correct.isPending;

  return (
    <>
      {due.map((e) => (
        <section key={e.id} className="card">
          <h2>Habt ihr das gekocht? {dayLabel(e.date)}</h2>
          {e.recipe && (
            <div className="deck-card">
              <RecipeCardBody recipe={e.recipe} hint={false} />
            </div>
          )}
          {failure && (
            <p role="alert" className="error">
              {failure}
            </p>
          )}
          {choosing === e.id ? (
            <>
              <MealChooser
                recipes={recipes.data}
                loading={recipes.isPending}
                loadFailed={recipes.isError}
                pending={correct.isPending}
                onChoose={(base, recipe) => correct.mutate({ id: e.id, base, recipeId: recipe?.id ?? null })}
              />
              <button type="button" className="secondary" onClick={() => setChoosing(null)}>
                Abbrechen
              </button>
            </>
          ) : (
            <div className="actions meal">
              <button type="button" disabled={busy} onClick={() => confirm.mutate(e.id)}>
                Gekocht
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => skip.mutate(e.id)}>
                Nicht gekocht
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => setChoosing(e.id)}>
                Etwas anderes
              </button>
            </div>
          )}
        </section>
      ))}
    </>
  );
}

/** The log of what was eaten, with a way to add a meal and to take one out. A tab of its own. */
export function MealHistory({ messageFor, today = todayPlanDate() }: Props) {
  const client = useQueryClient();
  const log = useQuery({ queryKey: ["meal-log"], queryFn: () => fetchMealLog(HISTORY_DAYS) });
  const [adding, setAdding] = useState(false);
  const [addDate, setAddDate] = useState(today);
  const recipes = useQuery({ queryKey: ["meal-log", "recipes"], queryFn: fetchRecipes, enabled: adding });
  const done = () => client.invalidateQueries({ queryKey: ["meal-log"] });
  const add = useMutation({
    mutationFn: (v: { base: Parameters<typeof addMeal>[1]; recipeId: number | null }) =>
      addMeal(addDate, v.base, v.recipeId),
    onSuccess: () => setAdding(false),
    onSettled: done,
  });
  const remove = useMutation({ mutationFn: removeMeal, onSettled: done });
  const entries = log.data ?? [];
  return (
    <section className="card history">
      <h2>Verlauf</h2>
      {log.isError && <p className="error">Der Verlauf konnte nicht geladen werden.</p>}
      {log.data && entries.length === 0 && <p className="muted">Noch nichts eingetragen.</p>}
      {entries.length > 0 && (
        <ul className="history-list" aria-label="Verlauf">
          {entries.map((e) => (
            <li key={e.id}>
              <DayBadge date={e.date} />
              {e.recipe ? (
                <RecipeLine recipe={e.recipe} detail={e.confirmed ? "gekocht" : "offen"} />
              ) : (
                <span className="recipe-line">
                  <span className="thumb base-thumb" aria-hidden="true">
                    {BASE_EMOJI[e.base]}
                  </span>
                  <span className="recipe-line-text">
                    <strong>{mealName(e)}</strong>
                    <span className="muted">{e.confirmed ? "gekocht" : "offen"}</span>
                  </span>
                </span>
              )}
              <button
                type="button"
                className="secondary small"
                disabled={remove.isPending}
                aria-label={`${mealName(e)}, ${dayLabel(e.date)}, entfernen`}
                onClick={() => remove.mutate(e.id)}
              >
                Entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
      {remove.isError && (
        <p role="alert" className="error">
          {messageFor(remove.error)}
        </p>
      )}
      {adding ? (
        <>
          <label>
            Tag
            <select value={addDate} onChange={(ev) => setAddDate(ev.target.value)}>
              {recentDates(7, new Date(`${today}T12:00:00`))
                .reverse()
                .map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
            </select>
          </label>
          {entries.some((e) => e.date === addDate) && (
            <p className="muted">Was für diesen Tag eingetragen ist, wird ersetzt.</p>
          )}
          {add.isError && (
            <p role="alert" className="error">
              {messageFor(add.error)}
            </p>
          )}
          <MealChooser
            recipes={recipes.data}
            loading={recipes.isPending}
            loadFailed={recipes.isError}
            pending={add.isPending}
            onChoose={(base, recipe) => add.mutate({ base, recipeId: recipe?.id ?? null })}
          />
          <button type="button" className="secondary" onClick={() => setAdding(false)}>
            Abbrechen
          </button>
        </>
      ) : (
        <button type="button" className="secondary" onClick={() => setAdding(true)}>
          Mahlzeit nachtragen
        </button>
      )}
    </section>
  );
}
