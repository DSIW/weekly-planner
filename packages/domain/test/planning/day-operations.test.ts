import { describe, expect, it } from "vitest";
import { closeSession, markLeftoverDay, movePlannedDay, reopenDay, swapPlannedDays, planDate } from "../../src/index.js";
import { AC, ME, MON, SAT, SUN, TUE, WED, aRecipe, aSession, config, dayOf, must, plan } from "../support/builders.js";

const closed = (s: ReturnType<typeof aSession>) => must(closeSession(s, { member: AC })).state;

describe("rule MarkLeftoverDay", () => {
  it("succeeds: an open day becomes a leftover day with no recipe", () => {
    const { state, events } = must(markLeftoverDay(aSession(), { member: AC, date: TUE }));
    expect(dayOf(state, TUE)).toMatchObject({ status: "leftovers" });
    expect(dayOf(state, TUE)).not.toHaveProperty("recipe");
    expect(events[0]).toMatchObject({ type: "DayMarkedLeftovers", date: TUE });
  });
  it("is rejected when the session is not open", () => {
    expect(markLeftoverDay(closed(aSession()), { member: AC, date: TUE })).toEqual({ ok: false, reason: "session_not_open" });
  });
  it("is rejected when the day is not open", () => {
    expect(markLeftoverDay(plan(aSession(), MON, aRecipe()), { member: AC, date: MON })).toEqual({ ok: false, reason: "day_not_open" });
    expect(markLeftoverDay(aSession(), { member: AC, date: SAT })).toEqual({ ok: false, reason: "unknown_day" });
  });
});

describe("rules ReopenPlannedDay and ReopenLeftoverDay", () => {
  it("reopens a planned day and clears its recipe", () => {
    const s = plan(aSession(), MON, aRecipe());
    const { state, events } = must(reopenDay(s, { member: ME, date: MON }));
    expect(dayOf(state, MON).status).toBe("open");
    expect(dayOf(state, MON)).not.toHaveProperty("recipe");
    expect(events[0]).toMatchObject({ type: "DayReopened", date: MON });
  });
  it("reopens a leftover day", () => {
    const s = must(markLeftoverDay(aSession(), { member: AC, date: TUE })).state;
    expect(dayOf(must(reopenDay(s, { member: AC, date: TUE })).state, TUE).status).toBe("open");
  });
  it("is rejected for a day that is already open", () => {
    expect(reopenDay(aSession(), { member: AC, date: MON })).toEqual({ ok: false, reason: "day_already_open" });
  });
  it("is rejected once the plan is finalized or closed (a finalized plan is locked)", () => {
    const planned = plan(aSession(), MON, aRecipe());
    expect(reopenDay(closed(planned), { member: AC, date: MON })).toEqual({ ok: false, reason: "session_not_open" });
  });
  it("lets the deck offer the reopened day again as the next open day", () => {
    let s = plan(aSession(), MON, aRecipe());
    s = plan(s, TUE, aRecipe());
    s = must(reopenDay(s, { member: AC, date: MON })).state;
    expect(s.days.find((d) => d.status === "open")?.date).toBe(MON);
  });
});

