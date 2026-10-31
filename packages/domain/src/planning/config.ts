/** The tunable numbers of the planning rules (spec: config block). */
export interface PlanningConfig {
  readonly weekdayTimeLimitMinutes: number;
  readonly householdSize: number;
  readonly varietyWindowDays: number;
  readonly recentWindowDays: number;
  readonly vegetarianShare: number;
  readonly newRecipesPerSession: number;
  readonly minDaysPerSession: number;
  readonly maxDaysPerSession: number;
  /** Hour of day on the first agreed day at which the finalize reminder is due. */
  readonly reminderHour: number;
}

export const defaultPlanningConfig: PlanningConfig = {
  weekdayTimeLimitMinutes: 45,
  householdSize: 2,
  varietyWindowDays: 2,
  recentWindowDays: 14,
  vegetarianShare: 0.66,
  newRecipesPerSession: 1,
  minDaysPerSession: 2,
  maxDaysPerSession: 3,
  reminderHour: 8,
};
