import type { PlannerView, TakenDate } from "@weekly-planner/application";
import { planDate, type PlanDate } from "@weekly-planner/domain";
import type { KitchenOwlClient } from "./client.js";

/** Adapter: what KitchenOwl's planner holds now. A failed read is "unknown", never "empty". */
export class KitchenOwlPlannerView implements PlannerView {
  constructor(private readonly client: Pick<KitchenOwlClient, "plannedDatesFrom" | "plannerEntriesFrom">) {}

  async plannedDatesFrom(from: PlanDate): Promise<ReadonlySet<PlanDate> | null> {
    try {
      return new Set([...(await this.client.plannedDatesFrom(from))].map(planDate));
    } catch {
      return null;
    }
  }

  async entriesFrom(from: PlanDate): Promise<readonly TakenDate[] | null> {
    try {
      return (await this.client.plannerEntriesFrom(from)).map((e) => ({ ...e, date: planDate(e.date) }));
    } catch {
      return null;
    }
  }
}