describe("rule SwapPlannedDays", () => {
  const two = () => {
    const a = aRecipe({ name: "A" });
    const b = aRecipe({ name: "B" });
    return { a, b, s: plan(plan(aSession(), MON, a), TUE, b) };
  };
  it("succeeds: the two dishes change places", () => {
    const { a, b, s } = two();
    const { state, events } = must(swapPlannedDays(s, { member: AC, a: MON, b: TUE }, config));
    expect(dayOf(state, MON).recipe?.id).toBe(b.id);
    expect(dayOf(state, TUE).recipe?.id).toBe(a.id);
    expect(events[0]).toMatchObject({ type: "DaysSwapped", dates: [MON, TUE] });
  });
  it("is rejected when the session is not open", () => {
    expect(swapPlannedDays(closed(two().s), { member: AC, a: MON, b: TUE }, config)).toEqual({ ok: false, reason: "session_not_open" });
  });
  it("is rejected for the same day twice", () => {
    expect(swapPlannedDays(two().s, { member: AC, a: MON, b: MON }, config)).toEqual({ ok: false, reason: "same_day" });
  });
  it("is rejected for a day that is not in the session", () => {
    expect(swapPlannedDays(two().s, { member: AC, a: MON, b: SAT }, config)).toEqual({ ok: false, reason: "unknown_day" });
  });
  it("is rejected when either day is not planned", () => {
    const s = plan(aSession(), MON, aRecipe());
    expect(swapPlannedDays(s, { member: AC, a: MON, b: TUE }, config)).toEqual({ ok: false, reason: "day_not_planned" });
    expect(swapPlannedDays(s, { member: AC, a: TUE, b: MON }, config)).toEqual({ ok: false, reason: "day_not_planned" });
  });
  it("is rejected when a long recipe would land on a weekday (the weekday limit still holds)", () => {
    const longPizza = aRecipe({ totalTimeMinutes: 300 });
    const quick = aRecipe({ totalTimeMinutes: 20 });
    const s = plan(plan(aSession([FRI(), SAT]), FRI(), quick), SAT, longPizza);
    expect(swapPlannedDays(s, { member: AC, a: FRI(), b: SAT }, config)).toEqual({ ok: false, reason: "too_long_for_weekday" });
    // the other direction: a long recipe on the weekend may go anywhere on the weekend
    const weekend = plan(plan(aSession([SAT, SUN]), SAT, longPizza), SUN, quick);
    expect(swapPlannedDays(weekend, { member: AC, a: SAT, b: SUN }, config).ok).toBe(true);
  });
});

describe("rule MovePlannedDay", () => {
  it("succeeds: the dish moves to an open day and the old day opens again", () => {
    const r = aRecipe();
    const s = plan(aSession(), MON, r);
    const { state, events } = must(movePlannedDay(s, { member: AC, from: MON, to: WED }, config));
    expect(dayOf(state, WED)).toMatchObject({ status: "planned", recipe: { id: r.id } });
    expect(dayOf(state, MON).status).toBe("open");
    expect(events[0]).toMatchObject({ type: "DayMoved", from: MON, to: WED });
  });
  it("is rejected when the session is not open", () => {
    const s = plan(aSession(), MON, aRecipe());
    expect(movePlannedDay(closed(s), { member: AC, from: MON, to: WED }, config)).toEqual({ ok: false, reason: "session_not_open" });
  });
  it("is rejected for an unknown day, an unplanned source or a target that is not open", () => {
    const s = plan(aSession(), MON, aRecipe());
    expect(movePlannedDay(s, { member: AC, from: MON, to: SAT }, config)).toEqual({ ok: false, reason: "unknown_day" });
    expect(movePlannedDay(s, { member: AC, from: TUE, to: WED }, config)).toEqual({ ok: false, reason: "day_not_planned" });
    const two = plan(s, TUE, aRecipe());
    expect(movePlannedDay(two, { member: AC, from: MON, to: TUE }, config)).toEqual({ ok: false, reason: "target_not_open" });
  });
  it("is rejected when a long recipe would move onto a weekday", () => {
    let s = plan(aSession([FRI(), SAT, SUN]), FRI(), aRecipe({ totalTimeMinutes: 20 }));
    s = plan(s, SAT, aRecipe({ totalTimeMinutes: 300 }));
    s = must(reopenDay(s, { member: AC, date: FRI() })).state; // Friday is open again, the long recipe is on Saturday
    expect(movePlannedDay(s, { member: AC, from: SAT, to: FRI() }, config)).toEqual({ ok: false, reason: "too_long_for_weekday" });
    expect(movePlannedDay(s, { member: AC, from: SAT, to: SUN }, config).ok).toBe(true);
  });
});

function FRI() {
  return planDate("2026-11-06");
}
