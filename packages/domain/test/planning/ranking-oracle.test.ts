import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  acceptProposal, passSuggestion, planDate, proposalId, proposeRecipe, recipeId, sessionId, startSession, suggestRecipes,
  type Recipe,
} from "../../src/index.js";
import { AC, ME, config, must } from "../support/builders.js";

// Golden cases written by reference/generate_ranking_cases.py from the reference model (reference/simulate_spec.py).
interface Case {
  name: string;
  dates: string[];
  planned: { date: string; recipeId: number }[];
  passed: number[];
  history: { date: string; base: Recipe["base"] }[];
  recent: number[];
  recipes: Recipe[];
  expected: number[];
}
const cases = JSON.parse(readFileSync(new URL("./ranking-oracle.json", import.meta.url), "utf8")) as Case[];

describe("suggestion ranking matches the reference model", () => {
  it("has cases", () => expect(cases.length).toBeGreaterThan(100));

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const byId = new Map(c.recipes.map((r) => [r.id as number, r]));
    let session = must(startSession({ id: sessionId("oracle"), startedBy: AC, dates: c.dates.map(planDate), now: 0 }, config)).state;
    for (const p of c.planned) {
      const recipe = byId.get(p.recipeId)!;
      const pid = proposalId(`p${p.recipeId}`);
      session = must(proposeRecipe(session, { proposalId: pid, member: AC, date: planDate(p.date), recipe }, config)).state;
      session = must(acceptProposal(session, { member: ME, proposalId: pid, dateTakenElsewhere: false }, config)).state;
    }
    for (const id of c.passed) session = must(passSuggestion(session, { member: AC, recipe: byId.get(id)! })).state;

    const out = suggestRecipes({
      session,
      candidates: c.recipes,
      history: c.history.map((h) => ({ date: planDate(h.date), base: h.base })),
      recentlyPlanned: new Set(c.recent.map(recipeId)),
      experienced: new Set(),
      config,
      random: () => 0.5,
    });
    expect(out.map((r) => r.id as number)).toEqual(c.expected);
  });
});
