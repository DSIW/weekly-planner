import { defaultPlanningConfig, type PlanningConfig } from "./config.js";
import { isWeekend } from "./dates.js";
import { fitsWeekdayLimit } from "./eligibility.js";
import type { PlanningSession } from "./session.js";

/**
 * The spec's invariants over every plan day of the household, as a list of violations (empty when sound).
 * The aggregate methods keep them; this check exists for the tests and as a runtime safety net.
 */
export function invariantViolations(
  sessions: readonly PlanningSession[],
  config: PlanningConfig = defaultPlanningConfig,
): string[] {
  const out: string[] = [];
  const planned = sessions.flatMap((s) =>
    s.days.flatMap((d) => (d.status === "planned" && d.recipe ? [{ session: s, date: d.date, recipe: d.recipe }] : [])),
  );
  for (const d of planned) {
    if (d.recipe.mealType !== "main") out.push(`NoDessertForDinner: ${d.date} plans a ${d.recipe.mealType}`);
    if (!isWeekend(d.date) && !fitsWeekdayLimit(d.recipe, config.weekdayTimeLimitMinutes)) {
      out.push(`WeekdayTimeLimit: ${d.date} plans a ${d.recipe.totalTimeMinutes} minute recipe`);
    }
  }
  for (const [i, a] of planned.entries()) {
    for (const b of planned.slice(i + 1)) {
      if (a.date === b.date) out.push(`OneDinnerPerDay: ${a.date} is planned twice`);
      if (a.session.id === b.session.id && a.recipe.id === b.recipe.id) {
        out.push(`NoRecipeTwiceInSession: recipe ${a.recipe.id} is planned twice in session ${a.session.id}`);
      }
    }
  }
  for (const s of sessions) {
    if (s.proposals.filter((p) => p.status === "pending").length > 1) {
      out.push(`OnePendingProposalPerSession: session ${s.id} has several pending proposals`);
    }
  }
  return out;
}
