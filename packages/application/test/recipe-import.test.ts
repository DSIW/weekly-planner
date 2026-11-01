import { describe, expect, it } from "vitest";
import { IMPORT_LIMITS, type RecipeDraft, type Vocabulary } from "@weekly-planner/domain";
import {
  CreateImportedRecipe,
  DraftRecipeImport,
  ExtractorNotConfigured,
  type RecipeExtractor,
  type RecipeSource,
  type RecipeWriter,
} from "../src/index.js";
import { ME } from "./support/in-memory.js";

const vocabulary: Vocabulary = { items: ["Zwiebel", "Spaghetti"], tags: ["🍲 Suppe"] };
const answer = (over: Record<string, unknown> = {}) => ({
  name: "Pasta",
  steps: ["Kochen."],
  ingredients: [{ name: "spaghetti", amount: "200 g" }, { name: "Basilikum" }],
  mealType: "main",
  base: "pasta",
  diet: "vegan",
  tags: ["🍲 Suppe", "🍕 Pizza"],
  ...over,
});

function setup(
  over: {
    extract?: RecipeExtractor["extract"];
    read?: RecipeSource["read"];
    vocabulary?: () => Promise<Vocabulary>;
  } = {},
) {
  const extracted: { text: string; vocabulary: Vocabulary }[] = [];
  const created: RecipeDraft[] = [];
  const source: RecipeSource = { read: over.read ?? (async () => ({ ok: true, text: "page text" })) };
  const extractor: RecipeExtractor = {
    extract:
      over.extract ??
      (async (text, vocab) => {
        extracted.push({ text, vocabulary: vocab });
        return answer();
      }),
  };
  const writer: RecipeWriter = {
    vocabulary: over.vocabulary ?? (async () => vocabulary),
    create: async (draft) => {
      created.push(draft);
      return { recipeId: 99 };
    },
  };
  return {
    extracted,
    created,
    draft: new DraftRecipeImport({ source, extractor, writer }),
    create: new CreateImportedRecipe({ writer }),
  };
}

