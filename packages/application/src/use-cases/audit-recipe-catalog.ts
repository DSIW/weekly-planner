import {
  fitsWeekdayLimit,
  isDinnerCandidate,
  isVegetarian,
  needsTime,
  type PlanningConfig,
  type Recipe,
} from "@weekly-planner/domain";
import type { RecipeCatalog } from "../ports/recipe-catalog.js";

export interface CatalogAudit {
  readonly total: number;
  readonly ready: number;
  readonly byMealType: Readonly<Record<string, number>>;
  readonly byBase: Readonly<Record<string, number>>;
  readonly byDiet: Readonly<Record<string, number>>;
  readonly proven: number;
  readonly unproven: number;
  readonly wantsToTry: number;
  readonly mains: number;
  readonly vegetarianMains: number;
  readonly weekdayMains: number;
  readonly mainsWithoutTime: readonly string[];
  readonly needsData: readonly { readonly name: string; readonly problems: readonly string[] }[];
}

const tally = (recipes: readonly Recipe[], key: (r: Recipe) => string): Record<string, number> =>
  recipes.reduce<Record<string, number>>((acc, r) => ({ ...acc, [key(r)]: (acc[key(r)] ?? 0) + 1 }), {});

/** Use case: do all recipes carry the attributes the planning rules need? Read-only. */
export class AuditRecipeCatalog {
  constructor(
    private readonly catalog: Pick<RecipeCatalog, "listAll">,
    private readonly config: Pick<PlanningConfig, "weekdayTimeLimitMinutes">,
  ) {}

  async execute(): Promise<CatalogAudit> {
    const entries = await this.catalog.listAll();
    const recipes = entries.flatMap((e) => (e.kind === "ready" ? [e.recipe] : []));
    const mains = recipes.filter(isDinnerCandidate);
    return {
      total: entries.length,
      ready: recipes.length,
      byMealType: tally(recipes, (r) => r.mealType),
      byBase: tally(recipes, (r) => r.base),
      byDiet: tally(recipes, (r) => r.diet),
      proven: recipes.filter((r) => r.isProven).length,
      unproven: recipes.filter((r) => !r.isProven).length,
      wantsToTry: recipes.filter((r) => r.wantsToTry).length,
      mains: mains.length,
      vegetarianMains: mains.filter(isVegetarian).length,
      weekdayMains: mains.filter((r) => fitsWeekdayLimit(r, this.config.weekdayTimeLimitMinutes)).length,
      mainsWithoutTime: mains.filter(needsTime).map((r) => r.name),
      needsData: entries.flatMap((e) => (e.kind === "needs-data" ? [{ name: e.name, problems: e.problems }] : [])),
    };
  }
}
