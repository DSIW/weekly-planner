import { describe, expect, it } from "vitest";
import { planDate, type MealLogEntry, type PlanningSession, type Result } from "@weekly-planner/domain";
import { household } from "./household.js";
import { AC, ME, aRecipe } from "./support/in-memory.js";

const MON = planDate("2026-11-02");
const TUE = planDate("2026-11-03");
const WED = planDate("2026-11-04");
const THU = planDate("2026-11-05");

const ok = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`setup failed: ${r.reason}`);
  return r.value;
};
const fresh = aRecipe(1, { name: "Neu", base: "pasta", isProven: false });
const other = aRecipe(2, { name: "Anders", base: "rice", isProven: false });

/** A finalized session with `fresh` planned on Monday; the clock is on Tuesday, so the dinner is due for the log. */
async function dayAfterDinner() {
  const h = household([fresh, other]);
  const s = ok(await h.startSession.execute({ member: AC, dates: [MON, TUE] }));
  const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: MON, recipeId: fresh.id }));
  ok(await h.acceptProposal.execute({ member: ME, sessionId: s.id, proposalId: proposed.proposals[0]!.id }));
  ok(await h.finalizePlan.execute({ member: AC, sessionId: s.id }));
  h.clock.date = TUE;
  return { h, s };
}
const only = (h: ReturnType<typeof household>): MealLogEntry => [...h.mealLog.entries.values()][0]!;

describe("LogPlannedMeals", () => {
  it("logs yesterday's planned dinner as an unconfirmed entry, once", async () => {
    const { h } = await dayAfterDinner();
    expect(await h.logPlannedMeals.execute()).toBe(1);
    expect(only(h)).toMatchObject({ date: MON, base: "pasta", source: "from_plan", confirmed: false });
    expect(await h.logPlannedMeals.execute()).toBe(0);
    expect(h.events.types).toContain("MealLogged");
  });

  it("does nothing on the planned day itself", async () => {
    const { h } = await dayAfterDinner();
    h.clock.date = MON;
    expect(await h.logPlannedMeals.execute()).toBe(0);
  });
});

describe("LogPlannedMeals and discarded plans", () => {
  it("logs nothing for a plan that was thrown away without being finalized", async () => {
    const h = household([fresh, other]);
    const s = ok(await h.startSession.execute({ member: AC, dates: [MON, TUE] }));
    const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: MON, recipeId: fresh.id }));
    ok(await h.acceptProposal.execute({ member: ME, sessionId: s.id, proposalId: proposed.proposals[0]!.id }));
    ok(await h.closeSession.execute({ member: AC, sessionId: s.id }));
    h.clock.date = TUE;
    expect(await h.logPlannedMeals.execute()).toBe(0);
    expect(h.mealLog.entries.size).toBe(0);
  });

  it("still logs a finalized plan that was closed afterwards", async () => {
    const { h, s } = await dayAfterDinner();
    ok(await h.closeSession.execute({ member: AC, sessionId: s.id }));
    expect(await h.logPlannedMeals.execute()).toBe(1);
  });
});

describe("ConfirmCooked", () => {
  it("confirms the entry and makes the recipe proven, so it ranks as known", async () => {
    const { h, s } = await dayAfterDinner();
    await h.logPlannedMeals.execute();
    expect(ok(await h.confirmCooked.execute({ member: ME, entryId: only(h).id })).confirmed).toBe(true);
    expect(h.experience.byRecipe.get(fresh.id)).toEqual({ recipeId: fresh.id, firstCooked: MON });
    expect(h.events.types).toContain("MealConfirmedAsCooked");
    // a second session: the confirmed recipe no longer counts as new, the unproven one does
    const next = ok(await h.startSession.execute({ member: AC, dates: [WED, THU] }));
    expect((await h.suggestRecipes.execute({ sessionId: next.id })).map((r) => r.id)).toEqual([other.id, fresh.id]);
    expect(s.id).not.toBe(next.id);
  });

  it("is rejected for an unknown entry", async () => {
    const { h } = await dayAfterDinner();
    const r = await h.confirmCooked.execute({ member: ME, entryId: "nope" as MealLogEntry["id"] });
    expect(r).toEqual({ ok: false, reason: "unknown_entry" });
  });
});

describe("MarkNotCooked", () => {
  it("removes the entry so it no longer counts for variety, and the daily job does not log it again", async () => {
    const { h } = await dayAfterDinner();
    await h.logPlannedMeals.execute();
    ok(await h.markNotCooked.execute({ member: ME, entryId: only(h).id }));
    expect(h.mealLog.entries.size).toBe(0);
    expect(await h.logPlannedMeals.execute()).toBe(0);
    expect(h.experience.byRecipe.size).toBe(0);
  });
});

