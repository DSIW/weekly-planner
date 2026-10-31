import { describe, expect, it } from "vitest";
import { planDate, proposalId, recipeId, sessionId, type PlanningSession, type Result } from "@weekly-planner/domain";
import { DateTakenConflict, OpenSessionConflict } from "../src/index.js";
import { household } from "./household.js";
import { AC, ME, aRecipe } from "./support/in-memory.js";

const MON = planDate("2026-11-02");
const TUE = planDate("2026-11-03");
const WED = planDate("2026-11-04");

const ok = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`setup failed: ${r.reason}`);
  return r.value;
};
const r1 = aRecipe(1, { base: "pasta" });
const r2 = aRecipe(2, { base: "rice" });
const r3 = aRecipe(3, { base: "potatoes" });

async function started(h = household([r1, r2, r3]), dates = [MON, TUE, WED]) {
  const s = ok(await h.startSession.execute({ member: AC, dates }));
  return { h, s };
}

/** AC proposes, ME accepts. */
async function agree(h: ReturnType<typeof household>, s: PlanningSession, date: typeof MON, recipe = r1) {
  const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date, recipeId: recipe.id }));
  const id = proposed.proposals.at(-1)!.id;
  return ok(await h.acceptProposal.execute({ member: ME, sessionId: s.id, proposalId: id }));
}

describe("a planning session through the use cases", () => {
  it("starts, proposes, accepts, finalizes and closes, saving each step and publishing its events", async () => {
    const { h, s } = await started();
    expect(await h.sessions.get(s.id)).toEqual(s);
    const planned = await agree(h, s, MON);
    expect(planned.days[0]).toMatchObject({ status: "planned", recipe: { id: r1.id } });
    const finalized = ok(await h.finalizePlan.execute({ member: ME, sessionId: s.id }));
    expect(finalized.status).toBe("finalized");
    ok(await h.closeSession.execute({ member: AC, sessionId: s.id }));
    expect((await h.sessions.get(s.id))?.status).toBe("closed");
    expect(h.events.types).toEqual([
      "SessionStarted",
      "RecipeProposed",
      "ProposalAccepted",
      "PlanFinalized",
      "SessionClosed",
    ]);
  });

  it("returns the rule's reason and saves and publishes nothing when a rule rejects", async () => {
    const { h, s } = await started();
    const before = h.events.published.length;
    const r = await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: TUE, recipeId: r1.id });
    expect(r).toEqual({ ok: false, reason: "not_next_open_day" });
    expect((await h.sessions.get(s.id))?.proposals).toEqual([]);
    expect(h.events.published).toHaveLength(before);
  });

  it("lets only one session be open: a second starts after the first is finalized or abandoned", async () => {
    const { h, s } = await started();
    expect(await h.startSession.execute({ member: ME, dates: [MON, TUE] })).toEqual({
      ok: false,
      reason: "session_already_open",
    });
    expect(await h.getCurrentSession.execute()).toEqual(s);
    ok(await h.closeSession.execute({ member: AC, sessionId: s.id }));
    expect(await h.getCurrentSession.execute()).toBeNull();
    const next = ok(await h.startSession.execute({ member: ME, dates: [MON, TUE] }));
    expect((await h.getCurrentSession.execute())?.id).toBe(next.id);
  });

  it("answers session_already_open when storage reports a concurrent start the check did not see", async () => {
    const h = household();
    h.sessions.save = async () => {
      throw new OpenSessionConflict();
    };
    expect(await h.startSession.execute({ member: AC, dates: [MON, TUE] })).toEqual({
      ok: false,
      reason: "session_already_open",
    });
    expect(h.events.published).toEqual([]);
  });

  it("rejects an invalid start without saving a session", async () => {
    const h = household();
    expect(await h.startSession.execute({ member: AC, dates: [MON] })).toEqual({ ok: false, reason: "too_few_days" });
    expect(await h.sessions.listAll()).toEqual([]);
  });

  it("reports an unknown session or recipe", async () => {
    const { h, s } = await started();
    expect(await h.finalizePlan.execute({ member: AC, sessionId: sessionId("nope") })).toEqual({
      ok: false,
      reason: "unknown_session",
    });
    expect(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: MON, recipeId: recipeId(99) })).toEqual({
      ok: false,
      reason: "unknown_recipe",
    });
    expect(await h.passSuggestion.execute({ member: AC, sessionId: s.id, recipeId: recipeId(99) })).toEqual({
      ok: false,
      reason: "unknown_recipe",
    });
  });

  it("lets the other member veto, and the recipe stays out of the session's deck", async () => {
    const { h, s } = await started();
    const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: MON, recipeId: r1.id }));
    ok(await h.vetoProposal.execute({ member: ME, sessionId: s.id, proposalId: proposed.proposals[0]!.id }));
    expect((await h.suggestRecipes.execute({ sessionId: s.id })).map((r) => r.id)).toEqual([r2.id, r3.id]);
    expect(await h.vetoProposal.execute({ member: ME, sessionId: s.id, proposalId: proposalId("nope") })).toEqual({
      ok: false,
      reason: "unknown_proposal",
    });
  });

  it("passes on a suggestion for both members", async () => {
    const { h, s } = await started();
    ok(await h.passSuggestion.execute({ member: ME, sessionId: s.id, recipeId: r2.id }));
    expect((await h.suggestRecipes.execute({ sessionId: s.id })).map((r) => r.id)).toEqual([r1.id, r3.id]);
  });

  it("marks, reopens, swaps and moves days", async () => {
    const { h, s } = await started();
    ok(await h.markLeftoverDay.execute({ member: AC, sessionId: s.id, date: WED }));
    ok(await h.reopenDay.execute({ member: AC, sessionId: s.id, date: WED }));
    await agree(h, s, MON, r1);
    await agree(h, s, TUE, r2);
    const swapped = ok(await h.swapPlannedDays.execute({ member: AC, sessionId: s.id, a: MON, b: TUE }));
    expect(swapped.days.map((d) => d.recipe?.id)).toEqual([r2.id, r1.id, undefined]);
    const moved = ok(await h.movePlannedDay.execute({ member: AC, sessionId: s.id, from: MON, to: WED }));
    expect(moved.days.map((d) => d.status)).toEqual(["open", "planned", "planned"]);
    expect(h.events.types).toEqual(
      expect.arrayContaining(["DayMarkedLeftovers", "DayReopened", "DaysSwapped", "DayMoved"]),
    );
  });
});

