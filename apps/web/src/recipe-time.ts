import type { RecipeView } from "./api";

const hours = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** "30 min", or "21,4 h" for long recipes, where minutes are no use to read. */
const formatMinutes = (minutes: number): string =>
  minutes < 180 ? `${minutes} min` : `${hours.format(minutes / 60)} h`;

/** What a card says about a recipe's time: the time, "Zeit fehlt", and the lead time a long recipe needs. */
export function timeLabel(r: Pick<RecipeView, "minutes" | "needsTime" | "planAhead">): string {
  if (r.minutes === null) return "Zeit fehlt";
  return r.planAhead ? `${formatMinutes(r.minutes)} · Vorlauf nötig` : formatMinutes(r.minutes);
}
