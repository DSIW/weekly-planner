import { describe, expect, it } from "vitest";
import {
  closeSession,
  eligibleRecipes,
  invariantViolations,
  isNewRecipe,
  needsPlanningAhead,
  suggestRecipes,
  vetoProposal,
  markLeftoverDay,
  movePlannedDay,
  reopenDay,
  proposalId,
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

// Added with slice S3: a day never changes under a vote, so a session holds at most one pending proposal. This
// also makes the older "same recipe planned elsewhere while a proposal waits" scenario unreachable.
describe("day operations while a proposal is pending", () => {
  const voting = () => withProposal(plan(aSession([MON, TUE, SAT]), MON, aRecipe()), TUE, aRecipe(), AC);
  const pendingRejection = { ok: false, reason: "proposal_already_pending" };

  it("MarkLeftoverDay refuses the day that holds the proposal, but not another open day", () => {
    const { session } = voting();
    expect(markLeftoverDay(session, { member: ME, date: TUE })).toEqual(pendingRejection);
    expect(markLeftoverDay(session, { member: ME, date: SAT }).ok).toBe(true);
  });

  it("ReopenDay refuses planned and leftover days alike", () => {
    const { session } = voting();
    expect(reopenDay(session, { member: ME, date: MON })).toEqual(pendingRejection);
    const left = must(markLeftoverDay(session, { member: ME, date: SAT })).state;
    expect(reopenDay(left, { member: ME, date: SAT })).toEqual(pendingRejection);
  });

  it("MovePlannedDay refuses to vacate a day while a proposal waits", () => {
    const { session } = voting();
    expect(movePlannedDay(session, { member: ME, from: MON, to: SAT }, config)).toEqual(pendingRejection);
  });

  it("all of them work once the proposal is decided", () => {
    const { session, id } = voting();
    const decided = must(vetoProposal(session, { member: ME, proposalId: id })).state;
    expect(reopenDay(decided, { member: ME, date: MON }).ok).toBe(true);
    expect(movePlannedDay(decided, { member: ME, from: MON, to: SAT }, config).ok).toBe(true);
    expect(markLeftoverDay(decided, { member: ME, date: TUE }).ok).toBe(true);
  });

  it("invariantViolations reports a second pending proposal", () => {
    const { session } = voting();
    const pending = session.proposals.find((p) => p.status === "pending");
    if (!pending) throw new Error("setup failed: no pending proposal");
    const second = {
      ...session,
      proposals: [...session.proposals, { ...pending, id: proposalId("extra"), date: SAT }],
    };
    expect(invariantViolations([second]).some((v) => v.startsWith("OnePendingProposalPerSession"))).toBe(true);
    expect(invariantViolations([session])).toEqual([]);
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

// Added with slice S2b: the tie-break is asked per recipe, so an application can keep the deck stable.
describe("suggestRecipes tie-break", () => {
  it("asks for one value per recipe, and equal rank follows those values", () => {
    const a = aRecipe({ name: "a" });
    const b = aRecipe({ name: "b" });
    const asked: string[] = [];
    const input = (values: Record<string, number>) => ({
      session: aSession([MON, TUE]),
      candidates: [a, b],
      history: [],
      recentlyPlanned: new Set<Recipe["id"]>(),
      experienced: new Set<Recipe["id"]>(),
      config,
      random: (r: Recipe) => {
        asked.push(r.name);
        return values[r.name] ?? 0;
      },
    });
    expect(suggestRecipes(input({ a: 0.9, b: 0.1 })).map((r) => r.name)).toEqual(["b", "a"]);
    expect(suggestRecipes(input({ a: 0.1, b: 0.9 })).map((r) => r.name)).toEqual(["a", "b"]);
    expect([...new Set(asked)].sort()).toEqual(["a", "b"]);
  });
});

describe("isNewRecipe", () => {
  it("is a recipe that is not tagged proven and has no confirmed cooking", () => {
    const fresh = aRecipe({ isProven: false });
    expect(isNewRecipe(fresh, new Set())).toBe(true);
    expect(isNewRecipe(fresh, new Set([fresh.id]))).toBe(false);
    expect(isNewRecipe(aRecipe({ isProven: true }), new Set())).toBe(false);
  });
});
