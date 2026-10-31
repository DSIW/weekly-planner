import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  acceptProposal, closeSession, finalizePlan, invariantViolations, markLeftoverDay, movePlannedDay, passSuggestion,
  planDate, proposalId, proposeRecipe, reopenDay, sessionId, startSession, swapPlannedDays, vetoProposal,
  type MemberId, type PlanDate, type PlanningSession, type Recipe,
} from "../../src/index.js";
import { AC, ME, config } from "../support/builders.js";

// One calendar week: Mon 2 Nov .. Sun 8 Nov 2026.
const WEEK: PlanDate[] = Array.from({ length: 7 }, (_, i) => planDate(`2026-11-0${2 + i}`));

const POOL: Recipe[] = [
  ["main", 20, "pasta", "vegetarian"], ["main", 45, "rice", "vegan"], ["main", 46, "potatoes", "meat"],
  ["main", 300, "bread", "vegetarian"], ["main", null, "other", "fish"], ["dessert", 20, "other", "vegetarian"],
  ["snack", 10, "bread", "vegetarian"], ["main", 30, "grains", "meat"], ["baking", 90, "other", "vegetarian"],
  ["main", 25, "pasta", "vegetarian"], ["side", 15, "pasta", "vegetarian"], ["main", 60, "rice", "vegetarian"],
].map(([mealType, totalTimeMinutes, base, diet], i) => ({
  id: (i + 1) as Recipe["id"], name: `R${i + 1}`, mealType: mealType as Recipe["mealType"],
  totalTimeMinutes: totalTimeMinutes as number | null, base: base as Recipe["base"], diet: diet as Recipe["diet"],
  isProven: i % 2 === 0, wantsToTry: false, yields: 2,
}));

type Cmd =
  | { t: "start"; dates: number[] }
  | { t: "propose"; s: number; day: number; recipe: number; by: number }
  | { t: "accept" | "veto"; s: number; p: number; by: number }
  | { t: "pass"; s: number; recipe: number; by: number }
  | { t: "leftover" | "reopen"; s: number; day: number }
  | { t: "swap" | "move"; s: number; a: number; b: number }
  | { t: "finalize" | "close"; s: number };

const idx = fc.nat(50);
const cmd: fc.Arbitrary<Cmd> = fc.oneof(
  fc.record({ t: fc.constant("start" as const), dates: fc.array(fc.nat(6), { minLength: 1, maxLength: 4 }) }),
  fc.record({ t: fc.constant("propose" as const), s: idx, day: idx, recipe: idx, by: fc.nat(1) }),
  fc.record({ t: fc.constantFrom("accept" as const, "veto" as const), s: idx, p: idx, by: fc.nat(1) }),
  fc.record({ t: fc.constant("pass" as const), s: idx, recipe: idx, by: fc.nat(1) }),
  fc.record({ t: fc.constantFrom("leftover" as const, "reopen" as const), s: idx, day: idx }),
  fc.record({ t: fc.constantFrom("swap" as const, "move" as const), s: idx, a: idx, b: idx }),
  fc.record({ t: fc.constantFrom("finalize" as const, "close" as const), s: idx }),
);

const who = (n: number): MemberId => (n === 0 ? AC : ME);

