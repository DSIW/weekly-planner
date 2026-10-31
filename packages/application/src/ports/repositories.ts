import type {
  MealLogEntry, MealLogEntryId, PlanDate, PlanningSession, RecipeExperience, RecipeId, SessionId,
} from "@weekly-planner/domain";

/** Port: planning sessions are loaded and saved whole. */
export interface SessionRepository {
  get(id: SessionId): Promise<PlanningSession | null>;
  save(session: PlanningSession): Promise<void>;
  listAll(): Promise<readonly PlanningSession[]>;
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
