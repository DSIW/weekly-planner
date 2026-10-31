import {
  defaultPlanningConfig,
  memberId,
  planDate,
  proposalId,
  recipeId,
  sessionId,
  startSession,
  proposeRecipe,
  acceptProposal,
  type MemberId,
  type PlanDate,
  type PlanningSession,
  type Recipe,
} from "../../src/index.js";

export const AC = memberId("AC");
export const ME = memberId("me");

// 2026-11-02 is a Monday.
export const MON = planDate("2026-11-02");
export const TUE = planDate("2026-11-03");
export const WED = planDate("2026-11-04");
export const SAT = planDate("2026-11-07");
export const SUN = planDate("2026-11-08");

export const config = defaultPlanningConfig;

let nextRecipe = 1;
export const aRecipe = (over: Partial<Recipe> = {}): Recipe => {
  const id = nextRecipe++;
  return {
    id: recipeId(id),
    name: `Rezept ${id}`,
    mealType: "main",
    base: "pasta",
    diet: "vegetarian",
    totalTimeMinutes: 30,
    isProven: true,
    wantsToTry: false,
    yields: 2,
    ...over,
  };
};

/** Unwraps a successful result; throws with the rejection reason otherwise (a test setup mistake). */
export function must<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`setup failed: ${r.reason}`);
  return r.value;
}

export const aSession = (dates: PlanDate[] = [MON, TUE, WED], id = "s1"): PlanningSession =>
  must(startSession({ id: sessionId(id), startedBy: AC, dates, now: 0 })).state;

let nextProposal = 1;
export const newProposalId = () => proposalId(`p${nextProposal++}`);

/** Proposes `recipe` for the next open day by `by` and returns the session and the proposal id. */
export function withProposal(
  session: PlanningSession,
  date: PlanDate,
  recipe: Recipe,
  by: MemberId = AC,
): { session: PlanningSession; id: ReturnType<typeof proposalId> } {
  const id = newProposalId();
  const out = must(proposeRecipe(session, { proposalId: id, member: by, date, recipe }, config));
  return { session: out.state, id };
}

/** Plans `recipe` on `date`: AC proposes, ME accepts. */
export function plan(session: PlanningSession, date: PlanDate, recipe: Recipe): PlanningSession {
  const { session: s, id } = withProposal(session, date, recipe, AC);
  return must(acceptProposal(s, { member: ME, proposalId: id, dateTakenElsewhere: false })).state;
}

export const dayOf = (s: PlanningSession, date: PlanDate) => {
  const d = s.days.find((x) => x.date === date);
  if (!d) throw new Error(`no day ${date}`);
  return d;
};