describe("CorrectLoggedMeal and AddLoggedMeal", () => {
  it("corrects an entry to another recipe: confirmed, and that recipe becomes proven", async () => {
    const { h } = await dayAfterDinner();
    await h.logPlannedMeals.execute();
    const e = ok(
      await h.correctLoggedMeal.execute({ member: ME, entryId: only(h).id, base: "rice", recipeId: other.id }),
    );
    expect(e).toMatchObject({ source: "corrected", confirmed: true, base: "rice" });
    expect([...h.experience.byRecipe.keys()]).toEqual([other.id]);
  });

  it("corrects an entry to a base only: nothing becomes proven", async () => {
    const { h } = await dayAfterDinner();
    await h.logPlannedMeals.execute();
    ok(await h.correctLoggedMeal.execute({ member: ME, entryId: only(h).id, base: "potatoes", recipeId: null }));
    expect(h.experience.byRecipe.size).toBe(0);
  });

  it("adds a past meal outside KitchenOwl, which counts for base variety in the next deck", async () => {
    const { h } = await dayAfterDinner();
    ok(await h.addLoggedMeal.execute({ member: AC, date: TUE, base: "pasta", recipeId: null }));
    const s: PlanningSession = ok(await h.startSession.execute({ member: AC, dates: [WED, THU] }));
    const names = (await h.suggestRecipes.execute({ sessionId: s.id })).map((r) => r.name);
    expect(names).toEqual(["Anders", "Neu"]); // pasta was yesterday: Neu (pasta) ranks last
  });

  it("rejects a meal dated in the future", async () => {
    const { h } = await dayAfterDinner();
    expect(await h.addLoggedMeal.execute({ member: AC, date: THU, base: "rice", recipeId: null })).toEqual({
      ok: false,
      reason: "date_in_future",
    });
  });
});

describe("ListMealLog", () => {
  it("lists the entries of the last days, newest first, and nothing older", async () => {
    const h = household([fresh, other]);
    h.clock.date = THU;
    for (const [date, base] of [
      [planDate("2026-10-20"), "rice"],
      [MON, "pasta"],
      [WED, "rice"],
      [TUE, "pasta"],
    ] as const) {
      ok(await h.addLoggedMeal.execute({ member: ME, date, base, recipeId: null }));
    }
    const list = await h.listMealLog.execute({ days: 7 });
    expect(list.map((e) => e.date)).toEqual([WED, TUE, MON]);
    expect((await h.listMealLog.execute({ days: 30 })).map((e) => e.date)).toEqual([
      WED,
      TUE,
      MON,
      planDate("2026-10-20"),
    ]);
    expect(await h.listMealLog.execute({ days: 0 })).toEqual([]);
  });
});

describe("ListRecipes", () => {
  it("lists the recipes that are ready, by name, and leaves out those with problems", async () => {
    const zebra = aRecipe(5, { name: "Zebrabraten" });
    const apple = aRecipe(6, { name: "Äpfel" });
    const h = household([zebra, fresh, apple]);
    h.catalog.entries.push({ kind: "needs-data", recipeId: aRecipe(9).id, name: "Kaputt", problems: ["no diet tag"] });
    expect((await h.listRecipes.execute()).map((r) => r.name)).toEqual(["Äpfel", "Neu", "Zebrabraten"]);
  });
});

describe("witness S5: ListMealLog window edge and tie order (mutation gaps)", () => {
  it("reaches back exactly the given number of days, that day included", async () => {
    const h = household([fresh, other]);
    h.clock.date = THU;
    ok(await h.addLoggedMeal.execute({ member: ME, date: MON, base: "rice", recipeId: null }));
    expect((await h.listMealLog.execute({ days: 3 })).map((e) => e.date)).toEqual([MON]);
    expect(await h.listMealLog.execute({ days: 2 })).toEqual([]);
  });

  it("orders entries of the same day by their id", async () => {
    const h = household([fresh, other]);
    h.clock.date = THU;
    ok(await h.addLoggedMeal.execute({ member: ME, date: WED, base: "rice", recipeId: null }));
    ok(await h.addLoggedMeal.execute({ member: ME, date: WED, base: "pasta", recipeId: null }));
    const ids = (await h.listMealLog.execute({ days: 7 })).map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual([...ids].sort());
  });
});
