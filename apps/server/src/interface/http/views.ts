import {
  needsPlanningAhead,
  exportComplete,
  isStaple,
  needsTime,
  type FinalizeExport,
  type ListItem,
  type MealLogEntry,
  type PlanningSession,
  type Recipe,
} from "@weekly-planner/domain";

/** What the phones see of a recipe: enough to choose by. */
export const recipeView = (r: Recipe, planAheadMinutes: number) => ({
  id: r.id,
  name: r.name,
  minutes: r.totalTimeMinutes,
  base: r.base,
  diet: r.diet,
  tags: r.tags ?? [],
  needsTime: needsTime(r),
  planAhead: needsPlanningAhead(r, { planAheadMinutes }),
});

export const listLineView = (i: ListItem) => ({
  name: i.name,
  /** KitchenOwl's icon key of the item; the phones draw it with KitchenOwl's own icon font. */
  icon: i.icon ?? null,
  /** Salt, pepper, oil and water: the shopping list starts with these marked as at home. */
  staple: isStaple(i.name),
  description: i.description,
  needsReview: i.needsReview,
  recipes: i.recipes,
});

/** How far the export to KitchenOwl has come, for the finalize screen. */
export const exportView = (e: FinalizeExport) => ({
  complete: exportComplete(e),
  failure: e.failure,
  days: e.days.map((d) => ({ date: d.date, recipeName: d.recipeName, status: d.status })),
  list: {
    status: e.list.status,
    items: e.list.items.map(listLineView),
  },
});

/** What the phones see of a session; passes and the rest join in the slices that show them. */
export const sessionView = (s: PlanningSession, ahead: number, exported?: FinalizeExport | null) => ({
  ...(exported ? { export: exportView(exported) } : {}),
  id: s.id,
  status: s.status,
  startedBy: s.startedBy,
  reminderSent: s.reminderSent,
  days: s.days.map((d) => ({
    date: d.date,
    status: d.status,
    ...(d.recipe ? { recipe: recipeView(d.recipe, ahead) } : {}),
    ...(d.removedInPlanner ? { removedInPlanner: true } : {}),
  })),
  proposals: s.proposals.map((p) => ({
    id: p.id,
    date: p.date,
    recipe: recipeView(p.recipe, ahead),
    proposedBy: p.proposedBy,
    status: p.status,
    ...(p.decidedBy ? { decidedBy: p.decidedBy } : {}),
  })),
});

/** What the phones see of a logged meal. */
export const entryView = (e: MealLogEntry, ahead: number) => ({
  id: e.id,
  date: e.date,
  base: e.base,
  recipe: e.recipe ? recipeView(e.recipe, ahead) : null,
  source: e.source,
  confirmed: e.confirmed,
});
