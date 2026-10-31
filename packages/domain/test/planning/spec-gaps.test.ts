import { describe, expect, it } from "vitest";
import {
  acceptProposal,
  closeSession,
  eligibleRecipes,
  needsPlanningAhead,
  suggestRecipes,
  vetoProposal,
  markLeftoverDay,
  movePlannedDay,
  reopenDay,
  sessionId,
  startSession,
  type Recipe,
} from "../../src/index.js";
import {
  AC,
  ME,
  MON,
  SAT,
  SUN,
  TUE,
  aRecipe,
  aSession,
  config,
  must,
  plan,
  withProposal,
} from "../support/builders.js";

// Gaps found while implementing M1: the invariants OneDinnerPerDay and NoRecipeTwiceInSession were
// reachable through MovePlannedDay and AcceptProposal. The spec now carries the missing preconditions.
describe("rule MovePlannedDay across sessions", () => {
  it("is rejected when another session planned a dinner on the target date (one dinner per day)", () => {
    const s = plan(aSession([MON, TUE]), MON, aRecipe());
    expect(movePlannedDay(s, { member: AC, from: MON, to: TUE, dateTakenElsewhere: true }, config)).toEqual({
      ok: false,
      reason: "date_already_taken",
    });
    expect(movePlannedDay(s, { member: AC, from: MON, to: TUE, dateTakenElsewhere: false }, config).ok).toBe(true);
  });
});

describe("rule AcceptProposal with an older pending proposal", () => {
  it("is rejected when the same recipe was planned on another day meanwhile", () => {
    const r = aRecipe();
    const first = withProposal(aSession(), MON, r, AC); // MON: pending
    const left = must(markLeftoverDay(first.session, { member: AC, date: MON })).state;
    const second = withProposal(left, TUE, r, AC); // TUE: pending, same recipe
    const planned = must(
      acceptProposal(second.session, { member: ME, proposalId: second.id, dateTakenElsewhere: false }),
    ).state;
    const reopened = must(reopenDay(planned, { member: AC, date: MON })).state;
    expect(acceptProposal(reopened, { member: ME, proposalId: first.id, dateTakenElsewhere: false })).toEqual({
      ok: false,
      reason: "recipe_already_planned",
    });
  });
});

// Added with slice S1b: both phones show one session, so a second may only start after the first ended.
describe("rule StartSession while another session is open", () => {
  const cmd = { id: sessionId("s2"), startedBy: ME, dates: [MON, TUE], now: 0 };
  it("is rejected", () => {
    expect(startSession({ ...cmd, openSessionExists: true }, config)).toEqual({
      ok: false,
      reason: "session_already_open",
    });
  });
  it("is allowed when no session is open", () => {
    expect(startSession({ ...cmd, openSessionExists: false }, config).ok).toBe(true);
    expect(startSession(cmd, config).ok).toBe(true);
  });
});

// Added with slice S2a: a proposal left behind by a session that ended cannot be decided any more.
describe("rule VetoProposal on a session that is no longer open", () => {
  it("is rejected once the session was closed", () => {
    const { session, id } = withProposal(aSession(), MON, aRecipe(), AC);
    const closed = must(closeSession(session, { member: AC })).state;
    expect(vetoProposal(closed, { member: ME, proposalId: id })).toEqual({ ok: false, reason: "session_not_open" });
    expect(vetoProposal(session, { member: ME, proposalId: id }).ok).toBe(true);
  });
});

describe("eligibleRecipes (the hard rules of the next open day, without ranking)", () => {
  const dessert = aRecipe({ mealType: "dessert" });
  const slow = aRecipe({ totalTimeMinutes: 90 });
  const quick = aRecipe({ totalTimeMinutes: 20 });
  const unknownTime = aRecipe({ totalTimeMinutes: null });
  const all = [dessert, slow, quick, unknownTime];

  it("offers only main dishes, and on a weekday only those within the limit or without a known time", () => {
    const s = aSession([MON, TUE]); // Monday
    expect(eligibleRecipes(s, all, config).map((r) => r.id)).toEqual([quick.id, unknownTime.id]);
  });

  it("offers long recipes on a weekend", () => {
    const s = aSession([SAT, SUN]);
    expect(eligibleRecipes(s, all, config).map((r) => r.id)).toEqual([slow.id, quick.id, unknownTime.id]);
  });

  it("leaves out dishes vetoed, passed or planned in this session", () => {
    const vetoed = withProposal(aSession([MON, TUE]), MON, quick, AC);
    const afterVeto = must(vetoProposal(vetoed.session, { member: ME, proposalId: vetoed.id })).state;
    expect(eligibleRecipes(afterVeto, all, config).map((r) => r.id)).toEqual([unknownTime.id]);
  });

  it("offers nothing once the session is not open", () => {
    const s = aSession([MON, TUE]);
    expect(eligibleRecipes(must(closeSession(s, { member: AC })).state, all, config)).toEqual([]);
  });

  it("offers nothing once every day is planned", () => {
    const s = plan(plan(aSession([MON, TUE]), MON, quick), TUE, unknownTime);
    expect(eligibleRecipes(s, all, config)).toEqual([]);
  });
});

// Added after the first real use of S2a: a recipe with a 21-hour total time (dough resting) is eligible on a
// weekend but must not lead the deck. Recipes above config.plan_ahead_time are flagged and come last.
describe("recipes that need planning ahead (config.plan_ahead_time)", () => {
  const atLimit = aRecipe({ totalTimeMinutes: config.planAheadMinutes });
  const justOver = aRecipe({ totalTimeMinutes: config.planAheadMinutes + 1 });
  const unknown = aRecipe({ totalTimeMinutes: null });

  it("flags only recipes whose known time exceeds the limit", () => {
    expect(needsPlanningAhead(atLimit, config)).toBe(false);
    expect(needsPlanningAhead(justOver, config)).toBe(true);
    expect(needsPlanningAhead(unknown, config)).toBe(false);
  });

  it("stay eligible on a weekend", () => {
    expect(eligibleRecipes(aSession([SAT, SUN]), [justOver], config)).toEqual([justOver]);
  });

  it("come last in the deck even when every other preference would put them first", () => {
    const longButNewAndWanted = aRecipe({ name: "Biga", totalTimeMinutes: 1285, isProven: false, wantsToTry: true });
    const plain = aRecipe({ name: "plain", totalTimeMinutes: 30, diet: "meat" });
    const input = {
      session: aSession([SAT, SUN]),
      candidates: [longButNewAndWanted, plain],
      history: [],
      recentlyPlanned: new Set<Recipe["id"]>([plain.id]), // recently planned ranks plain lower, still above Biga
      experienced: new Set<Recipe["id"]>(),
      config,
      random: () => 0.5,
    };
    expect(suggestRecipes(input).map((r) => r.name)).toEqual(["plain", "Biga"]);
  });
});
