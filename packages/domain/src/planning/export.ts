// The export of a finalized plan to KitchenOwl: one planner entry per agreed day and one batch for the shopping list.
// KitchenOwl cannot tell a repeated request from a new one (a repeated list batch adds every amount up again), so a
// step is recorded as "sending" before its request goes out and as "done" once it was answered. See decision D23.
import type { RecipeId } from "../catalog/recipe.js";
import type { SessionId } from "../shared/ids.js";
import { reject, succeed, type Outcome, type Result } from "../shared/result.js";
import type { PlanDate } from "./dates.js";
import type { FinalizedDinner, PlanningEvent } from "./events.js";
import type { ListItem } from "./shopping.js";

type StepStatus = "pending" | "sending" | "done";

/** Why the export stopped: KitchenOwl refused (nothing was written) or gave no answer (unknown). */
export type ExportFailure = "refused" | "unconfirmed";

interface ExportDay {
  readonly date: PlanDate;
  readonly recipeId: RecipeId;
  readonly recipeName: string;
  /** Portions the planner entry is written for. */
  readonly portions: number;
  readonly status: StepStatus;
}

export interface FinalizeExport {
  readonly sessionId: SessionId;
  /** Ordered by date. */
  readonly days: readonly ExportDay[];
  /** The consolidated list, fixed when the plan was finalized so that every send carries the same items. */
  readonly list: { readonly items: readonly ListItem[]; readonly status: StepStatus };
  /** Set by the last failed step, cleared by the next step that succeeds. */
  readonly failure: ExportFailure | null;
}

export type ExportStep = { readonly kind: "planner"; readonly date: PlanDate } | { readonly kind: "list" };

type Done = Result<Outcome<FinalizeExport, PlanningEvent>>;

/** The export a freshly finalized plan starts with: every step still to do. */
export function newExport(
  sessionId: SessionId,
  dinners: readonly FinalizedDinner[],
  items: readonly ListItem[],
): FinalizeExport {
  return {
    sessionId,
    days: dinners.map((d) => ({
      date: d.date,
      recipeId: d.recipeId,
      recipeName: d.recipeName,
      portions: d.portions,
      status: "pending" as const,
    })),
    list: { items, status: "pending" },
    failure: null,
  };
}

const statusOf = (e: FinalizeExport, step: ExportStep): StepStatus | undefined =>
  step.kind === "list" ? e.list.status : e.days.find((d) => d.date === step.date)?.status;

const withStatus = (e: FinalizeExport, step: ExportStep, status: StepStatus): FinalizeExport =>
  step.kind === "list"
    ? { ...e, list: { ...e.list, status } }
    : { ...e, days: e.days.map((d) => (d.date === step.date ? { ...d, status } : d)) };

export const exportComplete = (e: FinalizeExport): boolean =>
  e.list.status === "done" && e.days.every((d) => d.status === "done");

/** The first step that is not done: planner entries by date, the shopping list last. */
export function nextStep(e: FinalizeExport): ExportStep | null {
  const day = e.days.find((d) => d.status !== "done");
  if (day) return { kind: "planner", date: day.date };
  return e.list.status === "done" ? null : { kind: "list" };
}

/**
 * rule RetryRefusedExports: the last failure was a refusal and the step it left behind is waiting. A step that
 * is sending (sent without an answer, or interrupted by a crash) is never part of this: a person decides about it.
 */
export function retriableAfterRefusal(e: FinalizeExport): boolean {
  const next = nextStep(e);
  return e.failure === "refused" && next !== null && statusOf(e, next) === "pending";
}

const progressed = (e: FinalizeExport): PlanningEvent => ({
  type: "ExportProgressed",
  sessionId: e.sessionId,
  complete: exportComplete(e),
  failure: e.failure,
});

/**
 * rules SendExportStep and ResendUnconfirmedStep. A step that is done is never sent again. A step that is still
 * "sending" was sent without an answer: it goes out again only when a member said so (`resendUnconfirmed`).
 */
export function beginStep(e: FinalizeExport, step: ExportStep, cmd: { resendUnconfirmed: boolean }): Done {
  const status = statusOf(e, step);
  if (status === undefined) return reject("unknown_step");
  if (status === "done") return reject("step_already_done");
  if (status === "sending" && !cmd.resendUnconfirmed) return reject("step_unconfirmed");
  // Recorded before the request goes out, so a crash can never lead to a silent second send.
  return succeed({ state: withStatus(e, step, "sending"), events: [] });
}

/** rule ExportStepAnswered */
export function completeStep(e: FinalizeExport, step: ExportStep): Done {
  if (statusOf(e, step) !== "sending") return reject("step_not_sending");
  const state = { ...withStatus(e, step, "done"), failure: null };
  return succeed({ state, events: [progressed(state)] });
}

/** rule ExportStepRefused for "refused" (back to pending); no answer leaves the step sending ("unconfirmed"). */
export function failStep(e: FinalizeExport, step: ExportStep, failure: ExportFailure): Done {
  if (statusOf(e, step) !== "sending") return reject("step_not_sending");
  const state = { ...(failure === "refused" ? withStatus(e, step, "pending") : e), failure };
  return succeed({ state, events: [progressed(state)] });
}
