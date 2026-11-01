import { describe, expect, it } from "vitest";
import {
  defaultPlanningConfig as config,
  planDate,
  proposalId,
  recipeId,
  sessionId,
  type PlanningSession,
  type Result,
} from "@weekly-planner/domain";
import { DateTakenConflict, OpenSessionConflict, RemindToFinalize } from "../src/index.js";
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
    expect(finalized.session.status).toBe("finalized");
    ok(await h.closeSession.execute({ member: AC, sessionId: s.id }));
    expect((await h.sessions.get(s.id))?.status).toBe("closed");
    expect(h.events.types).toEqual([
      "SessionStarted",
      "RecipeProposed",
      "ProposalAccepted",
      "PlanFinalized",
      "ExportProgressed",
      "ExportProgressed",
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

  it("lets the proposer take a proposal back: the day stays open and the dish may be proposed again", async () => {
    const { h, s } = await started();
    const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: MON, recipeId: r1.id }));
    const id = proposed.proposals[0]!.id;
    const back = ok(await h.withdrawProposal.execute({ member: AC, sessionId: s.id, proposalId: id }));
    expect(back.proposals[0]?.status).toBe("withdrawn");
    expect(back.days[0]?.status).toBe("open");
    expect(h.events.types).toContain("ProposalWithdrawn");
    expect((await h.suggestRecipes.execute({ sessionId: s.id })).map((r) => r.id)).toContain(r1.id);
    ok(await h.proposeRecipe.execute({ member: ME, sessionId: s.id, date: MON, recipeId: r1.id }));
  });

  it("refuses to withdraw somebody else's proposal, a decided one or an unknown one", async () => {
    const { h, s } = await started();
    const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: MON, recipeId: r1.id }));
    const id = proposed.proposals[0]!.id;
    expect(await h.withdrawProposal.execute({ member: ME, sessionId: s.id, proposalId: id })).toEqual({
      ok: false,
      reason: "not_your_proposal",
    });
    ok(await h.acceptProposal.execute({ member: ME, sessionId: s.id, proposalId: id }));
    expect(await h.withdrawProposal.execute({ member: AC, sessionId: s.id, proposalId: id })).toEqual({
      ok: false,
      reason: "proposal_not_pending",
    });
    expect(await h.withdrawProposal.execute({ member: AC, sessionId: s.id, proposalId: proposalId("nope") })).toEqual({
      ok: false,
      reason: "unknown_proposal",
    });
  });

  it("refuses to withdraw once the plan is closed", async () => {
    const { h, s } = await started();
    const proposed = ok(await h.proposeRecipe.execute({ member: AC, sessionId: s.id, date: MON, recipeId: r1.id }));
    ok(await h.closeSession.execute({ member: AC, sessionId: s.id }));
    expect(
      await h.withdrawProposal.execute({ member: AC, sessionId: s.id, proposalId: proposed.proposals[0]!.id }),
    ).toEqual({ ok: false, reason: "session_not_open" });
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

describe("the ranked deck", () => {
  const pasta = aRecipe(30, { name: "Pasta", base: "pasta" });
  const rice = aRecipe(31, { name: "Reis", base: "rice" });
  const potatoes = aRecipe(32, { name: "Kartoffeln", base: "potatoes", isProven: false });
  const all = [pasta, rice, potatoes];

  it("counts a dinner planned in an earlier session towards base variety, before it is logged", async () => {
    // The earlier session plans one pasta dish; a DIFFERENT pasta dish must rank below rice and potatoes the next day.
    // (The same dish would also rank lower as "recently planned", which would hide whether variety works.)
    const otherPasta = aRecipe(33, { name: "Nudeln", base: "pasta" });
    // Nudeln comes first in the catalog: without the variety rule it would lead the deck.
    const { h, s: first } = await started(household([otherPasta, ...all]), [MON, TUE]);
    await agree(h, first, MON, pasta);
    ok(await h.finalizePlan.execute({ member: ME, sessionId: first.id }));
    const second = ok(await h.startSession.execute({ member: AC, dates: [TUE, WED] }));
    const ranked = (await h.suggestRecipes.execute({ sessionId: second.id })).map((r) => r.name);
    const at = (name: string) => ranked.indexOf(name);
    expect(at("Nudeln")).toBeGreaterThan(at("Reis"));
    expect(at("Nudeln")).toBeGreaterThan(at("Kartoffeln"));
  });

  describe("the recent-plan window (14 days) counts plans of earlier sessions", () => {
    // Both dishes have the base "other", which variety never holds against a recipe, so only the window can reorder them.
    const x = aRecipe(40, { name: "X", base: "other" });
    const y = aRecipe(41, { name: "Y", base: "other" });
    const afterSession = async (planned: string) => {
      const { h, s: first } = await started(household([x, y]), [planDate(planned), planDate("2026-10-31")]);
      await agree(h, first, planDate(planned), x);
      ok(await h.finalizePlan.execute({ member: ME, sessionId: first.id }));
      const second = ok(await h.startSession.execute({ member: AC, dates: [MON, TUE] }));
      return (await h.suggestRecipes.execute({ sessionId: second.id })).map((r) => r.name);
    };

    it("ranks a dish planned inside the window after an equal one", async () => {
      expect(await afterSession("2026-10-20")).toEqual(["Y", "X"]); // 12 days before the clock's today (2026-11-01)
    });

    it("does not hold a dish planned before the window against it", async () => {
      expect(await afterSession("2026-10-10")).toEqual(["X", "Y"]); // 22 days before; catalog order decides
    });
  });

  describe("plans that were thrown away", () => {
    // Both dishes have the base "other", so only the recent-plan window and a base rule could reorder them.
    const x = aRecipe(50, { name: "X", base: "other" });
    const y = aRecipe(51, { name: "Y", base: "other" });
    const rankedAfter = async (finalize: boolean, closeIt: boolean) => {
      const { h, s: first } = await started(household([x, y]), [planDate("2026-10-31"), planDate("2026-10-30")]);
      await agree(h, first, planDate("2026-10-30"), x);
      if (finalize) ok(await h.finalizePlan.execute({ member: ME, sessionId: first.id }));
      if (closeIt) ok(await h.closeSession.execute({ member: AC, sessionId: first.id }));
      const second = ok(await h.startSession.execute({ member: AC, dates: [MON, TUE] }));
      return (await h.suggestRecipes.execute({ sessionId: second.id })).map((r) => r.name);
    };

    it("do not count: a dish of a discarded plan is not held against itself", async () => {
      expect(await rankedAfter(false, true)).toEqual(["X", "Y"]);
    });

    it("still count when the plan was finalized before it was closed", async () => {
      expect(await rankedAfter(true, true)).toEqual(["Y", "X"]);
    });

    it("count for a finalized plan that stays open on the board", async () => {
      expect(await rankedAfter(true, false)).toEqual(["Y", "X"]);
    });
  });

  it("is for the next open day once the first one is agreed", async () => {
    const { h, s } = await started(household(all), [MON, TUE]);
    await agree(h, s, MON, pasta);
    expect((await h.getDeck.execute({ sessionId: s.id }))?.date).toBe(TUE);
  });

  it("asks for its tie-break once per recipe and session, so the order cannot change between requests", async () => {
    const { h, s } = await started(household(all), [MON, TUE]);
    await h.suggestRecipes.execute({ sessionId: s.id });
    expect([...new Set(h.randomKeys)].sort()).toEqual(all.map((r) => `${s.id}:${r.id}`).sort());
  });

  it("is the ranked list with the day it is for and which recipes are new", async () => {
    const { h, s } = await started(household(all), [MON, TUE]);
    const deck = await h.getDeck.execute({ sessionId: s.id });
    expect(deck?.date).toBe(MON);
    expect(deck?.cards.map((c) => [c.recipe.name, c.isNew])).toEqual([
      ["Kartoffeln", true],
      ["Pasta", false],
      ["Reis", false],
    ]);
  });

  it("drops a passed dish for everyone and is null when no day is open", async () => {
    const { h, s } = await started(household(all), [MON, TUE]);
    ok(await h.passSuggestion.execute({ member: ME, sessionId: s.id, recipeId: pasta.id }));
    expect((await h.getDeck.execute({ sessionId: s.id }))?.cards.map((c) => c.recipe.name)).not.toContain("Pasta");
    ok(await h.closeSession.execute({ member: AC, sessionId: s.id }));
    expect(await h.getDeck.execute({ sessionId: s.id })).toBeNull();
    expect(await h.getDeck.execute({ sessionId: sessionId("nope") })).toBeNull();
  });

  it("hands out a recipe's photo when KitchenOwl has one", async () => {
    const h = household(all);
    h.catalog.photos.set(pasta.id, { contentType: "image/jpeg", data: new Uint8Array([1, 2, 3]) });
    expect((await h.getRecipePhoto.execute({ recipeId: pasta.id }))?.contentType).toBe("image/jpeg");
    expect(await h.getRecipePhoto.execute({ recipeId: rice.id })).toBeNull();
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
  /** Another plan took the date after this one was started: only a race can do that, since starting checks it. */
  async function raceFor(h: ReturnType<typeof household>, from: PlanningSession, date: typeof MON) {
    const recipe = from.days.find((d) => d.status === "planned")!.recipe!;
    await h.sessions.save({
      ...from,
      id: sessionId("other"),
      status: "finalized",
      days: [{ date, status: "planned", recipe }],
      proposals: [],
    });
  }

  it("rejects accepting a proposal for a date another session planned in the meantime", async () => {
    const { h, s: first } = await started(household([r1, r2, r3]), [MON, TUE]);
    await agree(h, first, MON, r1);
    ok(await h.finalizePlan.execute({ member: ME, sessionId: first.id }));
    const second = ok(await h.startSession.execute({ member: AC, dates: [TUE, WED] }));
    await raceFor(h, h.sessions.byId.get(first.id)!, TUE);
    const proposed = ok(
      await h.proposeRecipe.execute({ member: AC, sessionId: second.id, date: TUE, recipeId: r2.id }),
    );
    const r = await h.acceptProposal.execute({
      member: ME,
      sessionId: second.id,
      proposalId: proposed.proposals[0]!.id,
    });
    expect(r).toEqual({ ok: false, reason: "date_already_taken" });
  });

  describe("starting a plan", () => {
    const finalizedOn = async (date: typeof MON) => {
      const { h, s: first } = await started(household([r1, r2, r3]), [date, planDate("2026-11-09")]);
      await agree(h, first, date, r1);
      ok(await h.finalizePlan.execute({ member: ME, sessionId: first.id }));
      return { h, first };
    };

    it("refuses a date a finalized plan already planned a dinner for", async () => {
      const { h } = await finalizedOn(WED);
      expect(await h.startSession.execute({ member: AC, dates: [TUE, WED] })).toEqual({
        ok: false,
        reason: "date_already_taken",
      });
      expect(h.sessions.byId.size).toBe(1);
    });

    it("accepts the dates once that plan was closed, since a closed plan holds nothing", async () => {
      const { h, first } = await finalizedOn(WED);
      ok(await h.closeSession.execute({ member: AC, sessionId: first.id }));
      ok(await h.startSession.execute({ member: AC, dates: [TUE, WED] }));
    });

    it("is not held back by a plan that was thrown away", async () => {
      const { h, s: first } = await started(household([r1, r2, r3]), [WED, planDate("2026-11-09")]);
      await agree(h, first, WED, r1);
      ok(await h.closeSession.execute({ member: AC, sessionId: first.id }));
      ok(await h.startSession.execute({ member: AC, dates: [TUE, WED] }));
    });

    it("lists the dates that hold a dinner from today on", async () => {
      const { h } = await finalizedOn(WED);
      expect(await h.listTakenDates.execute()).toEqual([WED]);
      h.clock.date = planDate("2026-11-05");
      expect(await h.listTakenDates.execute()).toEqual([]);
    });
  });
});

describe("one dinner per date across sessions: moving", () => {
  it("rejects moving a dinner onto a date another session planned in the meantime", async () => {
    const { h, s: first } = await started(household([r1, r2, r3]), [WED, planDate("2026-11-05")]);
    await agree(h, first, WED, r1);
    ok(await h.finalizePlan.execute({ member: ME, sessionId: first.id }));
    const second = ok(await h.startSession.execute({ member: AC, dates: [TUE, planDate("2026-11-06")] }));
    await agree(h, second, TUE, r2);
    await h.sessions.save({
      ...h.sessions.byId.get(first.id)!,
      id: sessionId("other"),
      days: [{ date: planDate("2026-11-06"), status: "planned", recipe: r1 }],
    });
    expect(
      await h.movePlannedDay.execute({ member: AC, sessionId: second.id, from: TUE, to: planDate("2026-11-06") }),
    ).toEqual({ ok: false, reason: "date_already_taken" });
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

  it("decides on the session as it is when the reminder is saved, not as it was when the job looked", async () => {
    const { h, s } = await started();
    await agree(h, s, MON);
    h.clock.date = MON;
    h.clock.hour = 8;
    const looked = await h.sessions.listAll(); // the job's first look: still open
    h.sessions.listAll = async () => looked;
    ok(await h.finalizePlan.execute({ member: AC, sessionId: s.id })); // a member finalizes meanwhile
    expect(await h.remindToFinalize.execute()).toBe(0);
    expect(h.sessions.byId.get(s.id)?.status).toBe("finalized");
    expect(h.notifier.reminders).toEqual([]);
  });

  const recorded = async () => {
    const { h, s } = await started();
    await agree(h, s, MON);
    h.clock.date = MON;
    h.clock.hour = 8;
    const log: string[] = [];
    const get = h.sessions.get.bind(h.sessions);
    const save = h.sessions.save.bind(h.sessions);
    h.sessions.get = async (id) => (log.push("get"), get(id));
    h.sessions.save = async (x) => (log.push("save"), save(x));
    const uow = {
      run: async <T>(work: () => Promise<T>) => {
        log.push("begin");
        const result = await work();
        log.push("commit");
        return result;
      },
    };
    const notifier = { finalizeReminder: async () => void log.push("notify"), test: async () => 0 };
    const job = new RemindToFinalize({ sessions: h.sessions, notifier, events: h.events, uow, clock: h.clock }, config);
    return { h, s, log, job, save };
  };

  it("re-reads and saves inside the unit of work, and tells the phones only after the commit", async () => {
    const { log, job } = await recorded();
    expect(await job.execute()).toBe(1);
    expect(log).toEqual(["begin", "get", "save", "commit", "notify"]);
  });

  it("tells nobody when the reminder could not be saved, so a failed save is not pushed again every minute", async () => {
    const { h, s, log, job } = await recorded();
    h.sessions.save = async () => {
      throw new Error("disk full");
    };
    await expect(job.execute()).rejects.toThrow("disk full");
    expect(log).not.toContain("notify");
    expect(h.sessions.byId.get(s.id)?.reminderSent).toBe(false);
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

describe("witness S5: base variety ignores a discarded plan (mutation gap)", () => {
  // The earlier plan holds a pasta dish on the day before the deck's window ends; a different pasta dish (Nudeln, first
  // in the catalog) only falls behind Reis when that plan counts for base variety, i.e. when it was finalized.
  const nudeln = aRecipe(60, { name: "Nudeln", base: "pasta" });
  const reis = aRecipe(61, { name: "Reis", base: "rice" });
  const spaghetti = aRecipe(62, { name: "Spaghetti", base: "pasta" });
  const rankedAfter = async (finalize: boolean) => {
    const sat = planDate("2026-10-31");
    const { h, s: first } = await started(household([nudeln, reis, spaghetti]), [planDate("2026-10-30"), sat]);
    ok(await h.markLeftoverDay.execute({ member: AC, sessionId: first.id, date: planDate("2026-10-30") }));
    await agree(h, first, sat, spaghetti);
    if (finalize) ok(await h.finalizePlan.execute({ member: ME, sessionId: first.id }));
    ok(await h.closeSession.execute({ member: AC, sessionId: first.id }));
    const second = ok(await h.startSession.execute({ member: AC, dates: [MON, TUE] }));
    const ranked = (await h.suggestRecipes.execute({ sessionId: second.id })).map((r) => r.name);
    return ranked.indexOf("Nudeln") < ranked.indexOf("Reis");
  };

  it("does not hold the base of a plan thrown away without being finalized against a dish", async () => {
    expect(await rankedAfter(false)).toBe(true);
  });

  it("holds the base of a plan finalized before it was closed against a dish", async () => {
    expect(await rankedAfter(true)).toBe(false);
  });
});
