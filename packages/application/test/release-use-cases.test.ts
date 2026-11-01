import { describe, expect, it } from "vitest";
import { planDate, type PlanDate, type PlanningSession, type Result } from "@weekly-planner/domain";
import { household } from "./household.js";
import { AC, ME, aRecipe } from "./support/in-memory.js";

const MON = planDate("2026-11-02");
const WED = planDate("2026-11-04");
const SUN = planDate("2026-11-08");

const ok = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`setup failed: ${r.reason}`);
  return r.value;
};
const r1 = aRecipe(1, { base: "pasta" });

/** A plan with a dinner on Wednesday that was finalized and written to KitchenOwl's planner. */
async function exportedOnWed() {
  const h = household([r1]);
  h.clock.date = MON;
  const s = ok(await h.startSession.execute({ member: AC, dates: [WED, SUN] }));
  const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: WED, recipeId: r1.id }));
  ok(await h.acceptProposal.execute({ member: ME, sessionId: s.id, proposalId: proposed.proposals[0]!.id }));
  ok(await h.finalizePlan.execute({ member: ME, sessionId: s.id }));
  return { h, id: s.id };
}

const day = (h: Awaited<ReturnType<typeof exportedOnWed>>["h"], id: PlanningSession["id"], date: PlanDate) =>
  h.sessions.byId.get(id)!.days.find((d) => d.date === date)!;

describe("ReleaseRemovedDinners", () => {
  it("frees the date of a dinner that reached KitchenOwl's planner and is gone from it", async () => {
    const { h, id } = await exportedOnWed();
    h.plannerView.dates = new Set();
    h.events.published.length = 0;
    expect(await h.releaseRemovedDinners.execute()).toBe(1);
    expect(day(h, id, WED).removedInPlanner).toBe(true);
    expect(h.events.published).toEqual([{ type: "DinnerReleased", sessionId: id, date: WED }]);
    expect(await h.releaseRemovedDinners.execute()).toBe(0);
  });

  it("lets the next plan use the freed date and stops listing it", async () => {
    const { h } = await exportedOnWed();
    expect(await h.listTakenDates.execute()).toEqual([{ date: WED, recipeName: r1.name }]);
    h.plannerView.dates = new Set();
    expect(await h.listTakenDates.execute()).toEqual([]);
    ok(await h.startSession.execute({ member: AC, dates: [WED, SUN] }));
  });

  it("releases nothing on a guess: KitchenOwl unreachable, the entry still there, or a date from the past", async () => {
    const { h, id } = await exportedOnWed();
    h.plannerView.dates = null;
    expect(await h.releaseRemovedDinners.execute()).toBe(0);
    h.plannerView.dates = new Set([WED]);
    expect(await h.releaseRemovedDinners.execute()).toBe(0);
    h.plannerView.dates = new Set();
    h.clock.date = planDate("2026-11-05");
    expect(await h.releaseRemovedDinners.execute()).toBe(0);
    expect(day(h, id, WED).removedInPlanner).toBeUndefined();
  });

  it("keeps the date of a dinner that never reached the planner, and ignores open and discarded plans", async () => {
    const { h, id } = await exportedOnWed();
    h.plannerView.dates = new Set();
    h.exports.bySession.clear();
    expect(await h.releaseRemovedDinners.execute()).toBe(0);
    expect(day(h, id, WED).removedInPlanner).toBeUndefined();
    const session = h.sessions.byId.get(id)!;
    await h.sessions.save({ ...session, status: "open" });
    expect(await h.releaseRemovedDinners.execute()).toBe(0);
  });

  it("does not stop listing the dates when releasing fails", async () => {
    const { h } = await exportedOnWed();
    h.releaseRemovedDinners.execute = async () => {
      throw new Error("down");
    };
    expect(await h.listTakenDates.execute()).toHaveLength(1);
  });
});

describe("naming a meal for a day", () => {
  it("replaces what was logged for that day and leaves other days alone", async () => {
    const h = household([r1]);
    h.clock.date = SUN;
    ok(await h.addLoggedMeal.execute({ member: ME, date: WED, base: "rice", recipeId: null }));
    ok(await h.addLoggedMeal.execute({ member: ME, date: MON, base: "bread", recipeId: null }));
    ok(await h.addLoggedMeal.execute({ member: AC, date: WED, base: "pasta", recipeId: r1.id }));
    const log = await h.listMealLog.execute({ days: 14 });
    expect(log.map((e) => [e.date, e.base])).toEqual([
      [WED, "pasta"],
      [MON, "bread"],
    ]);
  });

  it("offers no preparation (mise en place) as a meal", async () => {
    const prep = aRecipe(9, { mealType: "prep" });
    const h = household([r1, prep]);
    expect((await h.listRecipes.execute()).map((r) => r.id)).toEqual([r1.id]);
  });
});
