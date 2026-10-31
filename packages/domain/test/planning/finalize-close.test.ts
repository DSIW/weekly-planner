import { describe, expect, it } from "vitest";
import { closeSession, finalizePlan, localDateTime, remindToFinalize, reminderDueAt } from "../../src/index.js";
import { AC, ME, MON, TUE, WED, aRecipe, aSession, config, must, plan } from "../support/builders.js";

describe("rule FinalizePlan", () => {
  it("succeeds: the session is finalized and announces the ingredients of every agreed day for two portions", () => {
    const a = aRecipe({ name: "A" });
    const b = aRecipe({ name: "B", yields: 4 });
    const s = plan(plan(aSession(), MON, a), TUE, b);
    const { state, events } = must(finalizePlan(s, { member: ME }, config));
    expect(state.status).toBe("finalized");
    expect(events).toEqual([
      {
        type: "PlanFinalized",
        sessionId: s.id,
        dinners: [
          { date: MON, recipeId: a.id, recipeName: "A", recipeYields: 2, portions: 2 },
          { date: TUE, recipeId: b.id, recipeName: "B", recipeYields: 4, portions: 2 },
        ],
      },
    ]);
  });

  it("is rejected when the session is not open", () => {
    const s = plan(aSession(), MON, aRecipe());
    const finalized = must(finalizePlan(s, { member: AC }, config)).state;
    expect(finalizePlan(finalized, { member: AC }, config)).toEqual({ ok: false, reason: "session_not_open" });
  });

  it("is rejected when no day is agreed (leftover days do not count)", () => {
    expect(finalizePlan(aSession(), { member: AC }, config)).toEqual({ ok: false, reason: "nothing_planned" });
  });

  it("locks the plan: nothing is proposed or changed afterwards", () => {
    const s = plan(aSession(), MON, aRecipe());
    const finalized = must(finalizePlan(s, { member: AC }, config)).state;
    expect(finalized.days[0]?.status).toBe("planned");
  });
});

describe("rules AbandonSession and CloseFinalizedSession", () => {
  it("closes an open session", () => {
    const { state, events } = must(closeSession(aSession(), { member: AC }));
    expect(state.status).toBe("closed");
    expect(events[0]).toMatchObject({ type: "SessionClosed" });
  });
  it("closes a finalized session", () => {
    const finalized = must(finalizePlan(plan(aSession(), MON, aRecipe()), { member: AC }, config)).state;
    expect(must(closeSession(finalized, { member: ME })).state.status).toBe("closed");
  });
  it("is rejected for a session that is already closed (terminal state)", () => {
    const closed = must(closeSession(aSession(), { member: AC })).state;
    expect(closeSession(closed, { member: AC })).toEqual({ ok: false, reason: "session_already_closed" });
  });
});

describe("rule RemindToFinalize (temporal)", () => {
  const planned = () => plan(aSession(), MON, aRecipe());

  it("is due at 08:00 on the morning of the first agreed day", () => {
    expect(reminderDueAt(planned(), config)).toEqual({ date: MON, hour: 8 });
  });

  it("is not due when nothing is agreed yet", () => {
    expect(reminderDueAt(aSession(), config)).toBeNull();
  });

  it("does not fire before the deadline", () => {
    const { events } = must(remindToFinalize(planned(), localDateTime(MON, 7), config));
    expect(events).toEqual([]);
  });

  it("fires at the deadline and notifies once", () => {
    const first = must(remindToFinalize(planned(), localDateTime(MON, 8), config));
    expect(first.events).toEqual([{ type: "FinalizeReminderDue", sessionId: first.state.id }]);
    const again = must(remindToFinalize(first.state, localDateTime(MON, 9), config));
    expect(again.events).toEqual([]);
  });

  it("fires on a later day too, if nobody finalized in time", () => {
    expect(must(remindToFinalize(planned(), localDateTime(WED, 12), config)).events).toHaveLength(1);
  });

  it("does not fire once the session is finalized or closed (the list is never filled automatically)", () => {
    const finalized = must(finalizePlan(planned(), { member: AC }, config)).state;
    expect(must(remindToFinalize(finalized, localDateTime(MON, 9), config)).events).toEqual([]);
    const closed = must(closeSession(planned(), { member: AC })).state;
    expect(must(remindToFinalize(closed, localDateTime(MON, 9), config)).events).toEqual([]);
  });

  it("is based on the earliest agreed day", () => {
    const s = plan(plan(aSession(), MON, aRecipe()), TUE, aRecipe());
    expect(reminderDueAt(s, config)?.date).toBe(MON);
  });
});
