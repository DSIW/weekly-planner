import { describe, expect, it } from "vitest";
import { fitsWeekdayLimit, isDinnerCandidate } from "../src/index.js";

describe("hard rules", () => {
  it("only main dishes are dinner candidates", () => {
    expect(isDinnerCandidate({ mealType: "main" })).toBe(true);
    for (const t of ["side", "dessert", "baking", "breakfast", "snack", "drink"] as const) {
      expect(isDinnerCandidate({ mealType: t })).toBe(false);
    }
  });

  it("applies the weekday limit inclusively and lets an unknown time through", () => {
    expect(fitsWeekdayLimit({ totalTimeMinutes: 45 }, 45)).toBe(true);
    expect(fitsWeekdayLimit({ totalTimeMinutes: 46 }, 45)).toBe(false);
    expect(fitsWeekdayLimit({ totalTimeMinutes: null }, 45)).toBe(true);
  });
});
