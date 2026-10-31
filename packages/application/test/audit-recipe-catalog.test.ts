import { describe, expect, it } from "vitest";
import { recipeId, type CatalogEntry, type Recipe } from "@weekly-planner/domain";
import { AuditRecipeCatalog, type RecipeCatalog } from "../src/index.js";

const recipe = (id: number, over: Partial<Recipe> = {}): Recipe => ({
  id: recipeId(id),
  name: `Rezept ${id}`,
  mealType: "main",
  base: "pasta",
  diet: "vegetarian",
  totalTimeMinutes: 30,
  isProven: true,
  wantsToTry: false,
  yields: 2,
  ...over,
});
const ready = (r: Recipe): CatalogEntry => ({ kind: "ready", recipe: r });
const catalogOf = (entries: CatalogEntry[]): Pick<RecipeCatalog, "listAll"> => ({ listAll: async () => entries });
const audit = (entries: CatalogEntry[]) => new AuditRecipeCatalog(catalogOf(entries), { weekdayTimeLimitMinutes: 45 }).execute();

describe("AuditRecipeCatalog", () => {
  it("counts weekday-usable and vegetarian main dishes and ignores other meal types", async () => {
    const r = await audit([
      ready(recipe(1)),
      ready(recipe(2, { totalTimeMinutes: 90, diet: "meat" })),
      ready(recipe(3, { mealType: "dessert" })),
    ]);
    expect(r).toMatchObject({ total: 3, ready: 3, mains: 2, vegetarianMains: 1, weekdayMains: 1 });
    expect(r.byMealType).toEqual({ main: 2, dessert: 1 });
  });

  it("reports main dishes without a time as a reminder, not as a problem", async () => {
    const r = await audit([ready(recipe(1, { totalTimeMinutes: null }))]);
    expect(r.mainsWithoutTime).toEqual(["Rezept 1"]);
    expect(r.needsData).toEqual([]);
    expect(r.weekdayMains).toBe(1);
  });

  it("lists recipes that need data and keeps them out of the counts", async () => {
    const r = await audit([
      ready(recipe(1)),
      { kind: "needs-data", recipeId: recipeId(2), name: "Kaputt", problems: ["no diet tag"] },
    ]);
    expect(r).toMatchObject({ total: 2, ready: 1, mains: 1 });
    expect(r.needsData).toEqual([{ name: "Kaputt", problems: ["no diet tag"] }]);
  });

  it("counts proven, new and want-to-try recipes", async () => {
    const r = await audit([ready(recipe(1)), ready(recipe(2, { isProven: false, wantsToTry: true }))]);
    expect(r).toMatchObject({ proven: 1, unproven: 1, wantsToTry: 1 });
  });
});