describe("the list of recipes for the next open day", () => {
  const dessert = aRecipe(10, { mealType: "dessert", name: "Tiramisu" });
  const slow = aRecipe(11, { totalTimeMinutes: 90, name: "Schmorbraten" });
  const zucchini = aRecipe(12, { totalTimeMinutes: 25, name: "Zucchinipfanne" });
  const apple = aRecipe(13, { totalTimeMinutes: 30, name: "Apfelpfannkuchen" });
  const all = [dessert, slow, zucchini, apple];

  it("names the day and offers eligible dinners by name", async () => {
    const { h, s } = await started(household(all), [MON, TUE]);
    expect(await h.listEligibleRecipes.execute({ sessionId: s.id })).toEqual({
      date: MON,
      recipes: [apple, zucchini],
    });
  });

  it("puts recipes that need planning ahead last, whatever their name", async () => {
    const biga = aRecipe(20, { name: "Biga", totalTimeMinutes: 1285 });
    const zander = aRecipe(21, { name: "Zander", totalTimeMinutes: 90 });
    const { h, s } = await started(household([biga, zander, apple]), [planDate("2026-11-07"), planDate("2026-11-08")]);
    expect((await h.listEligibleRecipes.execute({ sessionId: s.id }))?.recipes.map((r) => r.name)).toEqual([
      "Apfelpfannkuchen",
      "Zander",
      "Biga",
    ]);
  });

  it("leaves out what was vetoed and moves on to the next day once one is agreed", async () => {
    const { h, s } = await started(household(all), [MON, TUE]);
    const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: MON, recipeId: apple.id }));
    ok(await h.vetoProposal.execute({ member: ME, sessionId: s.id, proposalId: proposed.proposals[0]!.id }));
    expect((await h.listEligibleRecipes.execute({ sessionId: s.id }))?.recipes).toEqual([zucchini]);
    await agree(h, s, MON, zucchini);
    expect(await h.listEligibleRecipes.execute({ sessionId: s.id })).toEqual({ date: TUE, recipes: [] });
  });

  it("is null for an unknown session and for one that is closed", async () => {
    const { h, s } = await started(household(all), [MON, TUE]);
    expect(await h.listEligibleRecipes.execute({ sessionId: sessionId("nope") })).toBeNull();
    ok(await h.closeSession.execute({ member: AC, sessionId: s.id }));
    expect(await h.listEligibleRecipes.execute({ sessionId: s.id })).toBeNull();
  });

  it("re-reads the recipes from their source on request", async () => {
    const h = household(all);
    await h.refreshRecipes.execute();
    expect(h.catalog.refreshes).toBe(1);
  });
});

