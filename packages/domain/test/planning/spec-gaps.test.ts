import { describe, expect, it } from "vitest";
import {
  beginStep,
  closeSession,
  completeStep,
  consolidateIngredients,
  eligibleRecipes,
  finalizePlan,
  exportComplete,
  failStep,
  newExport,
  nextStep,
  retriableAfterRefusal,
  scaleDescription,
  type Ingredient,
  type FinalizeExport,
  invariantViolations,
  isNewRecipe,
  leaveOut,
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

  it("FinalizePlan is refused too", () => {
    const { session } = voting();
    expect(finalizePlan(session, { member: ME })).toEqual(pendingRejection);
  });

  it("all of them work once the proposal is decided", () => {
    const { session, id } = voting();
    const decided = must(vetoProposal(session, { member: ME, proposalId: id })).state;
    expect(reopenDay(decided, { member: ME, date: MON }).ok).toBe(true);
    expect(movePlannedDay(decided, { member: ME, from: MON, to: SAT }, config).ok).toBe(true);
    expect(markLeftoverDay(decided, { member: ME, date: TUE }).ok).toBe(true);
    expect(finalizePlan(decided, { member: ME }).ok).toBe(true);
  });

  it("a discarded session no longer holds its dates (OneDinnerPerDay)", () => {
    const first = plan(aSession([MON, TUE]), MON, aRecipe());
    const other = { ...plan(aSession([MON, TUE]), MON, aRecipe()), id: sessionId("other") };
    expect(invariantViolations([first, other]).some((v) => v.startsWith("OneDinnerPerDay"))).toBe(true);
    const closed = must(closeSession(first, { member: AC })).state;
    expect(invariantViolations([closed, other])).toEqual([]);
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

// S4a: finalizing writes to KitchenOwl. Amounts are scaled and consolidated here, and the export is a small state
// machine that never sends a step twice on its own (spec: ExportStep, decision D23).
describe("scaleDescription", () => {
  const table: [string, number, string, boolean][] = [
    ["30 g", 1, "30 g", false],
    ["30 g", 2, "60 g", false],
    ["0.5 TL", 2, "1 TL", false],
    ["0,5 TL", 1, "0.5 TL", false],
    ["2 Zehe", 1, "2 Zehe", false],
    ["1/2 TL", 2, "1 TL", false],
    ["1/2 TL", 1, "0.5 TL", false],
    ["1 1/2 EL", 2, "3 EL", false],
    ["½ TL", 2, "1 TL", false],
    ["400 g, geschält", 1, "400 g", false],
    ["400 g, geschält", 0.5, "200 g", false],
    ["200g", 1, "200 g", false],
    ["1 (800 g) Dose", 1, "1", true],
    ["3", 2, "6", false],
    ["1 EL; gehackt", 1, "1 EL", false],
    ["1/3 Bund", 1, "0.33 Bund", false],
    ["250 ml", 1.5, "375 ml", false],
    ["", 2, "", false],
    ["  ", 2, "", false],
    ["2-3 Stück", 1, "2-3 Stück", true],
    ["etwas", 1, "etwas", true],
    ["nach Geschmack", 1, "nach Geschmack", true],
    ["ca. 200 g", 1, "ca. 200 g", true],
    ["2 große Zwiebeln", 1, "2 große Zwiebeln", true],
    ["0 g", 1, "0 g", true],
  ];
  it.each(table)("%j x %s -> %j (review: %s)", (input, factor, text, needsReview) => {
    expect(scaleDescription(input, factor)).toMatchObject({ text, needsReview });
  });

  it("flags an amount when the factor is unusable instead of guessing", () => {
    expect(scaleDescription("2 EL", 0)).toMatchObject({ text: "2 EL", needsReview: true });
    expect(scaleDescription("2 EL", Number.NaN)).toMatchObject({ needsReview: true });
  });
});

describe("consolidateIngredients", () => {
  const ing = (name: string, description: string, over: Partial<Ingredient> = {}): Ingredient => ({
    name,
    description,
    optional: false,
    ...over,
  });
  const recipe = (recipeName: string, yields: number, ...ingredients: Ingredient[]) => ({
    recipeName,
    yields,
    ingredients,
  });
  const one = (items: ReturnType<typeof consolidateIngredients>, name: string) => {
    const item = items.find((i) => i.name === name);
    if (!item) throw new Error(`no ${name}`);
    return item;
  };

  it("keeps the category of an ingredient on its line, the first one named", () => {
    const items = consolidateIngredients(
      [
        recipe("A", 2, ing("Butter", "30 g"), ing("Salz", "1 TL", { category: "Gewürze" })),
        recipe("B", 2, ing("Butter", "20 g", { category: "🧈 Aufstriche" }), ing("Salz", "", { category: "Anderes" })),
      ],
      2,
    );
    expect(one(items, "Butter").category).toBe("🧈 Aufstriche");
    expect(one(items, "Salz").category).toBe("Gewürze");
    expect("category" in one(consolidateIngredients([recipe("A", 2, ing("Mehl", "1 kg"))], 2), "Mehl")).toBe(false);
  });

  it("leaves out what is in stock, by name and whatever the case, and ignores names that are not on the list", () => {
    const items = consolidateIngredients(
      [recipe("A", 2, ing("Butter", "30 g"), ing("Salz", ""), ing("Mehl", "200 g"))],
      2,
    );
    expect(leaveOut(items, [" butter ", "SALZ", "Pfeffer"]).map((i) => i.name)).toEqual(["Mehl"]);
    expect(leaveOut(items, [])).toEqual(items);
  });

  it("scales each recipe to the household and adds the same unit up", () => {
    const items = consolidateIngredients(
      [recipe("A", 4, ing("Zwiebel", "2 Stück")), recipe("B", 2, ing("Zwiebel", "1 Stück"))],
      2,
    );
    expect(items).toEqual([{ name: "Zwiebel", description: "2 Stück", needsReview: false, recipes: ["A", "B"] }]);
  });

  it("normalises grams and kilograms, millilitres and litres like KitchenOwl", () => {
    const items = consolidateIngredients(
      [
        recipe("A", 2, ing("Mehl", "800 g"), ing("Milch", "500 ml")),
        recipe("B", 2, ing("Mehl", "0.5 kg"), ing("Milch", "0.5 l")),
      ],
      2,
    );
    expect(one(items, "Mehl").description).toBe("1.3 kg");
    expect(one(items, "Milch").description).toBe("1 l");
    expect(
      consolidateIngredients([recipe("A", 2, ing("Salz", "200 g"), ing("Pfeffer", "30 mg"))], 2)[1]?.description,
    ).toBe("0.03 g");
  });

  it("adds mass and volume units up whatever their letter case", () => {
    const items = consolidateIngredients(
      [
        recipe("A", 2, ing("Milch", "1 L"), ing("Mehl", "1 KG")),
        recipe("B", 2, ing("Milch", "500 ml"), ing("Mehl", "500 g")),
      ],
      2,
    );
    expect(one(items, "Milch").description).toBe("1.5 l");
    expect(one(items, "Mehl").description).toBe("1.5 kg");
  });

  it("keeps different units side by side and adds identical unit text only", () => {
    const items = consolidateIngredients(
      [recipe("A", 2, ing("Öl", "2 EL")), recipe("B", 2, ing("Öl", "5 g")), recipe("C", 2, ing("Öl", "1 EL"))],
      2,
    );
    expect(one(items, "Öl").description).toBe("3 EL, 5 g");
    const split = consolidateIngredients([recipe("A", 2, ing("Öl", "2 EL")), recipe("B", 2, ing("Öl", "1 el"))], 2);
    expect(one(split, "Öl").description).toBe("2 EL, 1 el");
  });

  it("matches names ignoring case and space, and keeps the first spelling and id", () => {
    const items = consolidateIngredients(
      [recipe("A", 2, ing("Zwiebel", "1", { id: 7 })), recipe("B", 2, ing(" zwiebel ", "2", { id: 9 }))],
      2,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 7, name: "Zwiebel", description: "3" });
  });

  it("flags what it cannot read, keeps the original text and adds up the rest", () => {
    const items = consolidateIngredients(
      [recipe("A", 2, ing("Salz", "etwas"), ing("Butter", "50 g")), recipe("B", 2, ing("Butter", "nach Geschmack"))],
      2,
    );
    expect(one(items, "Salz")).toMatchObject({ description: "etwas", needsReview: true });
    expect(one(items, "Butter")).toMatchObject({ description: "50 g, nach Geschmack", needsReview: true });
  });

  it("sends no description for an ingredient without an amount, and skips optional ones", () => {
    const items = consolidateIngredients(
      [recipe("A", 2, ing("Pfeffer", ""), ing("Petersilie", "1 Bund", { optional: true }))],
      2,
    );
    expect(items).toEqual([{ name: "Pfeffer", description: "", needsReview: false, recipes: ["A"] }]);
  });

  it("is empty without recipes", () => {
    expect(consolidateIngredients([], 2)).toEqual([]);
  });
});

describe("the export of a finalized plan", () => {
  const dinners = [MON, TUE].map((date, i) => ({
    date,
    recipeId: aRecipe().id,
    recipeName: `R${i}`,
    recipeYields: 2,
    portions: 2,
  }));
  const fresh = () =>
    newExport(sessionId("s1"), dinners, [{ name: "Reis", description: "1 kg", needsReview: false, recipes: [] }]);
  const step = (e: FinalizeExport, s: Parameters<typeof beginStep>[1]): FinalizeExport => {
    const begun = must(beginStep(e, s, { resendUnconfirmed: false })).state;
    return must(completeStep(begun, s)).state;
  };

  it("starts with every step pending, planner entries by date first and the list last", () => {
    const e = fresh();
    expect(e.days.map((d) => d.status)).toEqual(["pending", "pending"]);
    expect(nextStep(e)).toEqual({ kind: "planner", date: MON });
    const afterDays = step(step(e, { kind: "planner", date: MON }), { kind: "planner", date: TUE });
    expect(nextStep(afterDays)).toEqual({ kind: "list" });
    expect(exportComplete(afterDays)).toBe(false);
    const all = step(afterDays, { kind: "list" });
    expect(exportComplete(all)).toBe(true);
    expect(nextStep(all)).toBeNull();
  });

  it("records a step as sending when it begins and never begins a done step", () => {
    const begun = must(beginStep(fresh(), { kind: "list" }, { resendUnconfirmed: false })).state;
    expect(begun.list.status).toBe("sending");
    const done = must(completeStep(begun, { kind: "list" })).state;
    expect(beginStep(done, { kind: "list" }, { resendUnconfirmed: true })).toEqual({
      ok: false,
      reason: "step_already_done",
    });
    expect(beginStep(fresh(), { kind: "planner", date: SAT }, { resendUnconfirmed: false })).toEqual({
      ok: false,
      reason: "unknown_step",
    });
  });

  it("goes back to pending when KitchenOwl refused, so a retry sends it again", () => {
    const begun = must(beginStep(fresh(), { kind: "planner", date: MON }, { resendUnconfirmed: false })).state;
    const failed = must(failStep(begun, { kind: "planner", date: MON }, "refused"));
    expect(failed.state.days[0]?.status).toBe("pending");
    expect(failed.state.failure).toBe("refused");
    expect(failed.events).toEqual([
      { type: "ExportProgressed", sessionId: sessionId("s1"), complete: false, failure: "refused" },
    ]);
    expect(beginStep(failed.state, { kind: "planner", date: MON }, { resendUnconfirmed: false }).ok).toBe(true);
  });

  it("is retried by itself only after a refusal, and only when the next step is waiting rather than sent", () => {
    const first = { kind: "planner", date: MON } as const;
    const begun = must(beginStep(fresh(), first, { resendUnconfirmed: false })).state;
    const refused = must(failStep(begun, first, "refused")).state;
    expect(retriableAfterRefusal(fresh())).toBe(false); // nothing failed yet
    expect(retriableAfterRefusal(refused)).toBe(true);
    // A crash after the failed step was begun again leaves it sending while the old failure still says refused.
    const crashed = must(beginStep(refused, first, { resendUnconfirmed: false })).state;
    expect(crashed.failure).toBe("refused");
    expect(retriableAfterRefusal(crashed)).toBe(false);
    const listBegun = must(beginStep(fresh(), { kind: "list" }, { resendUnconfirmed: false })).state;
    expect(retriableAfterRefusal(must(failStep(listBegun, { kind: "list" }, "unconfirmed")).state)).toBe(false);
    const finished = step(step(step(fresh(), first), { kind: "planner", date: TUE }), { kind: "list" });
    expect(retriableAfterRefusal({ ...finished, failure: "refused" })).toBe(false); // nothing left to send
  });

  it("keeps a step sending without an answer and sends it again only when a member says so", () => {
    const begun = must(beginStep(fresh(), { kind: "list" }, { resendUnconfirmed: false })).state;
    const unsure = must(failStep(begun, { kind: "list" }, "unconfirmed")).state;
    expect(unsure.list.status).toBe("sending");
    expect(unsure.failure).toBe("unconfirmed");
    expect(beginStep(unsure, { kind: "list" }, { resendUnconfirmed: false })).toEqual({
      ok: false,
      reason: "step_unconfirmed",
    });
    expect(beginStep(unsure, { kind: "list" }, { resendUnconfirmed: true }).ok).toBe(true);
  });

  it("clears the failure when the next step succeeds and announces completion", () => {
    const e = { ...fresh(), failure: "refused" as const };
    const begun = must(beginStep(e, { kind: "planner", date: MON }, { resendUnconfirmed: false })).state;
    expect(must(completeStep(begun, { kind: "planner", date: MON })).state.failure).toBeNull();
    const last = step(step(step(fresh(), { kind: "planner", date: MON }), { kind: "planner", date: TUE }), {
      kind: "list",
    });
    const again = must(
      beginStep({ ...last, list: { ...last.list, status: "pending" } }, { kind: "list" }, { resendUnconfirmed: false }),
    ).state;
    expect(must(completeStep(again, { kind: "list" })).events).toEqual([
      { type: "ExportProgressed", sessionId: sessionId("s1"), complete: true, failure: null },
    ]);
  });

  it("only completes or fails a step that is sending", () => {
    expect(completeStep(fresh(), { kind: "list" })).toEqual({ ok: false, reason: "step_not_sending" });
    expect(failStep(fresh(), { kind: "list" }, "refused")).toEqual({ ok: false, reason: "step_not_sending" });
  });
});
