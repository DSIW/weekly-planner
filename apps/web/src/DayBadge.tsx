import { dayLabel, dayParts } from "./dates";

/** A day as two lines, weekday over date, always the same width so whatever follows lines up. */
export function DayBadge({ date }: { date: string }) {
  const parts = dayParts(date);
  return (
    <span className="day-badge">
      <b aria-hidden="true">{parts.weekday}</b>
      <span aria-hidden="true">{parts.date}</span>
      <span className="sr-only">{dayLabel(date)}</span>
    </span>
  );
}
