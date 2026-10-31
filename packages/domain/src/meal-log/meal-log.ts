import type { Base, Recipe, RecipeId } from "../catalog/recipe.js";
import type { MealLogEntryId, MemberId } from "../shared/ids.js";
import { reject, succeed, type Outcome, type Result } from "../shared/result.js";
import type { PlanDate } from "../planning/dates.js";
import { plannedDays, type PlanningSession } from "../planning/session.js";

export type MealSource = "from_plan" | "corrected" | "added";

/** Aggregate root: what the household ate on one day. Base variety looks at these entries. */
export interface MealLogEntry {
  readonly id: MealLogEntryId;
  readonly date: PlanDate;
  readonly base: Base;
  /** Null for a meal that is not in KitchenOwl and was given by its base only. */
  readonly recipe: Recipe | null;
  readonly source: MealSource;
  /** A member said this was really cooked. */
  readonly confirmed: boolean;
}

export type MealLogEvent =
  | { readonly type: "MealLogged"; readonly entryId: MealLogEntryId; readonly date: PlanDate }
  | { readonly type: "MealConfirmedAsCooked"; readonly entryId: MealLogEntryId; readonly recipeId: RecipeId; readonly date: PlanDate }
  | { readonly type: "MealMarkedNotCooked"; readonly entryId: MealLogEntryId; readonly date: PlanDate };

const cooked = (e: MealLogEntry): MealLogEvent[] =>
  e.recipe ? [{ type: "MealConfirmedAsCooked", entryId: e.id, recipeId: e.recipe.id, date: e.date }] : [];

export interface DueDinner {
  readonly date: PlanDate;
  readonly recipe: Recipe;
}

/**
 * rule LogPlannedMeal (temporal): from the day after a planned dinner of a finalized or closed session,
 * the planned meal is due as the default log entry, until it has been logged.
 */
export function dinnersDueForLogging(
  session: PlanningSession,
  today: PlanDate,
  alreadyLogged: ReadonlySet<PlanDate>,
): DueDinner[] {
  if (session.status === "open") return [];
  return plannedDays(session).flatMap((d) =>
    d.recipe && d.date < today && !alreadyLogged.has(d.date) ? [{ date: d.date, recipe: d.recipe }] : [],
  );
}

/** rule LogPlannedMeal: the entry created from a planned dinner, not yet confirmed. */
export function logPlannedMeal(cmd: { id: MealLogEntryId; dinner: DueDinner }): Outcome<MealLogEntry, MealLogEvent> {
  const { id, dinner } = cmd;
  const state: MealLogEntry = { id, date: dinner.date, base: dinner.recipe.base, recipe: dinner.recipe, source: "from_plan", confirmed: false };
  return { state, events: [{ type: "MealLogged", entryId: id, date: dinner.date }] };
}

type Done = Result<Outcome<MealLogEntry, MealLogEvent>>;

/** rule ConfirmCooked: one tap, "we cooked it". */
export function confirmCooked(e: MealLogEntry, _cmd: { member: MemberId }): Done {
  if (!e.recipe) return reject("no_recipe");
  if (e.confirmed) return reject("already_confirmed");
  const state = { ...e, confirmed: true };
  return succeed({ state, events: cooked(state) });
}

/** rule MarkNotCooked: the entry is to be removed by the caller; it no longer counts for base variety. */
export function markNotCooked(e: MealLogEntry, _cmd: { member: MemberId }): Done {
  if (e.confirmed) return reject("already_confirmed");
  return succeed({ state: e, events: [{ type: "MealMarkedNotCooked", entryId: e.id, date: e.date }] });
}

/** rule CorrectLoggedMeal */
export function correctLoggedMeal(
  e: MealLogEntry,
  cmd: { member: MemberId; base: Base; recipe: Recipe | null },
): Outcome<MealLogEntry, MealLogEvent> {
  const state: MealLogEntry = { ...e, base: cmd.base, recipe: cmd.recipe, source: "corrected", confirmed: true };
  return { state, events: cooked(state) };
}

/** rule AddLoggedMeal: a past or present meal, possibly outside KitchenOwl (base only). */
export function addLoggedMeal(
  cmd: { id: MealLogEntryId; member: MemberId; date: PlanDate; base: Base; recipe: Recipe | null },
  today: PlanDate,
): Done {
  if (cmd.date > today) return reject("date_in_future");
  const state: MealLogEntry = { id: cmd.id, date: cmd.date, base: cmd.base, recipe: cmd.recipe, source: "added", confirmed: true };
  return succeed({ state, events: [{ type: "MealLogged", entryId: state.id, date: state.date }, ...cooked(state)] });
}
