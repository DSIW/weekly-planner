import { defaultPlanningConfig, type CatalogEntry, type Recipe } from "@weekly-planner/domain";
import {
  AcceptProposal, AddLoggedMeal, CloseSession, ConfirmCooked, CorrectLoggedMeal, FinalizePlan, LogPlannedMeals, MarkLeftoverDay,
  MarkNotCooked, MovePlannedDay, PassSuggestion, ProposeRecipe, RemindToFinalize, ReopenDay, StartSession, SuggestRecipes,
  SwapPlannedDays, VetoProposal,
} from "../src/index.js";
import {
  FakeClock, InMemoryCatalog, InMemoryExperience, InMemoryMealLog, InMemorySessions, RecordingNotifier, RecordingPublisher,
  SequenceIds, SessionsDinnerCalendar, immediateUow,
} from "./support/in-memory.js";

/** The application layer wired to in-memory fakes: what the composition root will do with real adapters. */
export function household(recipes: Recipe[] = []) {
  const config = defaultPlanningConfig;
  const sessions = new InMemorySessions();
  const mealLog = new InMemoryMealLog();
  const experience = new InMemoryExperience();
  const catalog = new InMemoryCatalog(recipes.map((recipe): CatalogEntry => ({ kind: "ready", recipe })));
  const events = new RecordingPublisher();
  const notifier = new RecordingNotifier();
  const clock = new FakeClock();
  const ids = new SequenceIds();
  const calendar = new SessionsDinnerCalendar(sessions);
  const randomness = { random: () => 0.5 };
  const uow = immediateUow;
  const session = { sessions, events, uow };
  const logDeps = { mealLog, experience, events, uow };
  return {
    sessions, mealLog, experience, catalog, events, notifier, clock,
    startSession: new StartSession({ ...session, ids, clock }, config),
    proposeRecipe: new ProposeRecipe({ ...session, catalog, ids }, config),
    passSuggestion: new PassSuggestion({ ...session, catalog }),
    acceptProposal: new AcceptProposal({ ...session, calendar }, config),
    vetoProposal: new VetoProposal(session),
    markLeftoverDay: new MarkLeftoverDay(session),
    reopenDay: new ReopenDay(session),
    swapPlannedDays: new SwapPlannedDays(session, config),
    movePlannedDay: new MovePlannedDay({ ...session, calendar }, config),
    finalizePlan: new FinalizePlan(session, config),
    closeSession: new CloseSession(session),
    suggestRecipes: new SuggestRecipes({ sessions, catalog, mealLog, experience, clock, randomness }, config),
    logPlannedMeals: new LogPlannedMeals({ sessions, mealLog, events, uow, clock, ids }),
    remindToFinalize: new RemindToFinalize({ sessions, notifier, events, uow, clock }, config),
    confirmCooked: new ConfirmCooked(logDeps),
    markNotCooked: new MarkNotCooked(logDeps),
    correctLoggedMeal: new CorrectLoggedMeal({ ...logDeps, catalog }),
    addLoggedMeal: new AddLoggedMeal({ ...logDeps, catalog, ids, clock }),
  };
}
