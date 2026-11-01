import { describe, expect, it } from "vitest";
import { isVegetarian, needsTime } from "@weekly-planner/domain";
import {
  deriveRecipe,
  freeTags,
  tagsForDraft,
  toCatalogEntry,
} from "../../src/infrastructure/kitchenowl/recipe-translator.js";
import { rawRecipeListSchema, type RawRecipe } from "../../src/infrastructure/kitchenowl/schemas.js";

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

describe("a mise en place", () => {
  it("is a preparation, never a dinner: tagged with a main dish it needs attention, alone it is not a main dish", () => {
    const both = deriveRecipe(raw(["🍽️ Hauptgericht", "🔪 Mise en place", "🥬 Vegetarisch", "✅ Erprobt"]));
    expect(both.recipe).toBeNull();
    expect(both.problems[0]).toMatch(/main dish also tagged prep/);
    const alone = deriveRecipe(raw(["🔪 Mise en place", "🥬 Vegetarisch", "✅ Erprobt"]));
    expect(alone.recipe).toMatchObject({ mealType: "prep" });
    expect(alone.recipe?.tags).toEqual(["🥬 Vegetarisch"]); // the preparation tag itself is not shown
  });

  it("carries the icon key of an ingredient", () => {
    const { recipe } = deriveRecipe(
      raw(["🍽️ Hauptgericht", "🥬 Vegetarisch", "✅ Erprobt"], {
        items: [
          { id: 1, name: "Butter", description: "", optional: false, icon: "butter" },
          { id: 2, name: "Salz", description: "", optional: false, icon: null },
        ],
      }),
    );
    expect(recipe?.ingredients?.map((i) => i.icon)).toEqual(["butter", undefined]);
  });
});

describe("deriveRecipe", () => {
  it("maps a complete recipe", () => {
    const { recipe, problems } = deriveRecipe(raw(["🍽️ Hauptgericht", "🍝 Pasta", "🥬 Vegetarisch", "✅ Erprobt"]));
    expect(problems).toEqual([]);
    expect(recipe).toMatchObject({
      mealType: "main",
      base: "pasta",
      diet: "vegetarian",
      isProven: true,
      totalTimeMinutes: 30,
    });
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
    expect(deriveRecipe(raw(["🍽️ Hauptgericht", "🍰 Backen", "🥬 Vegetarisch", "✅ Erprobt"])).problems[0]).toMatch(
      /main dish also tagged/,
    );
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
    const { recipe } = deriveRecipe(
      raw(["🍽️ Hauptgericht", "🥬 Vegetarisch", "🆕 Neu", "⭐ Ausprobieren"], { yields: null }),
    );
    expect(recipe).toMatchObject({ wantsToTry: true, yields: 2 });
  });
});

describe("toCatalogEntry", () => {
  it("returns ready recipes with a branded id", () => {
    const e = toCatalogEntry(raw(["🍽️ Hauptgericht", "🥬 Vegetarisch", "✅ Erprobt"], { id: 42 }));
    expect(e).toMatchObject({ kind: "ready", recipe: { id: 42, name: "Testgericht" } });
  });

  it("returns needs-data entries with the reasons instead of dropping the recipe", () => {
    const e = toCatalogEntry(raw([], { id: 7, name: "Ohne Tags" }));
    expect(e).toEqual({
      kind: "needs-data",
      recipeId: 7,
      name: "Ohne Tags",
      problems: ["no meal-type tag", "no diet tag", "neither proven nor new"],
    });
  });
});

describe("tags to show", () => {
  it("keeps the tags a card can show, emoji included and in KitchenOwl's order, without the ones that steer the rules", () => {
    const { recipe } = deriveRecipe(
      raw([
        "🍳 Kptncook",
        "🍽️ Hauptgericht",
        "🍝 Pasta",
        "🥬 Vegetarisch",
        "✅ Erprobt",
        "🆕 Neu",
        "⭐ Ausprobieren",
        " 🧄 Knoblauch ",
      ]),
    );
    expect(recipe?.tags).toEqual(["🍳 Kptncook", "🍝 Pasta", "🥬 Vegetarisch", "🧄 Knoblauch"]);
  });

  it("recognises the hidden tags whatever the emoji variation selector", () => {
    const { recipe } = deriveRecipe(raw(["🍽 Hauptgericht", "🥬 Vegetarisch", "✅ Erprobt"]));
    expect(recipe?.tags).toEqual(["🥬 Vegetarisch"]);
  });

  it("drops blank tags", () => {
    const { recipe } = deriveRecipe(raw(["🍽️ Hauptgericht", "", "   ", "🥬 Vegetarisch"]));
    expect(recipe?.tags).toEqual(["🥬 Vegetarisch"]);
  });
});

