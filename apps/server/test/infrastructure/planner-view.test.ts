import { planDate } from "@weekly-planner/domain";
import { describe, expect, it } from "vitest";
import { KitchenOwlPlannerView } from "../../src/infrastructure/kitchenowl/kitchenowl-planner-view.js";

describe("KitchenOwlPlannerView", () => {
  it("gives the dates KitchenOwl holds from the date asked for", async () => {
    let asked = "";
    const view = new KitchenOwlPlannerView({
      async plannedDatesFrom(from) {
        asked = from;
        return new Set(["2026-11-05"]);
      },
      async plannerEntriesFrom() {
        return [];
      },
    });
    expect([...((await view.plannedDatesFrom(planDate("2026-11-04"))) ?? [])]).toEqual(["2026-11-05"]);
    expect(asked).toBe("2026-11-04");
  });

  it("answers unknown, not empty, when KitchenOwl cannot be read", async () => {
    const view = new KitchenOwlPlannerView({
      async plannedDatesFrom() {
        throw new Error("down");
      },
      async plannerEntriesFrom() {
        throw new Error("down");
      },
    });
    expect(await view.plannedDatesFrom(planDate("2026-11-04"))).toBeNull();
    expect(await view.entriesFrom(planDate("2026-11-04"))).toBeNull();
  });

  it("gives the dinners with their recipe, and unknown for a read that failed", async () => {
    const view = new KitchenOwlPlannerView({
      async plannedDatesFrom() {
        return new Set();
      },
      async plannerEntriesFrom() {
        return [{ date: "2026-11-05", recipeName: "Pasta", recipeId: 7 }];
      },
    });
    expect(await view.entriesFrom(planDate("2026-11-04"))).toEqual([
      { date: "2026-11-05", recipeName: "Pasta", recipeId: 7 },
    ]);
  });
});