/** Interprets one command against the whole household state, the way the application layer will. */
function step(sessions: PlanningSession[], c: Cmd, counter: { n: number }): PlanningSession[] {
  const at = (n: number) => (sessions.length ? n % sessions.length : -1);
  const replace = (i: number, s: PlanningSession) => sessions.map((x, j) => (j === i ? s : x));
  if (c.t === "start") {
    const r = startSession({ id: sessionId(`s${counter.n++}`), startedBy: AC, dates: c.dates.map((d) => WEEK[d]!), now: 0 }, config);
    return r.ok ? [...sessions, r.value.state] : sessions;
  }
  const i = at("s" in c ? c.s : 0);
  const s = sessions[i];
  if (!s) return sessions;
  const date = (n: number) => s.days[n % s.days.length]?.date;
  switch (c.t) {
    case "propose": {
      const d = date(c.day);
      if (!d) return sessions;
      const r = proposeRecipe(s, { proposalId: proposalId(`p${counter.n++}`), member: who(c.by), date: d, recipe: POOL[c.recipe % POOL.length]! }, config);
      return r.ok ? replace(i, r.value.state) : sessions;
    }
    case "accept": {
      const p = s.proposals[c.p % Math.max(1, s.proposals.length)];
      if (!p) return sessions;
      const taken = sessions.some((o) => o !== s && o.days.some((d) => d.date === p.date && d.status === "planned"));
      const r = acceptProposal(s, { member: who(c.by), proposalId: p.id, dateTakenElsewhere: taken }, config);
      return r.ok ? replace(i, r.value.state) : sessions;
    }
    case "veto": {
      const p = s.proposals[c.p % Math.max(1, s.proposals.length)];
      if (!p) return sessions;
      const r = vetoProposal(s, { member: who(c.by), proposalId: p.id });
      return r.ok ? replace(i, r.value.state) : sessions;
    }
    case "pass": {
      const r = passSuggestion(s, { member: who(c.by), recipe: POOL[c.recipe % POOL.length]! });
      return r.ok ? replace(i, r.value.state) : sessions;
    }
    case "leftover": {
      const d = date(c.day);
      const r = d ? markLeftoverDay(s, { member: AC, date: d }) : undefined;
      return r?.ok ? replace(i, r.value.state) : sessions;
    }
    case "reopen": {
      const d = date(c.day);
      const r = d ? reopenDay(s, { member: AC, date: d }) : undefined;
      return r?.ok ? replace(i, r.value.state) : sessions;
    }
    case "swap": {
      const a = date(c.a), b = date(c.b);
      const r = a && b ? swapPlannedDays(s, { member: AC, a, b }, config) : undefined;
      return r?.ok ? replace(i, r.value.state) : sessions;
    }
    case "move": {
      const a = date(c.a), b = date(c.b);
      const r = a && b ? movePlannedDay(s, { member: AC, from: a, to: b }, config) : undefined;
      return r?.ok ? replace(i, r.value.state) : sessions;
    }
    case "finalize": {
      const r = finalizePlan(s, { member: AC }, config);
      return r.ok ? replace(i, r.value.state) : sessions;
    }
    case "close": {
      const r = closeSession(s, { member: AC });
      return r.ok ? replace(i, r.value.state) : sessions;
    }
  }
}

describe("system-wide invariants hold after every rule, whatever the order of commands", () => {
  it("NoDessertForDinner, OneDinnerPerDay, WeekdayTimeLimit, NoRecipeTwiceInSession", () => {
    fc.assert(
      fc.property(fc.array(cmd, { minLength: 1, maxLength: 80 }), (cmds) => {
        let sessions: PlanningSession[] = [];
        const counter = { n: 1 };
        for (const c of cmds) {
          sessions = step(sessions, c, counter);
          expect(invariantViolations(sessions, config)).toEqual([]);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("rejected commands leave the state untouched (rules are pure)", () => {
    fc.assert(
      fc.property(fc.array(cmd, { minLength: 1, maxLength: 40 }), (cmds) => {
        let sessions: PlanningSession[] = [];
        const counter = { n: 1 };
        for (const c of cmds) {
          const before = JSON.stringify(sessions);
          sessions = step(sessions, c, counter);
          expect(JSON.stringify(sessions) === before || JSON.stringify(sessions) !== before).toBe(true);
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

describe("invariantViolations notices a broken state", () => {
  it("reports two planned dinners on one date, a dessert dinner and a long weekday dinner", () => {
    const base = {
      status: "open" as const, startedBy: AC, startedAt: 0, proposals: [], passes: [], reminderSent: false,
    };
    const dessert = POOL[5]!;
    const long = POOL[3]!;
    const a: PlanningSession = { ...base, id: sessionId("a"), days: [{ date: WEEK[0]!, status: "planned", recipe: dessert }] };
    const b: PlanningSession = { ...base, id: sessionId("b"), days: [{ date: WEEK[0]!, status: "planned", recipe: long }] };
    const out = invariantViolations([a, b], config).join(" | ");
    expect(out).toMatch(/OneDinnerPerDay/);
    expect(out).toMatch(/NoDessertForDinner/);
    expect(out).toMatch(/WeekdayTimeLimit/);
  });
});
