import {
  addDays,
  addLoggedMeal,
  confirmCooked,
  correctLoggedMeal,
  markNotCooked,
  mealLogEntryId,
  registerCooking,
  type Base,
  type MealLogEntry,
  type MealLogEntryId,
  type MealLogEvent,
  type MemberId,
  type PlanDate,
  type RecipeId,
  type Recipe,
  type Result,
} from "@weekly-planner/domain";
import type { RecipeCatalog } from "../ports/recipe-catalog.js";
import type { MealLogRepository, RecipeExperienceRepository } from "../ports/repositories.js";
import type { Clock, EventPublisher, IdGenerator, UnitOfWork } from "../ports/services.js";

export interface MealLogDeps {
  readonly mealLog: MealLogRepository;
  readonly experience: RecipeExperienceRepository;
  readonly events: EventPublisher;
  readonly uow: UnitOfWork;
}

export type EntryResult = Result<MealLogEntry>;

/** MealConfirmedAsCooked makes the recipe proven. Handled in the same unit of work as the entry (ARCHITECTURE §5). */
export async function registerCookings(
  deps: Pick<MealLogDeps, "experience">,
  events: readonly MealLogEvent[],
): Promise<void> {
  for (const e of events) {
    if (e.type !== "MealConfirmedAsCooked") continue;
    await deps.experience.save(registerCooking(await deps.experience.get(e.recipeId), e.recipeId, e.date));
  }
}

async function changeEntry(
  deps: MealLogDeps,
  id: MealLogEntryId,
  change: (entry: MealLogEntry) => Promise<Result<{ state: MealLogEntry; events: readonly MealLogEvent[] }>>,
  persist: (entry: MealLogEntry) => Promise<void>,
): Promise<EntryResult> {
  const result = await deps.uow.run(async () => {
    const entry = await deps.mealLog.get(id);
    if (!entry) return { ok: false, reason: "unknown_entry" } as const;
    const outcome = await change(entry);
    if (!outcome.ok) return outcome;
    await persist(outcome.value.state);
    await registerCookings(deps, outcome.value.events);
    return outcome;
  });
  if (!result.ok) return result;
  await deps.events.publish(result.value.events);
  return { ok: true, value: result.value.state };
}

/** rule ConfirmCooked */
export class ConfirmCooked {
  constructor(private readonly deps: MealLogDeps) {}
  execute(cmd: { member: MemberId; entryId: MealLogEntryId }): Promise<EntryResult> {
    return changeEntry(
      this.deps,
      cmd.entryId,
      async (e) => confirmCooked(e, cmd),
      (e) => this.deps.mealLog.save(e),
    );
  }
}

/** rule MarkNotCooked: the entry is removed, so it no longer counts for base variety. */
export class MarkNotCooked {
  constructor(private readonly deps: MealLogDeps) {}
  execute(cmd: { member: MemberId; entryId: MealLogEntryId }): Promise<EntryResult> {
    return changeEntry(
      this.deps,
      cmd.entryId,
      async (e) => markNotCooked(e, cmd),
      (e) => this.deps.mealLog.remove(e.id),
    );
  }
}

/** rule CorrectLoggedMeal */
export class CorrectLoggedMeal {
  constructor(private readonly deps: MealLogDeps & { catalog: RecipeCatalog }) {}
  async execute(cmd: {
    member: MemberId;
    entryId: MealLogEntryId;
    base: Base;
    recipeId: RecipeId | null;
  }): Promise<EntryResult> {
    const recipe = cmd.recipeId === null ? null : await this.deps.catalog.find(cmd.recipeId);
    if (cmd.recipeId !== null && !recipe) return { ok: false, reason: "unknown_recipe" };
    return changeEntry(
      this.deps,
      cmd.entryId,
      async (e) => ({ ok: true, value: correctLoggedMeal(e, { member: cmd.member, base: cmd.base, recipe }) }),
      (e) => this.deps.mealLog.save(e),
    );
  }
}

/** rule AddLoggedMeal: one meal per day, so naming a meal for a day replaces what was logged for it. */
export class AddLoggedMeal {
  constructor(private readonly deps: MealLogDeps & { catalog: RecipeCatalog; ids: IdGenerator; clock: Clock }) {}
  async execute(cmd: {
    member: MemberId;
    date: PlanDate;
    base: Base;
    recipeId: RecipeId | null;
  }): Promise<EntryResult> {
    const { deps } = this;
    const recipe = cmd.recipeId === null ? null : await deps.catalog.find(cmd.recipeId);
    if (cmd.recipeId !== null && !recipe) return { ok: false, reason: "unknown_recipe" };
    const result = await deps.uow.run(async () => {
      const outcome = addLoggedMeal(
        { id: mealLogEntryId(deps.ids.next()), member: cmd.member, date: cmd.date, base: cmd.base, recipe },
        deps.clock.today(),
      );
      if (!outcome.ok) return outcome;
      for (const old of await deps.mealLog.listSince(cmd.date))
        if (old.date === cmd.date) await deps.mealLog.remove(old.id);
      await deps.mealLog.save(outcome.value.state);
      await registerCookings(deps, outcome.value.events);
      return outcome;
    });
    if (!result.ok) return result;
    await deps.events.publish(result.value.events);
    return { ok: true, value: result.value.state };
  }
}

/** What was eaten lately, newest first: the "yesterday" card and the history list read it. */
export class ListMealLog {
  constructor(private readonly deps: { mealLog: Pick<MealLogRepository, "listSince">; clock: Pick<Clock, "today"> }) {}

  async execute(cmd: { days: number }): Promise<readonly MealLogEntry[]> {
    const entries = await this.deps.mealLog.listSince(addDays(this.deps.clock.today(), -cmd.days));
    return [...entries].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }
}

/** Every recipe that can be named for a meal, by name: to correct an entry or add a meal that was not planned. */
export class ListRecipes {
  constructor(private readonly catalog: Pick<RecipeCatalog, "listAll">) {}

  async execute(): Promise<readonly Recipe[]> {
    const entries = await this.catalog.listAll();
    return entries
      .flatMap((e) => (e.kind === "ready" && e.recipe.mealType !== "prep" ? [e.recipe] : []))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }
}
