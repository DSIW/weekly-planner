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
    });
    expect([...((await view.plannedDatesFrom(planDate("2026-11-04"))) ?? [])]).toEqual(["2026-11-05"]);
    expect(asked).toBe("2026-11-04");
  });

  it("answers unknown, not empty, when KitchenOwl cannot be read", async () => {
    const view = new KitchenOwlPlannerView({
      async plannedDatesFrom() {
        throw new Error("down");
      },
    });
    expect(await view.plannedDatesFrom(planDate("2026-11-04"))).toBeNull();
  });
});
