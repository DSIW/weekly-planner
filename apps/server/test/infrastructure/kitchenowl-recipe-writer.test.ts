import { describe, expect, it } from "vitest";
import type { RecipeDraft } from "@weekly-planner/domain";
import type { NewRecipe } from "../../src/infrastructure/kitchenowl/client.js";
import { descriptionOf, KitchenOwlRecipeWriter } from "../../src/infrastructure/kitchenowl/kitchenowl-recipe-writer.js";

const draft: RecipeDraft = {
  name: "Linsensuppe",
  subtitle: "Wärmt von innen",
  steps: ["Linsen waschen.", "Kochen."],
  ingredients: [
    { name: "Linsen", amount: "200 g", optional: false, isNewItem: false },
    { name: "Petersilie", amount: "", optional: true, isNewItem: true },
  ],
  mealType: "main",
  base: "other",
  diet: "vegan",
  tags: ["🍲 Suppe"],
  totalMinutes: 40,
  yields: 4,
  source: "https://example.org/linsen",
};

function setup(tags = ["🍽️ Hauptgericht", "🌱 Vegan", "🆕 Neu", "🍲 Suppe", "🍝 Pasta"]) {
  const calls = { items: 0, tags: 0 };
  const created: NewRecipe[] = [];
  let now = 0;
  const client = {
    async listItemNames() {
      calls.items++;
      return ["Linsen", "Zwiebel"];
    },
    async listTagNames() {
      calls.tags++;
      return tags;
    },
    async createRecipe(r: NewRecipe) {
      created.push(r);
      return 42;
    },
  };
  return {
    calls,
    created,
    advance: (ms: number) => (now += ms),
    writer: new KitchenOwlRecipeWriter(client, () => now),
  };
}

describe("descriptionOf", () => {
  it("writes the household's format: an italic line, then a numbered list", () => {
    expect(descriptionOf(draft)).toBe("_Wärmt von innen_\n\n1. Linsen waschen.\n2. Kochen.");
    expect(descriptionOf({ steps: ["Eins."] })).toBe("1. Eins.");
  });
});

describe("KitchenOwlRecipeWriter", () => {
  it("offers the item names and only the free tags as vocabulary, and reads KitchenOwl once for a while", async () => {
    const { writer, calls, advance } = setup();
    expect(await writer.vocabulary()).toEqual({ items: ["Linsen", "Zwiebel"], tags: ["🍲 Suppe"] });
    await writer.vocabulary();
    expect(calls).toEqual({ items: 1, tags: 1 });
    advance(4 * 60_000);
    await writer.vocabulary();
    expect(calls).toEqual({ items: 1, tags: 1 });
    advance(2 * 60_000);
    await writer.vocabulary();
    expect(calls).toEqual({ items: 2, tags: 2 });
  });

  it("creates the recipe the way the planner reads it: tags for meal type, diet and new, steps, amounts, source", async () => {
    const { writer, created } = setup();
    expect(await writer.create(draft)).toEqual({ recipeId: 42 });
    expect(created).toEqual([
      {
        name: "Linsensuppe",
        description: "_Wärmt von innen_\n\n1. Linsen waschen.\n2. Kochen.",
        yields: 4,
        time: 40,
        source: "https://example.org/linsen",
        items: [
          { name: "Linsen", description: "200 g", optional: false },
          { name: "Petersilie", description: "", optional: true },
        ],
        tags: ["🍽️ Hauptgericht", "🌱 Vegan", "🆕 Neu", "🍲 Suppe"],
      },
    ]);
  });

  it("falls back to two portions and leaves out an unknown time and source", async () => {
    const { writer, created } = setup();
    const { totalMinutes: _t, yields: _y, source: _s, ...bare } = draft;
    await writer.create(bare);
    expect(created[0]).toMatchObject({ yields: 2 });
    expect(created[0]).not.toHaveProperty("time");
    expect(created[0]).not.toHaveProperty("source");
  });

  it("keeps the spelling the household already has for a tag", async () => {
    const { writer, created } = setup(["🍽 Hauptgericht", "🌱 Vegan", "🆕 Neu"]);
    await writer.create({ ...draft, tags: [] });
    expect(created[0]?.tags).toEqual(["🍽 Hauptgericht", "🌱 Vegan", "🆕 Neu"]);
  });

  it("reads the vocabulary again after a recipe was created: its new items are known now", async () => {
    const { writer, calls } = setup();
    await writer.vocabulary();
    await writer.create(draft);
    await writer.vocabulary();
    expect(calls.items).toBe(2);
  });
});
