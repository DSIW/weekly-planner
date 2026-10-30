import type { CatalogAudit } from "@weekly-planner/application";

const line = (counts: Readonly<Record<string, number>>): string =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");

/** Presentation: renders the audit for the terminal. Knows nothing about where the data came from. */
export function formatAudit(a: CatalogAudit): string {
  const out = [
    `${a.total} recipes read, ${a.ready} ready`,
    `meal types: ${line(a.byMealType)}`,
    `bases: ${line(a.byBase)}`,
    `diets: ${line(a.byDiet)}`,
    `proven: ${a.proven}, new: ${a.unproven}, want to try: ${a.wantsToTry}`,
    `main dishes: ${a.mains} (${a.vegetarianMains} vegetarian/vegan), usable on a weekday: ${a.weekdayMains}`,
    `main dishes without a time (offered with a reminder): ${a.mainsWithoutTime.length}` +
      (a.mainsWithoutTime.length ? ` -> ${a.mainsWithoutTime.join(", ")}` : ""),
    "",
  ];
  if (a.needsData.length === 0) out.push("needs-data list: empty");
  else {
    out.push(`needs-data list: ${a.needsData.length} recipe(s)`);
    for (const d of a.needsData) out.push(`  ${d.name}: ${d.problems.join("; ")}`);
  }
  return out.join("\n");
}
