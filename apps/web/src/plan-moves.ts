import type { PlanSession } from "./api";

export type Drop = { kind: "swap"; a: string; b: string } | { kind: "move"; from: string; to: string };

/** What dropping the dish of one day onto another means: swap with an agreed day, move onto an open one, else nothing. */
export function dropFor(days: PlanSession["days"], from: string, to: string): Drop | null {
  const source = days.find((d) => d.date === from);
  const target = days.find((d) => d.date === to);
  if (from === to || source?.status !== "planned") return null;
  if (target?.status === "planned") return { kind: "swap", a: from, b: to };
  if (target?.status === "open") return { kind: "move", from, to };
  return null;
}
