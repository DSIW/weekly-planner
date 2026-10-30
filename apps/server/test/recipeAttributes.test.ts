import { describe, expect, it } from "vitest";
import { isVegetarian, needsTime } from "@weekly-planner/domain";
import { deriveRecipe } from "../src/kitchenowl/recipeAttributes.js";
import type { RawRecipe } from "../src/kitchenowl/schemas.js";

const raw = (tags: string[], over: Partial<RawRecipe> = {}): RawRecipe => ({
  id: 1,
  name: "Testgericht",
  description: "",
  tags: tags.map((name) => ({ name })),
  items: [],
  time: 30,
  yields: 2,
  ...over,
});

describe("deriveRecipe", () => {
  it("maps a complete recipe", () => {
    const { recipe, problems } = deriveRecipe(raw(["🍽️ Hauptgericht", "🍝 Pasta", "🥬 Vegetarisch", "✅ Erprobt"]));
    expect(problems).toEqual([]);
    expect(recipe).toMatchObject({ mealType: "main", base: "pasta", diet: "vegetarian", isProven: true, totalTimeMinutes: 30 });
  });

  it("ignores emoji variation selectors", () => {
    const { recipe } = deriveRecipe(raw(["🍽 Hauptgericht", "🥬 Vegetarisch", "🆕 Neu"]));
    expect(recipe?.mealType).toBe("main");
    expect(recipe?.isProven).toBe(false);
  });

  it("uses base 'other' when no base tag exists", () => {
    expect(deriveRecipe(raw(["🍽️ Hauptgericht", "🌱 Vegan", "🆕 Neu"])).recipe?.base).toBe("other");
  });

  it("treats vegan as vegetarian", () => {
    const { recipe } = deriveRecipe(raw(["🍽️ Hauptgericht", "🌱 Vegan", "🆕 Neu"]));
    expect(recipe && isVegetarian(recipe)).toBe(true);
  });

  it("picks meat over fish and flags a vegetarian tag next to it", () => {
    expect(deriveRecipe(raw(["🍽️ Hauptgericht", "🥩 Fleisch", "🐟 Fisch", "✅ Erprobt"])).recipe?.diet).toBe("meat");
    const bad = deriveRecipe(raw(["🍽️ Hauptgericht", "🥩 Fleisch", "🥬 Vegetarisch", "✅ Erprobt"]));
    expect(bad.recipe).toBeNull();
    expect(bad.problems[0]).toMatch(/contradict/);
  });

  it("allows cakes to carry baking and dessert together, but not a main dish with another type", () => {
    expect(deriveRecipe(raw(["🍰 Backen", "🍦 Dessert", "🥬 Vegetarisch", "✅ Erprobt"])).problems).toEqual([]);
    expect(deriveRecipe(raw(["🍽️ Hauptgericht", "🍰 Backen", "🥬 Vegetarisch", "✅ Erprobt"])).problems[0]).toMatch(/main dish also tagged/);
  });

  it("reports missing meal type, diet and experience", () => {
    const { recipe, problems } = deriveRecipe(raw([]));
    expect(recipe).toBeNull();
    expect(problems).toEqual(["no meal-type tag", "no diet tag", "neither proven nor new"]);
  });

  it("does not count a missing time as a problem but as a reminder", () => {
    const { recipe, problems } = deriveRecipe(raw(["🍽️ Hauptgericht", "🥬 Vegetarisch", "✅ Erprobt"], { time: null }));
    expect(problems).toEqual([]);
    expect(recipe && needsTime(recipe)).toBe(true);
  });

  it("flags the want-to-try marker and defaults to two portions", () => {
    const { recipe } = deriveRecipe(raw(["🍽️ Hauptgericht", "🥬 Vegetarisch", "🆕 Neu", "⭐ Ausprobieren"], { yields: null }));
    expect(recipe).toMatchObject({ wantsToTry: true, yields: 2 });
  });
});
