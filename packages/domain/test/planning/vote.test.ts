import { describe, expect, it } from "vitest";
import { acceptProposal, closeSession, finalizePlan, vetoProposal, proposalId } from "../../src/index.js";
import { AC, ME, MON, TUE, aRecipe, aSession, dayOf, must, plan, withProposal } from "../support/builders.js";

describe("rule AcceptProposal", () => {
  it("succeeds: the other member plans the day with the proposed recipe", () => {
    const recipe = aRecipe();
    const { session, id } = withProposal(aSession(), MON, recipe, AC);
    const { state, events } = must(acceptProposal(session, { member: ME, proposalId: id, dateTakenElsewhere: false }));
    expect(state.proposals[0]).toMatchObject({ status: "accepted", decidedBy: ME });
    expect(dayOf(state, MON)).toMatchObject({ status: "planned", recipe: { id: recipe.id } });
    expect(events[0]).toMatchObject({ type: "ProposalAccepted", date: MON, recipeId: recipe.id, decidedBy: ME });
  });

  it("is rejected for an unknown proposal", () => {
    expect(acceptProposal(aSession(), { member: ME, proposalId: proposalId("nope"), dateTakenElsewhere: false })).toEqual({ ok: false, reason: "unknown_proposal" });
  });

  it("is rejected when the proposal is no longer pending", () => {
    const { session, id } = withProposal(aSession(), MON, aRecipe(), AC);
    const accepted = must(acceptProposal(session, { member: ME, proposalId: id, dateTakenElsewhere: false })).state;
    expect(acceptProposal(accepted, { member: ME, proposalId: id, dateTakenElsewhere: false })).toEqual({ ok: false, reason: "proposal_not_pending" });
  });

  it("is rejected when the session is not open", () => {
    const { session, id } = withProposal(aSession(), MON, aRecipe(), AC);
    const closed = must(closeSession(session, { member: AC })).state;
    expect(acceptProposal(closed, { member: ME, proposalId: id, dateTakenElsewhere: false })).toEqual({ ok: false, reason: "session_not_open" });
  });

  it("is rejected when the proposer tries to decide on their own proposal", () => {
    const { session, id } = withProposal(aSession(), MON, aRecipe(), AC);
    expect(acceptProposal(session, { member: AC, proposalId: id, dateTakenElsewhere: false })).toEqual({ ok: false, reason: "own_proposal" });
  });

  it("is rejected when another session already planned a dinner on that date (one dinner per day)", () => {
    const { session, id } = withProposal(aSession(), MON, aRecipe(), AC);
    expect(acceptProposal(session, { member: ME, proposalId: id, dateTakenElsewhere: true })).toEqual({ ok: false, reason: "date_already_taken" });
  });

  it("sets decided_by (state-dependent field present once decided)", () => {
    const { session, id } = withProposal(aSession(), MON, aRecipe(), AC);
    expect(session.proposals[0]).not.toHaveProperty("decidedBy");
    const decided = must(acceptProposal(session, { member: ME, proposalId: id, dateTakenElsewhere: false })).state;
    expect(decided.proposals[0]?.decidedBy).toBe(ME);
  });
});

describe("rule VetoProposal", () => {
  it("succeeds: the proposal is vetoed, the day stays open, decided_by is set", () => {
    const { session, id } = withProposal(aSession(), MON, aRecipe(), AC);
    const { state, events } = must(vetoProposal(session, { member: ME, proposalId: id }));
    expect(state.proposals[0]).toMatchObject({ status: "vetoed", decidedBy: ME });
    expect(dayOf(state, MON).status).toBe("open");
    expect(events[0]).toMatchObject({ type: "ProposalVetoed", date: MON, decidedBy: ME });
  });

  it("is rejected when the proposal is not pending", () => {
    const { session, id } = withProposal(aSession(), MON, aRecipe(), AC);
    const vetoed = must(vetoProposal(session, { member: ME, proposalId: id })).state;
    expect(vetoProposal(vetoed, { member: ME, proposalId: id })).toEqual({ ok: false, reason: "proposal_not_pending" });
    expect(vetoProposal(session, { member: ME, proposalId: proposalId("nope") })).toEqual({ ok: false, reason: "unknown_proposal" });
  });

  it("is rejected for the proposer's own proposal", () => {
    const { session, id } = withProposal(aSession(), MON, aRecipe(), AC);
    expect(vetoProposal(session, { member: AC, proposalId: id })).toEqual({ ok: false, reason: "own_proposal" });
  });

  it("allows the next proposal for the same day after a veto", () => {
    const { session, id } = withProposal(aSession(), MON, aRecipe(), AC);
    const vetoed = must(vetoProposal(session, { member: ME, proposalId: id })).state;
    expect(withProposal(vetoed, MON, aRecipe(), ME).session.proposals).toHaveLength(2);
  });
});

describe("a plan of three agreed dinners", () => {
  it("fills the days in date order, one deck for the whole plan", () => {
    let s = aSession();
    s = plan(s, MON, aRecipe());
    s = plan(s, TUE, aRecipe());
    expect(s.days.map((d) => d.status)).toEqual(["planned", "planned", "open"]);
    expect(finalizePlan(s, { member: AC }).ok).toBe(true);
  });
});
