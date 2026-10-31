import { describe, expect, it } from "vitest";
import {
  addLoggedMeal, confirmCooked, correctLoggedMeal, dinnersDueForLogging, finalizePlan, closeSession, logPlannedMeal,
  markLeftoverDay, markNotCooked, mealLogEntryId, planDate, recipeId, registerCooking,
} from "../../src/index.js";
import { AC, ME, MON, TUE, WED, aRecipe, aSession, config, must, plan } from "../support/builders.js";

const finalized = (recipe = aRecipe()) => must(finalizePlan(plan(aSession(), MON, recipe), { member: AC }, config)).state;
const id = (n: string) => mealLogEntryId(n);

describe("rule LogPlannedMeal (temporal)", () => {
  const recipe = aRecipe({ name: "Pasta", base: "pasta" });

  it("is not due on the planned day itself, only from the day after", () => {
    expect(dinnersDueForLogging(finalized(recipe), MON, new Set())).toEqual([]);
    expect(dinnersDueForLogging(finalized(recipe), TUE, new Set())).toEqual([{ date: MON, recipe }]);
  });

  it("stays due on later days until it is logged, and is not logged twice", () => {
    expect(dinnersDueForLogging(finalized(recipe), WED, new Set())).toHaveLength(1);
    expect(dinnersDueForLogging(finalized(recipe), WED, new Set([MON]))).toEqual([]);
  });

  it("is rejected while the session is still open", () => {
    expect(dinnersDueForLogging(plan(aSession(), MON, recipe), TUE, new Set())).toEqual([]);
  });

  it("is rejected for days that are not planned", () => {
    const s = must(markLeftoverDay(aSession(), { member: AC, date: MON })).state;
    expect(dinnersDueForLogging(must(closeSession(s, { member: AC })).state, TUE, new Set())).toEqual([]);
  });

  it("also applies to a closed session that was finalized", () => {
    const closed = must(closeSession(finalized(recipe), { member: AC })).state;
    expect(dinnersDueForLogging(closed, TUE, new Set())).toHaveLength(1);
  });

  it("creates an unconfirmed entry from the plan with the recipe's base", () => {
    const { state, events } = logPlannedMeal({ id: id("e1"), dinner: { date: MON, recipe } });
    expect(state).toMatchObject({ date: MON, base: "pasta", source: "from_plan", confirmed: false, recipe: { id: recipe.id } });
    expect(events[0]).toMatchObject({ type: "MealLogged", date: MON });
  });
});

describe("rule ConfirmCooked", () => {
  const entry = (r = aRecipe()) => logPlannedMeal({ id: id("e1"), dinner: { date: MON, recipe: r } }).state;

  it("succeeds: the entry is confirmed and the recipe is reported as cooked", () => {
    const r = aRecipe();
    const { state, events } = must(confirmCooked(entry(r), { member: ME }));
    expect(state.confirmed).toBe(true);
    expect(events).toEqual([{ type: "MealConfirmedAsCooked", entryId: id("e1"), recipeId: r.id, date: MON }]);
  });
  it("is rejected for an entry without a recipe", () => {
    const e = must(addLoggedMeal({ id: id("e2"), member: AC, date: MON, base: "rice", recipe: null }, TUE)).state;
    expect(confirmCooked({ ...e, confirmed: false }, { member: AC })).toEqual({ ok: false, reason: "no_recipe" });
  });
  it("is rejected when already confirmed", () => {
    const confirmed = must(confirmCooked(entry(), { member: ME })).state;
    expect(confirmCooked(confirmed, { member: ME })).toEqual({ ok: false, reason: "already_confirmed" });
  });
});

describe("rule MarkNotCooked", () => {
  it("succeeds for an unconfirmed entry: it is to be removed so it no longer counts for variety", () => {
    const e = logPlannedMeal({ id: id("e1"), dinner: { date: MON, recipe: aRecipe() } }).state;
    expect(must(markNotCooked(e, { member: ME })).events).toEqual([{ type: "MealMarkedNotCooked", entryId: id("e1"), date: MON }]);
  });
  it("is rejected once confirmed", () => {
    const e = must(confirmCooked(logPlannedMeal({ id: id("e1"), dinner: { date: MON, recipe: aRecipe() } }).state, { member: ME })).state;
    expect(markNotCooked(e, { member: ME })).toEqual({ ok: false, reason: "already_confirmed" });
  });
});

describe("rule CorrectLoggedMeal", () => {
  const e0 = () => logPlannedMeal({ id: id("e1"), dinner: { date: MON, recipe: aRecipe({ base: "pasta" }) } }).state;

  it("replaces recipe and base, marks the entry corrected and confirmed, and reports the cooking", () => {
    const rice = aRecipe({ base: "rice" });
    const { state, events } = correctLoggedMeal(e0(), { member: ME, base: "rice", recipe: rice });
    expect(state).toMatchObject({ base: "rice", source: "corrected", confirmed: true, recipe: { id: rice.id } });
    expect(events).toEqual([{ type: "MealConfirmedAsCooked", entryId: id("e1"), recipeId: rice.id, date: MON }]);
  });

  it("accepts a meal outside KitchenOwl: only a base, no recipe, nothing to report", () => {
    const { state, events } = correctLoggedMeal(e0(), { member: ME, base: "potatoes", recipe: null });
    expect(state).toMatchObject({ base: "potatoes", recipe: null, confirmed: true, source: "corrected" });
    expect(events).toEqual([]);
  });
});

describe("rule AddLoggedMeal", () => {
  it("succeeds for a past date: created as added and confirmed", () => {
    const r = aRecipe();
    const { state, events } = must(addLoggedMeal({ id: id("e3"), member: AC, date: MON, base: "rice", recipe: r }, TUE));
    expect(state).toMatchObject({ date: MON, base: "rice", source: "added", confirmed: true });
    expect(events.map((e) => e.type)).toEqual(["MealLogged", "MealConfirmedAsCooked"]);
  });
  it("accepts today, a base only, and reports no cooking", () => {
    const { events } = must(addLoggedMeal({ id: id("e3"), member: AC, date: TUE, base: "pasta", recipe: null }, TUE));
    expect(events.map((e) => e.type)).toEqual(["MealLogged"]);
  });
  it("is rejected for a date in the future", () => {
    expect(addLoggedMeal({ id: id("e3"), member: AC, date: WED, base: "rice", recipe: null }, TUE)).toEqual({ ok: false, reason: "date_in_future" });
  });
});

describe("RecipeExperience (CookedRecipe)", () => {
  it("is created at the first confirmed cooking and never changes afterwards", () => {
    const first = registerCooking(null, recipeId(7), MON);
    expect(first).toEqual({ recipeId: 7, firstCooked: MON });
    expect(registerCooking(first, recipeId(7), planDate("2026-12-01"))).toEqual(first);
  });
});
