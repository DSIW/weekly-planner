import type { PlannerView } from "@weekly-planner/application";
import { planDate, type PlanDate } from "@weekly-planner/domain";
import type { KitchenOwlClient } from "./client.js";

/** Adapter: what KitchenOwl's planner holds now. A failed read is "unknown", never "empty". */
export class KitchenOwlPlannerView implements PlannerView {
  constructor(private readonly client: Pick<KitchenOwlClient, "plannedDatesFrom">) {}

  async plannedDatesFrom(from: PlanDate): Promise<ReadonlySet<PlanDate> | null> {
    try {
      return new Set([...(await this.client.plannedDatesFrom(from))].map(planDate));
    } catch {
      return null;
    }
  }
}
