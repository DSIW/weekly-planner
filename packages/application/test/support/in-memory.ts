import {
  localDateTime,
  memberId,
  planDate,
  recipeId,
  type CatalogEntry,
  type FinalizeExport,
  type MealLogEntry,
  type MealLogEntryId,
  type PlanDate,
  type PlanningSession,
  type Recipe,
  type RecipeExperience,
  type RecipeId,
  type SessionId,
} from "@weekly-planner/domain";
import type {
  Clock,
  DinnerCalendar,
  DomainEvent,
  EventPublisher,
  ExportRepository,
  IdGenerator,
  MealLogRepository,
  Notifier,
  PlannerEntry,
  PlannerGateway,
  PlannerView,
  RecipeCatalog,
  RecipeExperienceRepository,
  SessionRepository,
  ShoppingListItem,
  UnitOfWork,
} from "../../src/index.js";

export class InMemorySessions implements SessionRepository {
  readonly byId = new Map<SessionId, PlanningSession>();
  async get(id: SessionId) {
    return this.byId.get(id) ?? null;
  }
  async save(s: PlanningSession) {
    this.byId.set(s.id, s);
  }
  async listAll() {
    return [...this.byId.values()];
  }
  async findOpen() {
    return [...this.byId.values()].find((s) => s.status === "open") ?? null;
  }
}

export class InMemoryExports implements ExportRepository {
  readonly bySession = new Map<SessionId, FinalizeExport>();
  async get(id: SessionId) {
    return this.bySession.get(id) ?? null;
  }
  async save(e: FinalizeExport) {
    this.bySession.set(e.sessionId, e);
  }
}

/** Records what would reach KitchenOwl. `failWith` makes the next requests throw, once per queued error. */
export class FakePlanner implements PlannerGateway {
  readonly entries: PlannerEntry[] = [];
  readonly batches: (readonly ShoppingListItem[])[] = [];
  readonly failures: Error[] = [];
  private maybeFail() {
    const error = this.failures.shift();
    if (error) throw error;
  }
  async addPlannerEntry(entry: PlannerEntry) {
    this.maybeFail();
    this.entries.push(entry);
  }
  async addShoppingListItems(items: readonly ShoppingListItem[]) {
    this.maybeFail();
    this.batches.push(items);
  }
}

export class InMemoryMealLog implements MealLogRepository {
  readonly entries = new Map<MealLogEntryId, MealLogEntry>();
  private readonly planDates = new Set<PlanDate>();
  async get(id: MealLogEntryId) {
    return this.entries.get(id) ?? null;
  }
  async save(e: MealLogEntry) {
    this.entries.set(e.id, e);
    if (e.source === "from_plan") this.planDates.add(e.date);
  }
  async remove(id: MealLogEntryId) {
    this.entries.delete(id);
  }
  async listSince(from: PlanDate) {
    return [...this.entries.values()].filter((e) => e.date >= from);
  }
  async loggedPlanDates() {
    return this.planDates;
  }
}

export class InMemoryExperience implements RecipeExperienceRepository {
  readonly byRecipe = new Map<RecipeId, RecipeExperience>();
  async get(id: RecipeId) {
    return this.byRecipe.get(id) ?? null;
  }
  async save(x: RecipeExperience) {
    this.byRecipe.set(x.recipeId, x);
  }
  async allRecipeIds() {
    return new Set(this.byRecipe.keys());
  }
}

export class InMemoryCatalog implements RecipeCatalog {
  refreshes = 0;
  constructor(public entries: CatalogEntry[] = []) {}
  async refresh() {
    this.refreshes++;
  }
  photos = new Map<RecipeId, { contentType: string; data: Uint8Array }>();
  async photo(id: RecipeId) {
    return this.photos.get(id) ?? null;
  }
  itemFont: { contentType: string; data: Uint8Array } | null = null;
  async itemIcons() {
    return this.itemFont;
  }
  async listAll() {
    return this.entries;
  }
  async find(id: RecipeId) {
    const e = this.entries.find((x) => x.kind === "ready" && x.recipe.id === id);
    return e?.kind === "ready" ? e.recipe : null;
  }
}

/** Looks at the sessions held by the repository, the way the SQLite adapter will query its table. */
export class SessionsDinnerCalendar implements DinnerCalendar {
  constructor(private readonly sessions: InMemorySessions) {}
  async isDateTaken(date: PlanDate, except: SessionId) {
    return [...this.sessions.byId.values()].some(
      (s) =>
        s.id !== except &&
        s.status !== "closed" &&
        s.days.some((d) => d.date === date && d.status === "planned" && !d.removedInPlanner),
    );
  }
  async takenDatesFrom(from: PlanDate) {
    return [...this.sessions.byId.values()]
      .filter((s) => s.status !== "closed")
      .flatMap((s) =>
        s.days
          .filter((d) => d.status === "planned" && !d.removedInPlanner && d.date >= from)
          .map((d) => ({ date: d.date, recipeName: d.recipe?.name ?? "" })),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}

/** What KitchenOwl's planner holds, set by the test; null stands for "KitchenOwl did not answer". */
export class FakePlannerView implements PlannerView {
  dates: Set<PlanDate> | null = null;
  /** What the planner holds besides bare dates: the dinners by date, for the taken dates. */
  dinners = new Map<PlanDate, { recipeName: string; recipeId?: number }>();
  async plannedDatesFrom(from: PlanDate) {
    return this.dates ? new Set([...this.dates].filter((d) => d >= from)) : null;
  }
  async entriesFrom(from: PlanDate) {
    if (!this.dates) return null;
    return [...this.dates]
      .filter((d) => d >= from)
      .sort()
      .map((date) => ({ date, recipeName: "", ...this.dinners.get(date) }));
  }
}

export class RecordingPublisher implements EventPublisher {
  readonly published: DomainEvent[] = [];
  async publish(events: readonly DomainEvent[]) {
    this.published.push(...events);
  }
  get types() {
    return this.published.map((e) => e.type);
  }
}

export class RecordingNotifier implements Notifier {
  readonly reminders: SessionId[] = [];
  async test() {
    return 0;
  }
  async finalizeReminder(s: PlanningSession) {
    this.reminders.push(s.id);
  }
}

export class FakeClock implements Clock {
  constructor(
    public date: PlanDate = planDate("2026-11-01"),
    public hour = 12,
  ) {}
  now() {
    return Date.parse(`${this.date}T${String(this.hour).padStart(2, "0")}:00:00Z`);
  }
  today() {
    return this.date;
  }
  localNow() {
    return localDateTime(this.date, this.hour);
  }
}

export class SequenceIds implements IdGenerator {
  private n = 0;
  next() {
    return `id${++this.n}`;
  }
}

/** Commits immediately; a failing unit of work leaves earlier writes in place, as the fakes have no transactions. */
export const immediateUow: UnitOfWork = { run: (work) => work() };

export const AC = memberId("AC");
export const ME = memberId("me");

export const aRecipe = (id: number, over: Partial<Recipe> = {}): Recipe => ({
  id: recipeId(id),
  name: `Rezept ${id}`,
  mealType: "main",
  base: "other",
  diet: "vegetarian",
  totalTimeMinutes: 30,
  isProven: true,
  wantsToTry: false,
  yields: 2,
  ...over,
});