describe("DraftRecipeImport", () => {
  it("drafts a recipe from pasted text, checked against the household's vocabulary", async () => {
    const { draft, extracted } = setup();
    const r = await draft.execute({ member: ME, text: "  Pasta mit Basilikum  " });
    expect(r.ok && r.value).toMatchObject({
      name: "Pasta",
      tags: ["🍲 Suppe"],
      ingredients: [
        { name: "Spaghetti", amount: "200 g", isNewItem: false },
        { name: "Basilikum", isNewItem: true },
      ],
    });
    expect(r.ok && r.value.source).toBeUndefined();
    expect(extracted).toEqual([{ text: "Pasta mit Basilikum", vocabulary }]);
  });

  it("reads a link first, and keeps it as the draft's source", async () => {
    const asked: string[] = [];
    const { draft, extracted } = setup({
      read: async (a) => {
        asked.push(a);
        return { ok: true, text: "text of the page" };
      },
    });
    const r = await draft.execute({ member: ME, address: " https://example.org/r " });
    expect(asked).toEqual(["https://example.org/r"]);
    expect(extracted[0]?.text).toBe("text of the page");
    expect(r.ok && r.value.source).toBe("https://example.org/r");
  });

  it("wants exactly one source: a link or a text", async () => {
    const { draft, extracted } = setup();
    for (const cmd of [{}, { address: "  ", text: "" }, { address: "https://a.b", text: "text" }])
      expect(await draft.execute({ member: ME, ...cmd })).toEqual({ ok: false, reason: "need_one_source" });
    expect(extracted).toEqual([]);
  });

  it("says why a link could not be read, and asks nobody else then", async () => {
    const { draft, extracted } = setup({ read: async () => ({ ok: false, reason: "address_not_public" }) });
    expect(await draft.execute({ member: ME, address: "http://127.0.0.1/x" })).toEqual({
      ok: false,
      reason: "address_not_public",
    });
    expect(extracted).toEqual([]);
  });

  it("gives the model no more than the limit of a long source", async () => {
    const { draft, extracted } = setup();
    await draft.execute({ member: ME, text: "x".repeat(IMPORT_LIMITS.maxSourceCharacters + 5000) });
    expect(extracted[0]?.text).toHaveLength(IMPORT_LIMITS.maxSourceCharacters);
  });

  it("refuses a page that had no text", async () => {
    const { draft } = setup({ read: async () => ({ ok: true, text: "   " }) });
    expect(await draft.execute({ member: ME, address: "https://a.b" })).toEqual({ ok: false, reason: "empty" });
  });

  it("tells when the model is not set up, and when it failed", async () => {
    const off = setup({
      extract: async () => {
        throw new ExtractorNotConfigured();
      },
    });
    expect(await off.draft.execute({ member: ME, text: "x" })).toEqual({ ok: false, reason: "not_configured" });
    const broken = setup({
      extract: async () => {
        throw new Error("503");
      },
    });
    expect(await broken.draft.execute({ member: ME, text: "x" })).toEqual({ ok: false, reason: "extraction_failed" });
  });

  it("refuses an answer that is not a recipe, however it looks", async () => {
    const nothing = setup({ extract: async () => "I cannot help with that." });
    expect(await nothing.draft.execute({ member: ME, text: "x" })).toEqual({ ok: false, reason: "not_a_recipe" });
    const noSteps = setup({ extract: async () => answer({ steps: [] }) });
    expect(await noSteps.draft.execute({ member: ME, text: "x" })).toEqual({ ok: false, reason: "not_a_recipe" });
  });

  it("does not guess when KitchenOwl's vocabulary cannot be read", async () => {
    const { draft, extracted } = setup({
      vocabulary: async () => {
        throw new Error("down");
      },
    });
    expect(await draft.execute({ member: ME, text: "x" })).toEqual({ ok: false, reason: "kitchenowl_unavailable" });
    expect(extracted).toEqual([]);
  });
});

describe("CreateImportedRecipe", () => {
  const confirmed = () => ({ ...answer(), source: "https://example.org/r" });

  it("creates the recipe from the confirmed draft, checked again", async () => {
    const { create, created } = setup();
    const r = await create.execute({
      member: ME,
      draft: { ...confirmed(), name: "<b>Pasta</b>", visibility: 1, tags: ["🍲 Suppe", "🍕 Pizza"] },
    });
    expect(r.ok && r.value.recipeId).toBe(99);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Pasta", tags: ["🍲 Suppe"], source: "https://example.org/r" });
    expect(created[0]).not.toHaveProperty("visibility");
    expect(created[0]?.ingredients[0]).toMatchObject({ name: "Spaghetti", isNewItem: false });
  });

  it("refuses a draft that is not a recipe, and creates nothing", async () => {
    const { create, created } = setup();
    expect(await create.execute({ member: ME, draft: { ...confirmed(), ingredients: [] } })).toEqual({
      ok: false,
      reason: "not_a_recipe",
    });
    expect(await create.execute({ member: ME, draft: null })).toEqual({ ok: false, reason: "not_a_recipe" });
    expect(created).toEqual([]);
  });

  it("says so when KitchenOwl cannot be reached", async () => {
    const down = setup({
      vocabulary: async () => {
        throw new Error("down");
      },
    });
    expect(await down.create.execute({ member: ME, draft: confirmed() })).toEqual({
      ok: false,
      reason: "kitchenowl_unavailable",
    });
    const writer: RecipeWriter = {
      vocabulary: async () => vocabulary,
      create: async () => {
        throw new Error("500");
      },
    };
    expect(await new CreateImportedRecipe({ writer }).execute({ member: ME, draft: confirmed() })).toEqual({
      ok: false,
      reason: "kitchenowl_unavailable",
    });
  });
});
