import { describe, expect, it } from "vitest";
import { planDate, sessionId, startSession } from "../../src/index.js";
import { AC, MON, TUE, WED, config, must } from "../support/builders.js";

const start = (dates: ReturnType<typeof planDate>[]) =>
  startSession({ id: sessionId("s1"), startedBy: AC, dates, now: 1000 }, config);

describe("rule StartSession", () => {
  it("succeeds: creates an open session with one open plan day per date", () => {
    const { state, events } = must(start([MON, TUE, WED]));
    expect(state).toMatchObject({ status: "open", startedBy: AC, startedAt: 1000 });
    expect(state.days.map((d) => [d.date, d.status])).toEqual([[MON, "open"], [TUE, "open"], [WED, "open"]]);
    expect(state.proposals).toEqual([]);
    expect(events).toEqual([{ type: "SessionStarted", sessionId: "s1", dates: [MON, TUE, WED] }]);
  });

  it("accepts two days as well as three", () => {
    expect(start([MON, TUE]).ok).toBe(true);
  });

  it("is rejected when the dates are not distinct", () => {
    expect(start([MON, MON, TUE])).toEqual({ ok: false, reason: "duplicate_dates" });
  });

  it("is rejected below the minimum number of days", () => {
    expect(start([])).toEqual({ ok: false, reason: "too_few_days" });
  });

  it("is rejected above the maximum number of days", () => {
    const six = [MON, TUE, WED, ...["2026-11-05", "2026-11-06", "2026-11-07"].map(planDate)];
    expect(start(six)).toEqual({ ok: false, reason: "too_many_days" });
  });

  it("sorts the days by date regardless of input order", () => {
    expect(must(start([WED, MON, TUE])).state.days.map((d) => d.date)).toEqual([MON, TUE, WED]);
  });
});

describe("config defaults", () => {
  it("has the household's agreed values", () => {
    expect(config).toMatchObject({
      minDaysPerSession: 1,
      maxDaysPerSession: 5,
      weekdayTimeLimitMinutes: 45,
      householdSize: 2,
      varietyWindowDays: 2,
      recentWindowDays: 14,
      newRecipesPerSession: 1,
      reminderHour: 8,
    });
    expect(config.vegetarianShare).toBeCloseTo(0.66);
  });
});
