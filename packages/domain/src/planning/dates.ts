/** A calendar date as plain `YYYY-MM-DD`, without time zone. Dinners are planned per date, not per instant. */
export type PlanDate = string & { readonly __brand: "PlanDate" };

const toUtc = (s: string): number => {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};

export function planDate(s: string): PlanDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || new Date(toUtc(s)).toISOString().slice(0, 10) !== s) {
    throw new Error(`not a calendar date: ${s}`);
  }
  return s as PlanDate;
}

export const addDays = (date: PlanDate, days: number): PlanDate =>
  new Date(toUtc(date) + days * 86_400_000).toISOString().slice(0, 10) as PlanDate;

/** Saturday and Sunday: no time limit on the cooking time. */
export const isWeekend = (date: PlanDate): boolean => {
  const weekday = new Date(toUtc(date)).getUTCDay();
  return weekday === 0 || weekday === 6;
};

/** A wall-clock moment in the household's time zone, with the precision the reminder needs. */
export interface LocalDateTime {
  readonly date: PlanDate;
  readonly hour: number;
}
export const localDateTime = (date: PlanDate, hour: number): LocalDateTime => ({ date, hour });

export const isBefore = (a: LocalDateTime, b: LocalDateTime): boolean =>
  a.date < b.date || (a.date === b.date && a.hour < b.hour);
