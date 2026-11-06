import { planDate, proposalId, recipeId, memberId, type Recipe } from "@weekly-planner/domain";
import { describe, expect, it } from "vitest";
import {
  readExport,
  readPasses,
  readProposals,
  readRecipe,
  readRecipeSummary,
  StoredDataError,
} from "../../src/infrastructure/sqlite/stored-json.js";

const recipe: Recipe = {
  id: recipeId(7),
  name: "Linsen-Dal",
  mealType: "main",
  base: "rice",
  diet: "vegan",
  totalTimeMinutes: 35,
  isProven: true,
  wantsToTry: false,
  yields: 4,
  tags: ["🍛 Curry"],
  ingredients: [
    { id: 3, name: "Linsen", description: "200 g", optional: false, category: "Hülsenfrüchte", icon: "lentils" },
  ],
};

describe("stored JSON", () => {
  it("reads back exactly what the domain wrote", () => {
    expect(readRecipe(JSON.stringify(recipe), "r")).toEqual(recipe);
    const proposals = [
      {
        id: proposalId("p1"),
        date: planDate("2026-11-03"),
        recipe,
        proposedBy: memberId("1"),
        status: "accepted" as const,
        decidedBy: memberId("2"),
      },
    ];
    expect(readProposals(JSON.stringify(proposals), "p")).toEqual(proposals);
    const passes = [{ recipeId: recipeId(9), passedBy: memberId("1") }];
    expect(readPasses(JSON.stringify(passes), "p")).toEqual(passes);
  });

  it("accepts a recipe copy from before tags and ingredients were kept, and a time of null", () => {
    const { tags: _t, ingredients: _i, ...old } = recipe;
    expect(readRecipe(JSON.stringify({ ...old, totalTimeMinutes: null }), "r")).toEqual({
      ...old,
      totalTimeMinutes: null,
    });
  });

  it("keeps a field it does not know, so saving never drops data", () => {
    const read = readRecipe(JSON.stringify({ ...recipe, futureField: 1 }), "r");
    expect((read as unknown as { futureField: number }).futureField).toBe(1);
  });

  it("reads an export", () => {
    const e = {
      sessionId: "s1",
      days: [{ date: "2026-11-03", recipeId: 7, recipeName: "Linsen-Dal", portions: 2, status: "done" }],
      list: {
        items: [{ name: "Linsen", description: "200 g", needsReview: false, recipes: ["Linsen-Dal"] }],
        status: "pending",
      },
      failure: null,
    };
    expect(readExport(JSON.stringify(e), "e")).toEqual(e);
  });

  it("names the row and the field when a row is unreadable", () => {
    expect(() => readRecipe(JSON.stringify({ ...recipe, base: "noodles" }), "plan_day s1 2026-11-03")).toThrow(
      /plan_day s1 2026-11-03.*base/,
    );
    expect(() => readProposals('{"not":"an array"}', "planning_session s1 proposals_json")).toThrow(StoredDataError);
    expect(() => readExport("{broken", "finalize_export s1")).toThrow(/finalize_export s1/);
    expect(() => readExport(JSON.stringify({ sessionId: "s1" }), "finalize_export s1")).toThrow(/days/);
  });

  it("reads the summary the taken-dates list needs, with or without an id", () => {
    expect(readRecipeSummary('{"name":"Pizza"}', "d")).toEqual({ name: "Pizza" });
    expect(readRecipeSummary(JSON.stringify(recipe), "d").id).toBe(7);
  });
});
