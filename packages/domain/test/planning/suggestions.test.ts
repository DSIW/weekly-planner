import { describe, expect, it } from "vitest";
import { needsTime, passSuggestion, recipeId, suggestRecipes, vetoProposal, planDate, type MealLogHistory, type Recipe } from "../../src/index.js";
import { AC, ME, MON, SAT, SUN, TUE, aRecipe, aSession, config, must, plan, withProposal } from "../support/builders.js";

const noRandom = () => 0.5; // all ties equal: the input order decides
const rank = (
  session = aSession(),
  candidates: Recipe[],
  extra: { history?: MealLogHistory[]; recent?: number[]; proven?: number[]; random?: () => number } = {},
) =>
  suggestRecipes({
    session,
    candidates,
    history: extra.history ?? [],
    recentlyPlanned: new Set((extra.recent ?? []).map(recipeId)),
    experienced: new Set((extra.proven ?? []).map(recipeId)),
    config,
    random: extra.random ?? noRandom,
  });
const names = (rs: readonly Recipe[]) => rs.map((r) => r.name);

describe("hard rules filter the deck", () => {
  it("offers only main dishes within the weekday limit; an unknown time stays in", () => {
    const ok = aRecipe({ name: "ok", totalTimeMinutes: 45 });
    const unknown = aRecipe({ name: "unknown", totalTimeMinutes: null });
    const out = rank(aSession(), [
      ok, unknown,
      aRecipe({ name: "long", totalTimeMinutes: 46 }),
      aRecipe({ name: "dessert", mealType: "dessert" }),
      aRecipe({ name: "snack", mealType: "snack" }),
    ]);
    expect(names(out).sort()).toEqual(["ok", "unknown"]);
    expect(needsTime(out.find((r) => r.name === "unknown")!)).toBe(true);
  });

  it("has no time limit on weekends", () => {
    expect(names(rank(aSession([SAT, SUN]), [aRecipe({ name: "pizza", totalTimeMinutes: 1440 })]))).toEqual(["pizza"]);
  });

  it("leaves out recipes that were vetoed, passed or already planned in the session", () => {
    const vetoed = aRecipe({ name: "vetoed" });
    const passed = aRecipe({ name: "passed" });
    const planned = aRecipe({ name: "planned" });
    const free = aRecipe({ name: "free" });
    let s = plan(aSession(), MON, planned);
    const p = withProposal(s, TUE, vetoed, AC);
    s = must(vetoProposal(p.session, { member: ME, proposalId: p.id })).state;
    s = must(passSuggestion(s, { member: ME, recipe: passed })).state;
    expect(names(rank(s, [vetoed, passed, planned, free]))).toEqual(["free"]);
  });

  it("offers nothing when no day is open or the session is not open", () => {
    const s = plan(plan(aSession([MON, TUE]), MON, aRecipe()), TUE, aRecipe());
    expect(rank(s, [aRecipe()])).toEqual([]);
  });

  it("is not capped: every eligible recipe is offered, one after another", () => {
    const many = Array.from({ length: 40 }, () => aRecipe());
    expect(rank(aSession(), many)).toHaveLength(40);
  });
});

