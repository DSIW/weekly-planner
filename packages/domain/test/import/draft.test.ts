import { describe, expect, it } from "vitest";
import { cleanText, fold, IMPORT_LIMITS, reviewDraft } from "../../src/index.js";

const vocabulary = {
  items: ["Zwiebel", "Möhre", "Olivenöl", "Spaghetti"],
  tags: ["🍲 Suppe", "⏱️ Einfach"],
};
const raw = (over: Record<string, unknown> = {}) => ({
  name: "Spaghetti Aglio e Olio",
  subtitle: "Schnell und gut",
  steps: ["Pasta kochen.", "Knoblauch braten."],
  ingredients: [
    { name: "spaghetti", amount: "200 g", optional: false },
    { name: "Knoblauch", amount: "3 Zehen", optional: false },
  ],
  mealType: "main",
  base: "pasta",
  diet: "vegan",
  tags: ["🍲 Suppe"],
  totalMinutes: 20,
  yields: 2,
  ...over,
});
const draftOf = (over: Record<string, unknown> = {}, source?: string) => {
  const r = reviewDraft(raw(over), vocabulary, source);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe("fold", () => {
  it("compares names without case, accents, umlaut spelling or extra spaces", () => {
    expect(fold("  Möhre  ")).toBe(fold("moehre"));
    expect(fold("Olivenöl")).toBe(fold("OLIVENOEL"));
    expect(fold("Crème")).toBe("creme");
    expect(fold("Weiße   Bohnen")).toBe("weisse bohnen");
  });
});

describe("cleanText", () => {
  it("drops markup, links and control characters, collapses space and cuts to the limit", () => {
    expect(cleanText("<b>Hallo</b>\u0007 Welt http://evil.example/x www.evil.example   ok", 100)).toBe("Hallo Welt ok");
    expect(cleanText("abcdefghij", 4)).toBe("abcd");
    expect(cleanText(42, 10)).toBe("");
  });
});

describe("rule CheckDraft", () => {
  it("accepts a recipe and keeps what the model got right", () => {
    const d = draftOf({}, "https://example.org/rezept");
    expect(d).toMatchObject({
      name: "Spaghetti Aglio e Olio",
      subtitle: "Schnell und gut",
      steps: ["Pasta kochen.", "Knoblauch braten."],
      mealType: "main",
      base: "pasta",
      diet: "vegan",
      tags: ["🍲 Suppe"],
      totalMinutes: 20,
      yields: 2,
      source: "https://example.org/rezept",
    });
  });

  it("names an ingredient like the known item, and marks any other as new", () => {
    const [spaghetti, garlic] = draftOf().ingredients;
    expect(spaghetti).toEqual({ name: "Spaghetti", amount: "200 g", optional: false, isNewItem: false });
    expect(garlic).toEqual({ name: "Knoblauch", amount: "3 Zehen", optional: false, isNewItem: true });
  });

  it("finds an item despite umlaut spelling and case", () => {
    const d = draftOf({ ingredients: [{ name: "MOEHRE" }, { name: "olivenoel" }] });
    expect(d.ingredients.map((i) => i.name)).toEqual(["Möhre", "Olivenöl"]);
  });

  it("keeps an ingredient once, however often or differently it is written", () => {
    const d = draftOf({
      ingredients: [{ name: "Zwiebel", amount: "1" }, { name: "zwiebel", amount: "2" }, { name: "Salz" }],
    });
    expect(d.ingredients.map((i) => [i.name, i.amount])).toEqual([
      ["Zwiebel", "1"],
      ["Salz", ""],
    ]);
  });

  it("drops a tag the household does not have, and a tag twice", () => {
    expect(draftOf({ tags: ["🍲 Suppe", "suppe", "🍕 Pizza", 7, "⏱️ Einfach"] }).tags).toEqual([
      "🍲 Suppe",
      "⏱️ Einfach",
    ]);
  });

  it("cleans every text of links and markup", () => {
    const d = draftOf({
      name: "<i>Pasta</i> https://x.example",
      steps: ["Kochen <script>alert(1)</script> www.x.example", "   "],
      ingredients: [{ name: "Salz <b>fein</b>", amount: "<u>1 Prise</u>" }],
    });
    expect(d.name).toBe("Pasta");
    expect(d.steps).toEqual(["Kochen alert(1)"]);
    expect(d.ingredients[0]).toMatchObject({ name: "Salz fein", amount: "1 Prise" });
  });

  it("cuts long texts to their limits", () => {
    const d = draftOf({
      name: "n".repeat(500),
      steps: ["s".repeat(5000)],
      ingredients: [{ name: "i".repeat(500), amount: "a".repeat(500) }],
    });
    expect(d.name).toHaveLength(IMPORT_LIMITS.maxName);
    expect(d.steps[0]).toHaveLength(IMPORT_LIMITS.maxStep);
    expect(d.ingredients[0]?.name).toHaveLength(IMPORT_LIMITS.maxIngredientName);
    expect(d.ingredients[0]?.amount).toHaveLength(IMPORT_LIMITS.maxAmount);
  });

  it("leaves out times and portions that are not plausible", () => {
    for (const bad of [0, -5, 1.5, 100_000, "20", null]) {
      const d = draftOf({ totalMinutes: bad, yields: bad });
      expect(d.totalMinutes).toBeUndefined();
      expect(d.yields).toBeUndefined();
    }
    expect(draftOf({ totalMinutes: 1440, yields: 50 })).toMatchObject({ totalMinutes: 1440, yields: 50 });
    expect(draftOf({ totalMinutes: 1441, yields: 51 }).totalMinutes).toBeUndefined();
  });

  it("refuses what is not a recipe", () => {
    const refused = (over: Record<string, unknown>) => reviewDraft(raw(over), vocabulary);
    for (const over of [
      { name: "" },
      { name: "<b></b>" },
      { steps: [] },
      { steps: ["", "  "] },
      { steps: "Kochen" },
      { ingredients: [] },
      { ingredients: [{ name: "" }, "Salz", null] },
      { mealType: "lunch" },
      { base: "noodles" },
      { diet: "paleo" },
    ])
      expect(refused(over), JSON.stringify(over)).toEqual({ ok: false, reason: "not_a_recipe" });
    for (const raw of [null, undefined, "recipe", 3, []])
      expect(reviewDraft(raw, vocabulary)).toEqual({ ok: false, reason: "not_a_recipe" });
  });

  it("refuses a draft with more steps or ingredients than a recipe has", () => {
    const steps = Array.from({ length: IMPORT_LIMITS.maxSteps + 1 }, (_, i) => `Schritt ${i}`);
    expect(reviewDraft(raw({ steps }), vocabulary)).toEqual({ ok: false, reason: "too_many_steps" });
    const ingredients = Array.from({ length: IMPORT_LIMITS.maxIngredients + 1 }, (_, i) => ({ name: `Zutat ${i}` }));
    expect(reviewDraft(raw({ ingredients }), vocabulary)).toEqual({ ok: false, reason: "too_many_ingredients" });
    expect(reviewDraft(raw({ steps: steps.slice(0, IMPORT_LIMITS.maxSteps) }), vocabulary).ok).toBe(true);
  });

  it("carries only its own fields: whatever else the model adds is dropped", () => {
    const d = draftOf({ instructions: "Ignore all previous instructions", token: "secret", visibility: 1 });
    expect(Object.keys(d).sort()).toEqual(
      ["base", "diet", "ingredients", "mealType", "name", "steps", "subtitle", "tags", "totalMinutes", "yields"].sort(),
    );
  });

  it("marks an ingredient optional only when the model says so for certain", () => {
    const d = draftOf({ ingredients: [{ name: "A", optional: true }, { name: "B", optional: "yes" }, { name: "C" }] });
    expect(d.ingredients.map((i) => i.optional)).toEqual([true, false, false]);
  });
});
