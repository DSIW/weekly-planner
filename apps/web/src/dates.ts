const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of a local calendar day, the form the server plans in. */
const toPlanDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The next `count` days starting today, in the phone's own time zone. */
export function upcomingDates(count: number, from: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, i) =>
    toPlanDate(new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)),
  );
}

/** The `count` days up to and including `to`, oldest first: the days a meal can still be added for. */
export function recentDates(count: number, to: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, i) =>
    toPlanDate(new Date(to.getFullYear(), to.getMonth(), to.getDate() - (count - 1 - i))),
  );
}

/** Today in the phone's time zone, as the server plans. */
export const todayPlanDate = (now: Date = new Date()): string => toPlanDate(now);

const label = new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "numeric" });

/** "Mo., 2.11." for `2026-11-02`. */
export function dayLabel(planDate: string): string {
  const [y, m, d] = planDate.split("-").map(Number) as [number, number, number];
  return label.format(new Date(y, m - 1, d));
}
