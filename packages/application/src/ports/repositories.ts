import type {
  MealLogEntry,
  MealLogEntryId,
  PlanDate,
  PlanningSession,
  RecipeExperience,
  RecipeId,
  SessionId,
} from "@weekly-planner/domain";

/** Storage refused a second open session: another start won the race between the check and the save. */
export class OpenSessionConflict extends Error {
  constructor() {
    super("another session is already open");
    this.name = "OpenSessionConflict";
  }
}

/** Storage refused a second planned dinner on one date: another session took it between the check and the save. */
export class DateTakenConflict extends Error {
  constructor() {
    super("another session already planned a dinner on that date");
    this.name = "DateTakenConflict";
  }
}

/** Port: planning sessions are loaded and saved whole. */
export interface SessionRepository {
  get(id: SessionId): Promise<PlanningSession | null>;
  /** Throws `OpenSessionConflict` when it would leave two sessions open, `DateTakenConflict` for a doubled date. */
  save(session: PlanningSession): Promise<void>;
  listAll(): Promise<readonly PlanningSession[]>;
  /** The session that is still open, if any. The household has at most one. */
  findOpen(): Promise<PlanningSession | null>;
}

/** Port: the meal log. */
export interface MealLogRepository {
  get(id: MealLogEntryId): Promise<MealLogEntry | null>;
  save(entry: MealLogEntry): Promise<void>;
  /** Removes the entry but remembers that its planned date was logged, so the daily job does not log it again. */
  remove(id: MealLogEntryId): Promise<void>;
  /** Entries dated on or after `from`. */
  listSince(from: PlanDate): Promise<readonly MealLogEntry[]>;
  /** Dates whose planned dinner was already logged, including entries removed since. */
  loggedPlanDates(): Promise<ReadonlySet<PlanDate>>;
}

/** Port: which recipes the household has confirmed cooking. */
export interface RecipeExperienceRepository {
  get(recipeId: RecipeId): Promise<RecipeExperience | null>;
  save(experience: RecipeExperience): Promise<void>;
  allRecipeIds(): Promise<ReadonlySet<RecipeId>>;
}
