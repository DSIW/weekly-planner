import { describe, expect, it } from "vitest";
import { acceptProposal, markLeftoverDay, movePlannedDay, reopenDay } from "../../src/index.js";
import { AC, ME, MON, TUE, WED, aRecipe, aSession, config, must, plan, withProposal } from "../support/builders.js";

// Gaps found while implementing M1: the invariants OneDinnerPerDay and NoRecipeTwiceInSession were
// reachable through MovePlannedDay and AcceptProposal. The spec now carries the missing preconditions.
describe("rule MovePlannedDay across sessions", () => {
  it("is rejected when another session planned a dinner on the target date (one dinner per day)", () => {
    const s = plan(aSession([MON, TUE]), MON, aRecipe());
    expect(movePlannedDay(s, { member: AC, from: MON, to: TUE, dateTakenElsewhere: true }, config)).toEqual({ ok: false, reason: "date_already_taken" });
    expect(movePlannedDay(s, { member: AC, from: MON, to: TUE, dateTakenElsewhere: false }, config).ok).toBe(true);
  });
});

describe("rule AcceptProposal with an older pending proposal", () => {
  it("is rejected when the same recipe was planned on another day meanwhile", () => {
    const r = aRecipe();
    const first = withProposal(aSession(), MON, r, AC); // MON: pending
    const left = must(markLeftoverDay(first.session, { member: AC, date: MON })).state;
    const second = withProposal(left, TUE, r, AC); // TUE: pending, same recipe
    const planned = must(acceptProposal(second.session, { member: ME, proposalId: second.id, dateTakenElsewhere: false })).state;
    const reopened = must(reopenDay(planned, { member: AC, date: MON })).state;
    expect(acceptProposal(reopened, { member: ME, proposalId: first.id, dateTakenElsewhere: false })).toEqual({ ok: false, reason: "recipe_already_planned" });
  });
});
