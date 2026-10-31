import { describe, expect, it } from "vitest";
import {
  acceptProposal, closeSession, finalizePlan, markLeftoverDay, movePlannedDay, proposeRecipe, reopenDay, vetoProposal,
  type PlanningSession,
} from "../../src/index.js";
import { AC, ME, MON, TUE, WED, aRecipe, aSession, config, dayOf, must, newProposalId, plan, withProposal } from "../support/builders.js";

/** The declared transition graphs of the spec, walked through their witnessing rules. */
describe("PlanningSession.status transitions", () => {
  const withPlan = () => plan(aSession(), MON, aRecipe());
  it("open -> finalized (FinalizePlan)", () => expect(must(finalizePlan(withPlan(), { member: AC }, config)).state.status).toBe("finalized"));
  it("open -> closed (AbandonSession)", () => expect(must(closeSession(aSession(), { member: AC })).state.status).toBe("closed"));
  it("finalized -> closed (CloseFinalizedSession)", () => {
    const f = must(finalizePlan(withPlan(), { member: AC }, config)).state;
    expect(must(closeSession(f, { member: AC })).state.status).toBe("closed");
  });
  it("rejects undeclared transitions: a closed session cannot be finalized, reopened or changed", () => {
    const closed = must(closeSession(withPlan(), { member: AC })).state;
    expect(finalizePlan(closed, { member: AC }, config).ok).toBe(false);
    expect(closeSession(closed, { member: AC }).ok).toBe(false);
    expect(reopenDay(closed, { member: AC, date: MON }).ok).toBe(false);
    expect(markLeftoverDay(closed, { member: AC, date: TUE }).ok).toBe(false);
  });
  it("rejects finalized -> open: a finalized session cannot take new proposals", () => {
    const f = must(finalizePlan(withPlan(), { member: AC }, config)).state;
    expect(proposeRecipe(f, { proposalId: newProposalId(), member: AC, date: TUE, recipe: aRecipe() }, config)).toEqual({ ok: false, reason: "session_not_open" });
  });
  it("closed is terminal: no rule leaves it", () => {
    const closed = must(closeSession(aSession(), { member: AC })).state;
    for (const r of [finalizePlan(closed, { member: AC }, config), closeSession(closed, { member: AC })]) expect(r.ok).toBe(false);
  });
});

describe("PlanDay.status transitions", () => {
  it("open -> planned (AcceptProposal)", () => expect(dayOf(plan(aSession(), MON, aRecipe()), MON).status).toBe("planned"));
  it("open -> leftovers (MarkLeftoverDay)", () => expect(dayOf(must(markLeftoverDay(aSession(), { member: AC, date: MON })).state, MON).status).toBe("leftovers"));
  it("planned -> open (ReopenPlannedDay)", () => expect(dayOf(must(reopenDay(plan(aSession(), MON, aRecipe()), { member: AC, date: MON })).state, MON).status).toBe("open"));
  it("leftovers -> open (ReopenLeftoverDay)", () => {
    const s = must(markLeftoverDay(aSession(), { member: AC, date: MON })).state;
    expect(dayOf(must(reopenDay(s, { member: AC, date: MON })).state, MON).status).toBe("open");
  });
  it("rejects undeclared transitions: planned -> leftovers and leftovers -> planned", () => {
    expect(markLeftoverDay(plan(aSession(), MON, aRecipe()), { member: AC, date: MON }).ok).toBe(false);
    const s = must(markLeftoverDay(aSession(), { member: AC, date: MON })).state;
    expect(proposeRecipe(s, { proposalId: newProposalId(), member: AC, date: MON, recipe: aRecipe() }, config).ok).toBe(false);
  });
  it("recipe is present exactly while the day is planned (state-dependent field)", () => {
    const open = aSession();
    const planned = plan(open, MON, aRecipe());
    const reopened = must(reopenDay(planned, { member: AC, date: MON })).state;
    expect(dayOf(open, MON)).not.toHaveProperty("recipe");
    expect(dayOf(planned, MON).recipe).toBeDefined();
    expect(dayOf(reopened, MON)).not.toHaveProperty("recipe");
    const moved = must(movePlannedDay(planned, { member: AC, from: MON, to: WED }, config)).state;
    expect(dayOf(moved, MON)).not.toHaveProperty("recipe");
    expect(dayOf(moved, WED).recipe).toBeDefined();
  });
});

describe("Proposal.status transitions", () => {
  it("pending -> accepted and pending -> vetoed set decided_by; accepted and vetoed are terminal", () => {
    const a = withProposal(aSession(), MON, aRecipe(), AC);
    const accepted = must(acceptProposal(a.session, { member: ME, proposalId: a.id, dateTakenElsewhere: false })).state;
    const vetoed = must(vetoProposal(a.session, { member: ME, proposalId: a.id })).state;
    expect(accepted.proposals[0]).toMatchObject({ status: "accepted", decidedBy: ME });
    expect(vetoed.proposals[0]).toMatchObject({ status: "vetoed", decidedBy: ME });
    for (const s of [accepted, vetoed] as PlanningSession[]) {
      expect(acceptProposal(s, { member: ME, proposalId: a.id, dateTakenElsewhere: false }).ok).toBe(false);
      expect(vetoProposal(s, { member: ME, proposalId: a.id }).ok).toBe(false);
    }
  });
  it("a pending proposal has no decided_by", () => {
    expect(withProposal(aSession(), MON, aRecipe()).session.proposals[0]).not.toHaveProperty("decidedBy");
  });
});
