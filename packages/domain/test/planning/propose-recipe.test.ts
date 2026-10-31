import { describe, expect, it } from "vitest";
import { passSuggestion, proposeRecipe, vetoProposal, closeSession, type PlanningSession } from "../../src/index.js";
import { AC, ME, MON, SAT, SUN, TUE, WED, aRecipe, aSession, config, dayOf, must, newProposalId, plan, withProposal } from "../support/builders.js";

const propose = (s: PlanningSession, date = MON, recipe = aRecipe(), member = AC) =>
  proposeRecipe(s, { proposalId: newProposalId(), member, date, recipe }, config);

describe("rule ProposeRecipe", () => {
  it("succeeds for the next open day: a pending proposal is created", () => {
    const recipe = aRecipe();
    const { state, events } = must(propose(aSession(), MON, recipe));
    expect(state.proposals).toHaveLength(1);
    expect(state.proposals[0]).toMatchObject({ date: MON, status: "pending", proposedBy: AC });
    expect(state.proposals[0]?.recipe.id).toBe(recipe.id);
    expect(events[0]).toMatchObject({ type: "RecipeProposed", date: MON, recipeId: recipe.id, proposedBy: AC });
  });

  it("is rejected when the session is not open", () => {
    const closed = must(closeSession(aSession(), { member: AC })).state;
    expect(propose(closed)).toEqual({ ok: false, reason: "session_not_open" });
  });

  it("is rejected for a date that is not part of the session", () => {
    expect(propose(aSession([MON, TUE]), WED)).toEqual({ ok: false, reason: "unknown_day" });
  });

  it("is rejected when the day is not open", () => {
    const planned = plan(aSession(), MON, aRecipe());
    expect(propose(planned, MON)).toEqual({ ok: false, reason: "day_not_open" });
  });

  it("is rejected for any day but the next open day (one deck for the whole plan)", () => {
    expect(propose(aSession(), TUE)).toEqual({ ok: false, reason: "not_next_open_day" });
  });

  it("moves on to the next open day once the first is planned", () => {
    const s = plan(aSession(), MON, aRecipe());
    expect(propose(s, TUE).ok).toBe(true);
  });

  it("is rejected while another proposal for the day is still pending (first proposal wins)", () => {
    const { session } = withProposal(aSession(), MON, aRecipe(), AC);
    expect(propose(session, MON, aRecipe(), ME)).toEqual({ ok: false, reason: "proposal_already_pending" });
  });

  it.each(["side", "dessert", "baking", "breakfast", "snack", "drink"] as const)("is rejected for a %s (only main dishes are dinner)", (mealType) => {
    expect(propose(aSession(), MON, aRecipe({ mealType }))).toEqual({ ok: false, reason: "not_a_dinner" });
  });

  it("is rejected for a recipe vetoed earlier in the session", () => {
    const recipe = aRecipe();
    const { session, id } = withProposal(aSession(), MON, recipe, AC);
    const vetoed = must(vetoProposal(session, { member: ME, proposalId: id })).state;
    expect(propose(vetoed, MON, recipe, ME)).toEqual({ ok: false, reason: "recipe_vetoed" });
  });

  it("is rejected for a recipe that was passed in the session", () => {
    const recipe = aRecipe();
    const s = must(passSuggestion(aSession(), { member: ME, recipe })).state;
    expect(propose(s, MON, recipe)).toEqual({ ok: false, reason: "recipe_passed" });
  });

  it("is rejected for a recipe already planned on another day of the session", () => {
    const recipe = aRecipe();
    const s = plan(aSession(), MON, recipe);
    expect(propose(s, TUE, recipe)).toEqual({ ok: false, reason: "recipe_already_planned" });
  });

  it("applies the weekday time limit (46 minutes is too long, 45 is fine)", () => {
    expect(propose(aSession(), MON, aRecipe({ totalTimeMinutes: 46 }))).toEqual({ ok: false, reason: "too_long_for_weekday" });
    expect(propose(aSession(), MON, aRecipe({ totalTimeMinutes: 45 })).ok).toBe(true);
  });

  it("does not exclude a recipe whose time is unknown", () => {
    expect(propose(aSession(), MON, aRecipe({ totalTimeMinutes: null })).ok).toBe(true);
  });

  it("has no time limit on weekends", () => {
    const weekend = aSession([SAT, SUN]);
    expect(propose(weekend, SAT, aRecipe({ totalTimeMinutes: 300 })).ok).toBe(true);
  });

  it("does not change the plan day: it stays open until the proposal is accepted", () => {
    const { state } = must(propose(aSession()));
    expect(dayOf(state, MON).status).toBe("open");
  });
});

describe("rule PassSuggestion", () => {
  it("succeeds: the recipe is hidden for the rest of the session, for both members", () => {
    const recipe = aRecipe();
    const { state, events } = must(passSuggestion(aSession(), { member: ME, recipe }));
    expect(state.passes).toEqual([{ recipeId: recipe.id, passedBy: ME }]);
    expect(events[0]).toMatchObject({ type: "SuggestionPassed", recipeId: recipe.id, passedBy: ME });
  });

  it("is rejected when the session is not open", () => {
    const closed = must(closeSession(aSession(), { member: AC })).state;
    expect(passSuggestion(closed, { member: ME, recipe: aRecipe() })).toEqual({ ok: false, reason: "session_not_open" });
  });

  it("is rejected when the recipe was already passed", () => {
    const recipe = aRecipe();
    const s = must(passSuggestion(aSession(), { member: ME, recipe })).state;
    expect(passSuggestion(s, { member: AC, recipe })).toEqual({ ok: false, reason: "already_passed" });
  });
});
