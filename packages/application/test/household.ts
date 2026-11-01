import { defaultPlanningConfig, type CatalogEntry, type Recipe } from "@weekly-planner/domain";
import {
  AcceptProposal,
  AddLoggedMeal,
  CloseSession,
  ConfirmCooked,
  CorrectLoggedMeal,
  ExportFinalizedPlan,
  FinalizePlan,
  GetCurrentSession,
  GetExport,
  GetFinalizePreview,
  GetDeck,
  GetRecipePhoto,
  ListEligibleRecipes,
  LogPlannedMeals,
  MarkLeftoverDay,
  MarkNotCooked,
  MovePlannedDay,
  PassSuggestion,
  ProposeRecipe,
  RefreshRecipes,
  RemindToFinalize,
  RetryRefusedExports,
  ReopenDay,
  RetryExport,
  StartSession,
  SuggestRecipes,
  SwapPlannedDays,
  VetoProposal,
} from "../src/index.js";
import {
  FakeClock,
  FakePlanner,
  InMemoryCatalog,
  InMemoryExports,
  InMemoryExperience,
  InMemoryMealLog,
  InMemorySessions,
  RecordingNotifier,
  RecordingPublisher,
  SequenceIds,
  SessionsDinnerCalendar,
  immediateUow,
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
  const exports = new InMemoryExports();
  const planner = new FakePlanner();
  const clock = new FakeClock();
  const ids = new SequenceIds();
  const calendar = new SessionsDinnerCalendar(sessions);
  const randomKeys: string[] = [];
  const randomness = {
    random: (key?: string) => {
      if (key !== undefined) randomKeys.push(key);
      return 0.5;
    },
  };
  const uow = immediateUow;
  const suggestRecipes = new SuggestRecipes({ sessions, catalog, mealLog, experience, clock, randomness }, config);
  const session = { sessions, events, uow };
  const exporter = new ExportFinalizedPlan({ exports, planner, events, uow });
  const logDeps = { mealLog, experience, events, uow };
  return {
    sessions,
    mealLog,
    experience,
    catalog,
    events,
    notifier,
    exports,
    planner,
    clock,
    randomKeys,
    getCurrentSession: new GetCurrentSession({ sessions, exports }),
    getExport: new GetExport(exports),
    getFinalizePreview: new GetFinalizePreview({ sessions, catalog }, config),
    retryExport: new RetryExport({ sessions, exporter }),
    retryRefusedExports: new RetryRefusedExports({ sessions, exports, exporter }),
    getRecipePhoto: new GetRecipePhoto(catalog),
    listEligibleRecipes: new ListEligibleRecipes({ sessions, catalog }, config),
    refreshRecipes: new RefreshRecipes(catalog),
    startSession: new StartSession({ ...session, ids, clock }, config),
    proposeRecipe: new ProposeRecipe({ ...session, catalog, ids }, config),
    passSuggestion: new PassSuggestion({ ...session, catalog }),
    acceptProposal: new AcceptProposal({ ...session, calendar }, config),
    vetoProposal: new VetoProposal(session),
    markLeftoverDay: new MarkLeftoverDay(session),
    reopenDay: new ReopenDay(session),
    swapPlannedDays: new SwapPlannedDays(session, config),
    movePlannedDay: new MovePlannedDay({ ...session, calendar }, config),
    finalizePlan: new FinalizePlan({ ...session, catalog, exports, exporter }, config),
    closeSession: new CloseSession(session),
    suggestRecipes,
    getDeck: new GetDeck({ sessions, experience, suggest: suggestRecipes }),
    logPlannedMeals: new LogPlannedMeals({ sessions, mealLog, events, uow, clock, ids }),
    remindToFinalize: new RemindToFinalize({ sessions, notifier, events, uow, clock }, config),
    confirmCooked: new ConfirmCooked(logDeps),
    markNotCooked: new MarkNotCooked(logDeps),
    correctLoggedMeal: new CorrectLoggedMeal({ ...logDeps, catalog }),
    addLoggedMeal: new AddLoggedMeal({ ...logDeps, catalog, ids, clock }),
  };
}
