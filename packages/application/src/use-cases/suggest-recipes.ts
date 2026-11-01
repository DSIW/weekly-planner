import {
  addDays,
  nextOpenDay,
  suggestRecipes,
  type PlanningConfig,
  type Recipe,
  type RecipeId,
  type SessionId,
} from "@weekly-planner/domain";
import type { RecipeCatalog } from "../ports/recipe-catalog.js";
import type { MealLogRepository, RecipeExperienceRepository, SessionRepository } from "../ports/repositories.js";
import type { Clock, Randomness } from "../ports/services.js";

export interface SuggestRecipesDeps {
  readonly sessions: Pick<SessionRepository, "get" | "listAll">;
  readonly catalog: Pick<RecipeCatalog, "listAll">;
  readonly mealLog: Pick<MealLogRepository, "listSince">;
  readonly experience: Pick<RecipeExperienceRepository, "allRecipeIds">;
  readonly clock: Clock;
  readonly randomness: Randomness;
}

/** The deck for the next open day of a session, ranked. Read-only. */
export class SuggestRecipes {
  constructor(
    private readonly deps: SuggestRecipesDeps,
    private readonly config: PlanningConfig,
  ) {}

  async execute(cmd: { sessionId: SessionId }): Promise<readonly Recipe[]> {
    const { deps, config } = this;
    const session = await deps.sessions.get(cmd.sessionId);
    const day = session && nextOpenDay(session);
    if (!session || !day) return [];

    const entries = await deps.catalog.listAll();
    const candidates = entries.flatMap((e) => (e.kind === "ready" ? [e.recipe] : []));
    const log = await deps.mealLog.listSince(addDays(day.date, -config.varietyWindowDays));
    // A plan that was thrown away without being finalized is not what the household cooks: it does not count.
    const others = (await deps.sessions.listAll()).filter(
      (s) => s.id !== session.id && (s.status === "finalized" || s.wasFinalized === true),
    );
    // What was cooked, and what another session planned: both count towards base variety, planned or not yet logged.
    const history = [
      ...log.map((e) => ({ date: e.date, base: e.base })),
      ...others.flatMap((s) =>
        s.days.flatMap((d) => (d.status === "planned" && d.recipe ? [{ date: d.date, base: d.recipe.base }] : [])),
      ),
    ];
    const recentSince = addDays(deps.clock.today(), -config.recentWindowDays);
    const recentlyPlanned = new Set<RecipeId>(
      others.flatMap((s) =>
        s.days.flatMap((d) => (d.status === "planned" && d.recipe && d.date >= recentSince ? [d.recipe.id] : [])),
      ),
    );
    return suggestRecipes({
      session,
      candidates,
      history,
      recentlyPlanned,
      experienced: await deps.experience.allRecipeIds(),
      config,
      random: (recipe) => deps.randomness.random(`${session.id}:${recipe.id}`),
    });
  }
}