describe("soft rules rank, they never exclude", () => {
  it("1. base variety: bases of the previous two days and of the other planned days come last", () => {
    const pasta = aRecipe({ name: "pasta", base: "pasta" });
    const rice = aRecipe({ name: "rice", base: "rice" });
    const potatoes = aRecipe({ name: "potatoes", base: "potatoes" });
    const other = aRecipe({ name: "other", base: "other" });
    const history: MealLogHistory[] = [
      { date: planDate("2026-11-01"), base: "pasta" }, // yesterday
      { date: planDate("2026-10-31"), base: "rice" }, // the day before
    ];
    expect(names(rank(aSession(), [pasta, rice, potatoes, other], { history }))).toEqual(["potatoes", "other", "pasta", "rice"]);
  });

  it("does not look further back than the variety window", () => {
    const pasta = aRecipe({ name: "pasta", base: "pasta" });
    const rice = aRecipe({ name: "rice", base: "rice" });
    const history: MealLogHistory[] = [{ date: planDate("2026-10-30"), base: "pasta" }]; // three days before Monday
    expect(names(rank(aSession(), [pasta, rice], { history }))).toEqual(["pasta", "rice"]);
  });

  it("never penalises the base 'other'", () => {
    const other = aRecipe({ name: "other", base: "other" });
    const pasta = aRecipe({ name: "pasta", base: "pasta" });
    const history: MealLogHistory[] = [{ date: planDate("2026-11-01"), base: "other" }];
    expect(names(rank(aSession(), [other, pasta], { history }))).toEqual(["other", "pasta"]);
  });

  it("counts the bases of days already planned in this session", () => {
    const s = plan(aSession(), MON, aRecipe({ base: "rice" }));
    const rice = aRecipe({ name: "rice", base: "rice" });
    const potatoes = aRecipe({ name: "potatoes", base: "potatoes" });
    expect(names(rank(s, [rice, potatoes]))).toEqual(["potatoes", "rice"]);
  });

  it("2. mostly vegetarian: meat or fish goes last once the share is at risk", () => {
    // three dinners, target ceil(0.66 * 3) = 2 vegetarian. One meat dish planned: both remaining days must be vegetarian.
    const s = plan(aSession(), MON, aRecipe({ diet: "meat", base: "rice" }));
    const meat = aRecipe({ name: "meat", diet: "meat", base: "other" });
    const veg = aRecipe({ name: "veg", diet: "vegetarian", base: "other" });
    const vegan = aRecipe({ name: "vegan", diet: "vegan", base: "other" });
    expect(names(rank(s, [meat, veg, vegan]))).toEqual(["veg", "vegan", "meat"]);
  });

  it("2. meat and vegetarian dishes rank equally while the share is not at risk", () => {
    const meat = aRecipe({ name: "meat", diet: "meat", base: "other" });
    const veg = aRecipe({ name: "veg", diet: "vegetarian", base: "other" });
    expect(names(rank(aSession(), [meat, veg]))).toEqual(["meat", "veg"]);
  });

  it("3. one new recipe per session: new first until one is planned, proven first afterwards", () => {
    const fresh = aRecipe({ name: "new", isProven: false, base: "other" });
    const known = aRecipe({ name: "known", isProven: true, base: "other" });
    expect(names(rank(aSession(), [known, fresh]))).toEqual(["new", "known"]);
    const afterNew = plan(aSession(), MON, aRecipe({ isProven: false, base: "rice" }));
    expect(names(rank(afterNew, [fresh, known]))).toEqual(["known", "new"]);
  });

  it("3. wants-to-try comes first among new recipes and gives proven recipes no boost", () => {
    const wanted = aRecipe({ name: "wanted", isProven: false, wantsToTry: true, base: "other" });
    const plain = aRecipe({ name: "plain", isProven: false, base: "other" });
    const provenWanted = aRecipe({ name: "provenWanted", isProven: true, wantsToTry: true, base: "other" });
    expect(names(rank(aSession(), [plain, provenWanted, wanted]))).toEqual(["wanted", "plain", "provenWanted"]);
  });

  it("3. a recipe with a confirmed cooking counts as proven", () => {
    const fresh = aRecipe({ name: "fresh", isProven: false, base: "other" });
    const cooked = aRecipe({ name: "cooked", isProven: false, base: "other" });
    expect(names(rank(aSession(), [cooked, fresh], { proven: [cooked.id] }))).toEqual(["fresh", "cooked"]);
  });

  it("4. recipes planned within the recent window come last but are still offered", () => {
    const recent = aRecipe({ name: "recent", base: "other" });
    const other = aRecipe({ name: "other", base: "other" });
    expect(names(rank(aSession(), [recent, other], { recent: [recent.id] }))).toEqual(["other", "recent"]);
  });

  it("5. stock plays no role yet", () => {
    const a = aRecipe({ name: "a", base: "other" });
    const b = aRecipe({ name: "b", base: "other" });
    expect(names(rank(aSession(), [a, b]))).toEqual(["a", "b"]);
  });

  it("the rules apply in the spec's order: variety beats vegetarian beats new beats recent", () => {
    const s = plan(aSession(), MON, aRecipe({ diet: "meat", base: "rice" })); // veg required for the rest
    const sameBase = aRecipe({ name: "sameBase", base: "rice", diet: "vegetarian", isProven: false, wantsToTry: true });
    const meat = aRecipe({ name: "meat", base: "other", diet: "meat", isProven: false, wantsToTry: true });
    const vegProven = aRecipe({ name: "vegProven", base: "other", diet: "vegetarian", isProven: true });
    const vegRecent = aRecipe({ name: "vegRecent", base: "other", diet: "vegetarian", isProven: true });
    const out = names(rank(s, [sameBase, meat, vegRecent, vegProven], { recent: [vegRecent.id] }));
    expect(out).toEqual(["vegProven", "vegRecent", "meat", "sameBase"]);
  });
});

describe("tie-break", () => {
  it("is random but reproducible: the same random source gives the same order", () => {
    const pool = Array.from({ length: 12 }, (_, i) => aRecipe({ name: `r${i}`, base: "other" }));
    const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const a = names(rank(aSession(), pool, { random: seeded(1) }));
    expect(names(rank(aSession(), pool, { random: seeded(1) }))).toEqual(a);
    expect(names(rank(aSession(), pool, { random: seeded(2) }))).not.toEqual(a);
    expect([...a].sort()).toEqual(names(pool).sort());
  });
});
