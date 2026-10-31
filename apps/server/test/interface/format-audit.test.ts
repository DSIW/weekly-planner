import { describe, expect, it } from "vitest";
import type { CatalogAudit } from "@weekly-planner/application";
import { formatAudit } from "../../src/interface/cli/format-audit.js";

const base: CatalogAudit = {
  total: 2,
  ready: 2,
  byMealType: { main: 2 },
  byBase: { pasta: 1, rice: 1 },
  byDiet: { vegetarian: 2 },
  proven: 1,
  unproven: 1,
  wantsToTry: 0,
  mains: 2,
  vegetarianMains: 2,
  weekdayMains: 2,
  mainsWithoutTime: [],
  needsData: [],
};

describe("formatAudit", () => {
  it("says the needs-data list is empty", () => {
    expect(formatAudit(base)).toContain("needs-data list: empty");
  });

  it("lists recipes that need data with their reasons", () => {
    const text = formatAudit({
      ...base,
      needsData: [{ name: "Kaputt", problems: ["no diet tag", "no meal-type tag"] }],
    });
    expect(text).toContain("needs-data list: 1 recipe(s)");
    expect(text).toContain("Kaputt: no diet tag; no meal-type tag");
  });
});
