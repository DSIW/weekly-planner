import { describe, expect, it } from "vitest";
import { relatedRecipes, type KnownRecipe } from "../../src/index.js";

const known: KnownRecipe[] = [
  {
    id: 1,
    name: "Rote Linsensuppe",
    ingredients: ["Rote Linsen", "Zwiebel", "Karotten", "Kreuzkümmel", "Salz"],
    source: "https://www.example.org/linsen/",
  },
  { id: 2, name: "Spaghetti Carbonara", ingredients: ["Spaghetti", "Eier", "Speck", "Parmesan", "Pfeffer"] },
  { id: 3, name: "Linsen-Curry", ingredients: ["Linsen", "Kokosmilch", "Curry", "Zwiebel"] },
  { id: 4, name: "Pfannkuchen", ingredients: [] },
  { id: 5, name: "Pasta", ingredients: [] },
];
const draft = (name: string, ingredients: string[] = [], source?: string) => ({
  name,
  ingredients,
  ...(source === undefined ? {} : { source }),
});

describe("relatedRecipes", () => {
  it("finds a recipe that came from the same link, whatever the www, the slash, the tracking and the fragment", () => {
    const r = relatedRecipes(draft("Etwas ganz anderes", [], "http://example.org/linsen?utm_source=x#top"), known);
    expect(r).toEqual([{ id: 1, name: "Rote Linsensuppe", reasons: ["same_source"], sharedIngredients: 0 }]);
  });

  it("finds a similar name: one holds the words of the other, or only a plural or an article differs", () => {
    expect(relatedRecipes(draft("Linsensuppe"), known).map((r) => r.id)).toEqual([1]);
    expect(relatedRecipes(draft("Die Spaghetti Carbonara"), known).map((r) => r.id)).toEqual([2]);
    expect(relatedRecipes(draft("Pfannkuchen mit Apfel"), known).map((r) => r.id)).toEqual([4]);
    expect(relatedRecipes(draft("Pasta al Pomodoro"), known).map((r) => r.id)).toEqual([5]);
  });

  it("finds a recipe with most of the same ingredients, not counting salt, pepper and water", () => {
    const mine = draft("Orientalischer Eintopf", [
      "Rote Linsen",
      "Zwiebel",
      "Karotte",
      "Kreuzkümmel",
      "Salz",
      "Wasser",
    ]);
    const r = relatedRecipes(mine, known);
    expect(r).toEqual([{ id: 1, name: "Rote Linsensuppe", reasons: ["shared_ingredients"], sharedIngredients: 4 }]);
  });

  it("does not call two recipes alike for a few shared ingredients or for staples alone", () => {
    expect(relatedRecipes(draft("Kuchen", ["Zwiebel", "Salz", "Pfeffer", "Wasser", "Zucker", "Mehl"]), known)).toEqual(
      [],
    );
    expect(relatedRecipes(draft("Salat", ["Linsen", "Zwiebel", "Gurke"]), known)).toEqual([]);
  });

  it("says why, best first, and gives at most three", () => {
    const [first] = relatedRecipes(
      draft("Rote Linsensuppe", ["Rote Linsen", "Zwiebel", "Karotten", "Kreuzkümmel"], "https://example.org/linsen"),
      known,
    );
    expect(first).toEqual({
      id: 1,
      name: "Rote Linsensuppe",
      reasons: ["same_source", "similar_name", "shared_ingredients"],
      sharedIngredients: 4,
    });
    const many: KnownRecipe[] = Array.from({ length: 6 }, (_, i) => ({
      id: i,
      name: `Linsensuppe ${i}`,
      ingredients: [],
    }));
    expect(relatedRecipes(draft("Linsensuppe"), many)).toHaveLength(3);
    expect(relatedRecipes(draft("Linsensuppe"), many, 5)).toHaveLength(5);
  });

  it("is quiet for a draft without a name worth comparing, and for nothing known", () => {
    expect(relatedRecipes(draft("!!"), known)).toEqual([]);
    expect(relatedRecipes(draft("Linsensuppe"), [])).toEqual([]);
    expect(relatedRecipes(draft("Linsensuppe", [], "kein link"), known).map((r) => r.id)).toEqual([1]);
  });
});
