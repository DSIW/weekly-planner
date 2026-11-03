import { describe, expect, it } from "vitest";
import { IMPORT_LIMITS, recipeId, type RecipeDraft, type Vocabulary } from "@weekly-planner/domain";
import {
  CreateImportedRecipe,
  DraftRecipeImport,
  ExtractorNotConfigured,
  FindRelatedRecipes,
  MatchIngredients,
  MatchTags,
  SuggestNames,
  type DraftImage,
  type ImageShelf,
  type RecipeExtractor,
  type RecipeSource,
  type RecipeWriter,
} from "../src/index.js";
import type { RecipeCatalog } from "../src/index.js";
import { ME, aRecipe } from "./support/in-memory.js";

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
    fetchImage?: (address: string) => Promise<DraftImage | null>;
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
  const uploaded: (DraftImage | undefined)[] = [];
  const writer: RecipeWriter = {
    vocabulary: over.vocabulary ?? (async () => vocabulary),
    create: async (draft, image) => {
      created.push(draft);
      uploaded.push(image);
      return { recipeId: 99, photoAttached: image !== undefined };
    },
  };
  const kept = new Map<string, DraftImage>();
  const shelf: ImageShelf = {
    keep: (image) => {
      const token = `${kept.size}`.padStart(32, "0");
      kept.set(token, image);
      return token;
    },
    get: (token) => kept.get(token) ?? null,
  };
  const fetcher = { fetch: over.fetchImage ?? (async () => null) };
  return {
    extracted,
    created,
    uploaded,
    shelf,
    draft: new DraftRecipeImport({ source, extractor, writer, images: { fetcher, shelf } }),
    create: new CreateImportedRecipe({ writer, shelf }),
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
    expect(created[0]).toMatchObject({
      name: "Pasta",
      tags: ["🍲 Suppe", "🍕 Pizza"],
      source: "https://example.org/r",
    });
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

describe("MatchIngredients", () => {
  const vocab: Vocabulary = {
    items: ["Karotte", "Karotten", "Zwiebel"],
    icons: { Karotten: "carrot", Zwiebel: "onion" },
    tags: [],
  };
  const matcher = () => new MatchIngredients({ writer: { vocabulary: async () => vocab } });

  it("says which item a renamed ingredient is now, with its icon, or that it is new", async () => {
    const r = await matcher().execute({ names: ["Karotte", " zwiebeln ", "Safran", "<b>Salz</b>", ""] });
    expect(r.ok && r.value).toEqual([
      { written: "Karotte", name: "Karotten", isNewItem: false, icon: "carrot" },
      { written: "zwiebeln", name: "Zwiebel", isNewItem: false, icon: "onion" },
      { written: "Safran", name: "Safran", isNewItem: true },
      { written: "Salz", name: "Salz", isNewItem: true },
      { written: "", name: "", isNewItem: true },
    ]);
  });

  it("does not guess when KitchenOwl cannot be read", async () => {
    const down = new MatchIngredients({
      writer: {
        vocabulary: async () => {
          throw new Error("down");
        },
      },
    });
    expect(await down.execute({ names: ["Salz"] })).toEqual({ ok: false, reason: "kitchenowl_unavailable" });
  });
});

describe("MatchTags", () => {
  const tags = () => new MatchTags({ writer: { vocabulary: async () => ({ items: [], tags: ["🌶️ Scharf"] }) } });

  it("gives the household's spelling, with its emoji, or the tag as written", async () => {
    const r = await tags().execute({ names: ["scharf", " Grillen ", "<b>x</b>", ""] });
    expect(r.ok && r.value).toEqual([
      { written: "scharf", name: "🌶️ Scharf", isKnown: true },
      { written: "Grillen", name: "Grillen", isKnown: false },
      { written: "x", name: "x", isKnown: false },
      { written: "", name: "", isKnown: false },
    ]);
  });
});

describe("the title picture", () => {
  const picture: DraftImage = { bytes: new Uint8Array([0xff, 0xd8, 0xff]), contentType: "image/jpeg" };
  const withImage = { read: async () => ({ ok: true as const, text: "t", imageUrl: "https://example.org/a.jpg" }) };

  it("is fetched from the page's picture link, kept, and named in the draft by a token", async () => {
    const asked: string[] = [];
    const { draft, shelf } = setup({
      ...withImage,
      fetchImage: async (a) => {
        asked.push(a);
        return picture;
      },
    });
    const r = await draft.execute({ member: ME, address: "https://example.org/r" });
    expect(asked).toEqual(["https://example.org/a.jpg"]);
    const token = r.ok ? r.value.imageToken : undefined;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(shelf.get(token ?? "")).toEqual(picture);
  });

  it("is read from a first line of a pasted text that is only a link, and that line is not part of the recipe", async () => {
    const asked: string[] = [];
    const { draft, extracted } = setup({
      fetchImage: async (a) => {
        asked.push(a);
        return picture;
      },
    });
    const r = await draft.execute({
      member: ME,
      text: "https://example.org/pic.jpg\n\nGnocchi-Pfanne\n\nINGREDIENTS\n• 500 g Gnocchi",
    });
    expect(asked).toEqual(["https://example.org/pic.jpg"]);
    expect(r.ok && r.value.imageToken).toMatch(/^[0-9a-f]{32}$/);
    expect(extracted[0]?.text).toBe("Gnocchi-Pfanne\n\nINGREDIENTS\n• 500 g Gnocchi");
  });

  it("leaves the draft without a picture when it cannot be had", async () => {
    for (const fetchImage of [
      async () => null,
      async () => {
        throw new Error("boom");
      },
    ]) {
      const { draft } = setup({ ...withImage, fetchImage });
      const r = await draft.execute({ member: ME, address: "https://example.org/r" });
      expect(r.ok && r.value.imageToken).toBeUndefined();
    }
  });

  it("is not looked for when the text was pasted", async () => {
    const { draft } = setup({
      fetchImage: async () => {
        throw new Error("must not be asked");
      },
    });
    expect((await draft.execute({ member: ME, text: "Rezept" })).ok).toBe(true);
  });

  it("goes to KitchenOwl with the recipe; a token that is gone creates the recipe without it", async () => {
    const { draft, create, uploaded } = setup({ ...withImage, fetchImage: async () => picture });
    const shown = await draft.execute({ member: ME, address: "https://example.org/r" });
    if (!shown.ok) throw new Error(shown.reason);
    const r = await create.execute({ member: ME, draft: shown.value });
    expect(r.ok && r.value.photoAttached).toBe(true);
    expect(uploaded[0]).toEqual(picture);
    const gone = await create.execute({ member: ME, draft: { ...shown.value, imageToken: "f".repeat(32) } });
    expect(gone.ok && gone.value.photoAttached).toBe(false);
  });
});

describe("SuggestNames", () => {
  const vocab: Vocabulary = {
    items: ["Karotte", "Karotten", "Zwiebel"],
    icons: { Karotten: "carrot" },
    tags: ["🌶️ Scharf"],
  };
  const suggest = () => new SuggestNames({ writer: { vocabulary: async () => vocab } });

  it("offers the household's items with their icons, or its tags with their emoji", async () => {
    expect((await suggest().execute({ kind: "item", query: "karo" })).ok && true).toBe(true);
    expect(await suggest().execute({ kind: "item", query: "karo" })).toEqual({
      ok: true,
      value: [{ name: "Karotten", icon: "carrot" }],
    });
    expect(await suggest().execute({ kind: "tag", query: "scha" })).toEqual({
      ok: true,
      value: [{ name: "🌶️ Scharf" }],
    });
    expect(await suggest().execute({ kind: "item", query: "<b>zwi</b>" })).toEqual({
      ok: true,
      value: [{ name: "Zwiebel" }],
    });
  });

  it("offers nothing when KitchenOwl cannot be read", async () => {
    const down = new SuggestNames({
      writer: {
        vocabulary: async () => {
          throw new Error("down");
        },
      },
    });
    expect(await down.execute({ kind: "item", query: "a" })).toEqual({ ok: false, reason: "kitchenowl_unavailable" });
  });
});

describe("a created recipe and the catalogue", () => {
  it("makes the catalogue read the recipes again, so the planner offers the new one at once", async () => {
    let refreshed = 0;
    const { writer } = (() => {
      const w: RecipeWriter = {
        vocabulary: async () => vocabulary,
        create: async () => ({ recipeId: 5, photoAttached: false }),
      };
      return { writer: w };
    })();
    const create = new CreateImportedRecipe({
      writer,
      catalog: {
        refresh: async () => {
          refreshed++;
        },
      },
    });
    const draft = { ...answer(), source: "https://example.org/r" };
    expect((await create.execute({ member: ME, draft })).ok).toBe(true);
    expect(refreshed).toBe(1);
    // A refusal creates nothing and refreshes nothing.
    await create.execute({ member: ME, draft: { ...draft, ingredients: [] } });
    expect(refreshed).toBe(1);
  });

  it("still reports the recipe as created when the catalogue cannot be refreshed", async () => {
    const writer: RecipeWriter = {
      vocabulary: async () => vocabulary,
      create: async () => ({ recipeId: 5, photoAttached: false }),
    };
    const create = new CreateImportedRecipe({
      writer,
      catalog: {
        refresh: async () => {
          throw new Error("down");
        },
      },
    });
    const r = await create.execute({ member: ME, draft: answer() });
    expect(r.ok && r.value.recipeId).toBe(5);
  });
});

describe("FindRelatedRecipes", () => {
  const r1 = aRecipe(1, { name: "Rote Linsensuppe", source: "https://example.org/linsen" });
  const catalog = (entries: Awaited<ReturnType<RecipeCatalog["listAll"]>>) =>
    new FindRelatedRecipes({ catalog: { listAll: async () => entries } });

  it("names the recipes the household has that look like the draft, those still needing data too", async () => {
    const find = catalog([
      { kind: "ready", recipe: r1 },
      { kind: "needs-data", recipeId: recipeId(2), name: "Linsensuppe mit Würstchen", problems: [] },
      { kind: "ready", recipe: aRecipe(3, { name: "Pizza" }) },
    ]);
    const r = await find.execute({ name: "<b>Linsensuppe</b>", ingredients: [], source: "https://example.org/other" });
    expect(r.ok && r.value.map((x) => [x.id, x.reasons])).toEqual([
      [2, ["similar_name"]],
      [1, ["similar_name"]],
    ]);
    const same = await find.execute({ name: "Etwas", ingredients: [], source: "https://example.org/linsen?utm_x=1" });
    expect(same.ok && same.value.map((x) => [x.id, x.reasons])).toEqual([[1, ["same_source"]]]);
  });

  it("says nothing is related for an empty household, and that KitchenOwl cannot be read when it cannot", async () => {
    expect(await catalog([]).execute({ name: "Linsensuppe", ingredients: [] })).toEqual({ ok: true, value: [] });
    const down = new FindRelatedRecipes({
      catalog: {
        listAll: async () => {
          throw new Error("down");
        },
      },
    });
    expect(await down.execute({ name: "x", ingredients: [] })).toEqual({ ok: false, reason: "kitchenowl_unavailable" });
  });
});