describe("a concurrent decision on the same date", () => {
  it("answers date_already_taken when storage reports that another session took the date meanwhile", async () => {
    const { h, s } = await started(household([r1]), [MON, TUE]);
    const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: MON, recipeId: r1.id }));
    h.sessions.save = async () => {
      throw new DateTakenConflict();
    };
    expect(
      await h.acceptProposal.execute({ member: ME, sessionId: s.id, proposalId: proposed.proposals[0]!.id }),
    ).toEqual({ ok: false, reason: "date_already_taken" });
  });
});

describe("one dinner per date across sessions (DinnerCalendar)", () => {
  it("rejects accepting a proposal for a date another session already planned", async () => {
    const { h, s: first } = await started(household([r1, r2, r3]), [MON, TUE]);
    await agree(h, first, MON, r1);
    // Only one session is open at a time, so the clash comes from a finalized session still holding its dinner.
    ok(await h.finalizePlan.execute({ member: ME, sessionId: first.id }));
    const second = ok(await h.startSession.execute({ member: AC, dates: [MON, WED] }));
    const proposed = ok(
      await h.proposeRecipe.execute({ member: AC, sessionId: second.id, date: MON, recipeId: r2.id }),
    );
    const r = await h.acceptProposal.execute({
      member: ME,
      sessionId: second.id,
      proposalId: proposed.proposals[0]!.id,
    });
    expect(r).toEqual({ ok: false, reason: "date_already_taken" });
  });
});

describe("one dinner per date across sessions: moving", () => {
  it("rejects moving a dinner onto a date a finalized session already planned", async () => {
    const { h, s: first } = await started(household([r1, r2, r3]), [WED, planDate("2026-11-05")]);
    await agree(h, first, WED, r1);
    ok(await h.finalizePlan.execute({ member: ME, sessionId: first.id }));
    const second = ok(await h.startSession.execute({ member: AC, dates: [TUE, WED] }));
    await agree(h, second, TUE, r2);
    expect(await h.movePlannedDay.execute({ member: AC, sessionId: second.id, from: TUE, to: WED })).toEqual({
      ok: false,
      reason: "date_already_taken",
    });
  });
});

describe("RemindToFinalize", () => {
  it("notifies once, at 08:00 on the first agreed day, and only while the plan is open", async () => {
    const { h, s } = await started();
    await agree(h, s, MON);
    h.clock.date = MON;
    h.clock.hour = 7;
    expect(await h.remindToFinalize.execute()).toBe(0);
    h.clock.hour = 8;
    expect(await h.remindToFinalize.execute()).toBe(1);
    expect(await h.remindToFinalize.execute()).toBe(0);
    expect(h.notifier.reminders).toEqual([s.id]);
    expect(h.events.types).toContain("FinalizeReminderDue");
  });

  it("does not remind about a finalized plan", async () => {
    const { h, s } = await started();
    await agree(h, s, MON);
    ok(await h.finalizePlan.execute({ member: AC, sessionId: s.id }));
    h.clock.date = MON;
    h.clock.hour = 9;
    expect(await h.remindToFinalize.execute()).toBe(0);
  });
});
