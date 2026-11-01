import {
  mealLogEntryId,
  planDate,
  recipeId,
  registerCooking,
  type MealLogEntry,
  type Recipe,
} from "@weekly-planner/domain";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../../src/infrastructure/sqlite/database.js";
import { SqliteMealLogRepository } from "../../src/infrastructure/sqlite/sqlite-meal-log-repository.js";
import { SqliteRecipeExperienceRepository } from "../../src/infrastructure/sqlite/sqlite-recipe-experience-repository.js";

const MON = planDate("2026-11-02");
const TUE = planDate("2026-11-03");
const WED = planDate("2026-11-04");
const pasta: Recipe = {
  id: recipeId(7),
  name: "Pasta",
  mealType: "main",
  base: "pasta",
  diet: "vegetarian",
  totalTimeMinutes: 30,
  isProven: false,
  wantsToTry: false,
  yields: 2,
  tags: ["🍝 Pasta"],
  ingredients: [{ id: 1, name: "Nudeln", description: "200 g", optional: false, category: "🍝 Pasta" }],
};
const entry = (id: string, date: typeof MON, over: Partial<MealLogEntry> = {}): MealLogEntry => ({
  id: mealLogEntryId(id),
  date,
  base: "pasta",
  recipe: pasta,
  source: "from_plan",
  confirmed: false,
  ...over,
});

const open: Database[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});
const fresh = () => {
  const db = openDatabase(":memory:");
  open.push(db);
  return { meal: new SqliteMealLogRepository(db), experience: new SqliteRecipeExperienceRepository(db) };
};

describe("SqliteMealLogRepository", () => {
  it("returns null for an unknown entry", async () => {
    expect(await fresh().meal.get(mealLogEntryId("nope"))).toBeNull();
  });

  it("saves and loads an entry whole, with its recipe or without one", async () => {
    const { meal } = fresh();
    await meal.save(entry("a", MON));
    await meal.save(entry("b", TUE, { recipe: null, base: "bread", source: "added", confirmed: true }));
    expect(await meal.get(mealLogEntryId("a"))).toEqual(entry("a", MON));
    expect(await meal.get(mealLogEntryId("b"))).toEqual(
      entry("b", TUE, { recipe: null, base: "bread", source: "added", confirmed: true }),
    );
  });

  it("replaces an entry that is saved again", async () => {
    const { meal } = fresh();
    await meal.save(entry("a", MON));
    await meal.save(entry("a", MON, { confirmed: true, source: "corrected", base: "rice", recipe: null }));
    expect(await meal.get(mealLogEntryId("a"))).toEqual(
      entry("a", MON, { confirmed: true, source: "corrected", base: "rice", recipe: null }),
    );
    expect(await meal.listSince(MON)).toHaveLength(1);
  });

  it("lists the entries from a date on, oldest first", async () => {
    const { meal } = fresh();
    await meal.save(entry("c", WED));
    await meal.save(entry("a", MON));
    await meal.save(entry("b", TUE));
    expect((await meal.listSince(TUE)).map((e) => e.id)).toEqual(["b", "c"]);
    expect((await meal.listSince(MON)).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(await meal.listSince(planDate("2026-12-01"))).toEqual([]);
  });

  it("orders the entries by date first and by id only within one day", async () => {
    const { meal } = fresh();
    await meal.save(entry("a", WED));
    await meal.save(entry("z", MON));
    await meal.save(entry("m", MON));
    expect((await meal.listSince(MON)).map((e) => e.id)).toEqual(["m", "z", "a"]);
  });

  it("forgets a removed entry but remembers that its planned date was logged", async () => {
    const { meal } = fresh();
    await meal.save(entry("a", MON));
    await meal.remove(mealLogEntryId("a"));
    expect(await meal.get(mealLogEntryId("a"))).toBeNull();
    expect([...(await meal.loggedPlanDates())]).toEqual([MON]);
  });

  it("marks a date as logged only for an entry made from the plan", async () => {
    const { meal } = fresh();
    await meal.save(entry("a", MON, { source: "added", confirmed: true }));
    await meal.save(entry("b", TUE, { source: "corrected", confirmed: true }));
    expect([...(await meal.loggedPlanDates())]).toEqual([]);
    await meal.save(entry("c", WED));
    expect([...(await meal.loggedPlanDates())]).toEqual([WED]);
  });

  it("removing an unknown entry is not an error", async () => {
    await expect(fresh().meal.remove(mealLogEntryId("nope"))).resolves.toBeUndefined();
  });
});

describe("SqliteRecipeExperienceRepository", () => {
  it("returns null for a recipe never cooked, and lists the ones that were", async () => {
    const { experience } = fresh();
    expect(await experience.get(recipeId(7))).toBeNull();
    expect([...(await experience.allRecipeIds())]).toEqual([]);
    await experience.save(registerCooking(null, recipeId(7), MON));
    await experience.save(registerCooking(null, recipeId(9), TUE));
    expect(await experience.get(recipeId(7))).toEqual({ recipeId: 7, firstCooked: MON });
    expect([...(await experience.allRecipeIds())].sort()).toEqual([7, 9]);
  });

  it("keeps one row per recipe", async () => {
    const { experience } = fresh();
    await experience.save({ recipeId: recipeId(7), firstCooked: TUE });
    await experience.save({ recipeId: recipeId(7), firstCooked: MON });
    expect(await experience.get(recipeId(7))).toEqual({ recipeId: 7, firstCooked: MON });
    expect((await experience.allRecipeIds()).size).toBe(1);
  });
});