describe("reading KitchenOwl's recipe list", () => {
  it("keeps the category of an item, and accepts an item without one", () => {
    const [recipe] = rawRecipeListSchema.parse([
      {
        id: 1,
        name: "Brot",
        items: [
          { id: 5, name: "Butter", category: { name: "🧈 Aufstriche" } },
          { id: 6, name: "Salz", category: null },
          { id: 7, name: "Mehl" },
        ],
      },
    ]);
    expect(recipe?.items.map((i) => i.category)).toEqual([{ name: "🧈 Aufstriche" }, null, undefined]);
  });
});

describe("ingredients", () => {
  const tags = ["🍽️ Hauptgericht", "🥬 Vegetarisch", "✅ Erprobt"];

  it("are carried over with their amounts, ids and optional flag", () => {
    const { recipe } = deriveRecipe(
      raw(tags, {
        items: [
          { id: 5, name: "Zwiebel", description: "2 Stück", optional: false },
          { id: 6, name: "Petersilie", description: "", optional: true },
        ],
      }),
    );
    expect(recipe?.ingredients).toEqual([
      { id: 5, name: "Zwiebel", description: "2 Stück", optional: false },
      { id: 6, name: "Petersilie", description: "", optional: true },
    ]);
  });

  it("carry the name of their category, when the source has one", () => {
    const { recipe } = deriveRecipe(
      raw(tags, {
        items: [
          { id: 5, name: "Butter", description: "30 g", optional: false, category: { name: "🧈 Aufstriche" } },
          { id: 6, name: "Salz", description: "", optional: false, category: null },
        ],
      }),
    );
    expect(recipe?.ingredients).toEqual([
      { id: 5, name: "Butter", description: "30 g", optional: false, category: "🧈 Aufstriche" },
      { id: 6, name: "Salz", description: "", optional: false },
    ]);
  });

  it("are empty for a recipe without items", () => {
    expect(deriveRecipe(raw(tags)).recipe?.ingredients).toEqual([]);
  });
});

describe("tags of a created recipe", () => {
  const combos = [
    { mealType: "main", base: "pasta", diet: "vegan" },
    { mealType: "prep", base: "other", diet: "meat" },
    { mealType: "side", base: "rice", diet: "fish" },
    { mealType: "dessert", base: "bread", diet: "vegetarian" },
    { mealType: "baking", base: "grains", diet: "vegetarian" },
    { mealType: "breakfast", base: "potatoes", diet: "vegan" },
    { mealType: "snack", base: "other", diet: "vegan" },
    { mealType: "drink", base: "other", diet: "vegan" },
  ] as const;

  it.each(combos)("read back as the same meal type, base and diet, and as new: %j", (c) => {
    const { recipe, problems } = deriveRecipe(raw([...tagsForDraft(c), "🍲 Suppe"]));
    expect(problems).toEqual([]);
    expect(recipe).toMatchObject({ ...c, isProven: false });
    // Base and diet show on a card; the meal type and "new" only steer the rules.
    expect(recipe?.tags).toContain("🍲 Suppe");
    expect(recipe?.tags).not.toContain("🆕 Neu");
  });

  it("gives no base tag for a base that is none, exactly one meal type and one diet tag", () => {
    const tags = tagsForDraft({ mealType: "main", base: "other", diet: "meat" });
    expect(tags).toEqual(["🍽️ Hauptgericht", "🥩 Fleisch", "🆕 Neu"]);
  });
});

describe("freeTags", () => {
  it("leaves out the tags that stand for a meal type, a base, a diet or a state, however they are spelled", () => {
    const all = [
      "🍽️ Hauptgericht",
      "🍽 Hauptgericht",
      "🍝 Pasta",
      "🥬 Vegetarisch",
      "✅ Erprobt",
      "🆕 Neu",
      "⭐ Ausprobieren",
      "🍲 Suppe",
      "⏱️ Einfach",
    ];
    expect(freeTags(all)).toEqual(["🍲 Suppe", "⏱️ Einfach"]);
  });
});
