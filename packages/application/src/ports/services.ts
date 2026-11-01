import type {
  LocalDateTime,
  MemberId,
  MealLogEvent,
  PlanDate,
  PlanningEvent,
  PlanningSession,
  SessionId,
} from "@weekly-planner/domain";

export type DomainEvent = PlanningEvent | MealLogEvent;

/** A date that holds a planned dinner, with the dinner's name for the form that shows it. */
export interface TakenDate {
  readonly date: PlanDate;
  readonly recipeName: string;
  /** For the recipe's picture; absent when the dinner is not known by recipe. */
  readonly recipeId?: number;
}

/** Port: what KitchenOwl's planner holds right now. */
export interface PlannerView {
  /** The dates from `from` on with an entry on the planner; null when KitchenOwl did not answer. */
  plannedDatesFrom(from: PlanDate): Promise<ReadonlySet<PlanDate> | null>;
  /** The same entries with their dinner, in date order; null when KitchenOwl did not answer. */
  entriesFrom(from: PlanDate): Promise<readonly TakenDate[] | null>;
}

/** Port: one dinner per date reaches across sessions, so the aggregate asks this. */
export interface DinnerCalendar {
  /** True when a session other than `exceptSession` has a planned dinner on `date`. */
  isDateTaken(date: PlanDate, exceptSession: SessionId): Promise<boolean>;
  /** The dates from `from` on that a session already planned a dinner for, in date order, with the dinner. */
  takenDatesFrom(from: PlanDate): Promise<readonly TakenDate[]>;
}

/** Port: told after a change has been committed. */
export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

/** Port: reaches the household members. */
export interface Notifier {
  finalizeReminder(session: PlanningSession): Promise<void>;
  /** A message to one member's phones, to show that notifications arrive. Returns how many phones were reached. */
  test(member: MemberId): Promise<number>;
}

export interface Clock {
  now(): number;
  today(): PlanDate;
  /** Wall-clock time in the household's time zone. */
  localNow(): LocalDateTime;
}

export interface IdGenerator {
  next(): string;
}

/**
 * Uniform in [0, 1); breaks ties between equally ranked suggestions. The same `key` always gives the same value,
 * so a deck keeps its order while members swipe through it; without a key the value is fresh each time.
 */
export interface Randomness {
  random(key?: string): number;
}

/** Port: the changes of one use case commit together or not at all. */
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}
