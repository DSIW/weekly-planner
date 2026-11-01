import {
  AcceptProposal,
  CreateImportedRecipe,
  MatchIngredients,
  DraftRecipeImport,
  AgreeInPerson,
  AddLoggedMeal,
  ConfirmCooked,
  CorrectLoggedMeal,
  ListMealLog,
  ListRecipes,
  ListTakenDates,
  ReleaseRemovedDinners,
  LogPlannedMeals,
  MarkNotCooked,
  RemoveLoggedMeal,
  CloseSession,
  ExportFinalizedPlan,
  FinalizePlan,
  GetCurrentSession,
  GetDeck,
  GetExport,
  GetFinalizePreview,
  GetItemIcons,
  GetRecipePhoto,
  PassSuggestion,
  ListEligibleRecipes,
  MarkLeftoverDay,
  MovePlannedDay,
  ProposeRecipe,
  RefreshRecipes,
  ReopenDay,
  RemindToFinalize,
  RetryExport,
  RetryRefusedExports,
  SendTestNotification,
  SubscribeToPush,
  UnsubscribeFromPush,
  WithdrawProposal,
  SignIn,
  StartSession,
  SuggestRecipes,
  SwapPlannedDays,
  VetoProposal,
} from "@weekly-planner/application";
import { defaultPlanningConfig } from "@weekly-planner/domain";
import webpush from "web-push";
import { InProcessEventHub } from "../infrastructure/events/in-process-event-hub.js";
import { CachedRecipeCatalog } from "../infrastructure/kitchenowl/cached-recipe-catalog.js";
import { KitchenOwlClient } from "../infrastructure/kitchenowl/client.js";
import { KitchenOwlHouseholdDirectory } from "../infrastructure/kitchenowl/kitchenowl-household-directory.js";
import { KitchenOwlPlannerGateway } from "../infrastructure/kitchenowl/kitchenowl-planner-gateway.js";
import { LlmRecipeExtractor } from "../infrastructure/import/llm-extractor.js";
import { WebRecipeSource } from "../infrastructure/import/web-recipe-source.js";
import { KitchenOwlRecipeWriter } from "../infrastructure/kitchenowl/kitchenowl-recipe-writer.js";
import { KitchenOwlPlannerView } from "../infrastructure/kitchenowl/kitchenowl-planner-view.js";
import { KitchenOwlRecipeCatalog } from "../infrastructure/kitchenowl/kitchenowl-recipe-catalog.js";
import { loadOrCreateVapidKeys } from "../infrastructure/push/vapid-keys.js";
import { WebPushNotifier } from "../infrastructure/push/web-push-notifier.js";
import { startScheduler } from "../infrastructure/scheduling/scheduler.js";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { SqliteDinnerCalendar } from "../infrastructure/sqlite/sqlite-dinner-calendar.js";
import { SqliteMealLogRepository } from "../infrastructure/sqlite/sqlite-meal-log-repository.js";
import { SqliteRecipeExperienceRepository } from "../infrastructure/sqlite/sqlite-recipe-experience-repository.js";
import { SqliteExportRepository } from "../infrastructure/sqlite/sqlite-export-repository.js";
import { SqlitePushSubscriptions } from "../infrastructure/sqlite/sqlite-push-subscriptions.js";
import { SqliteSessionRepository } from "../infrastructure/sqlite/sqlite-session-repository.js";
import { SqliteUnitOfWork } from "../infrastructure/sqlite/sqlite-unit-of-work.js";
import { SystemClock, SystemRandomness, UuidGenerator } from "../infrastructure/system/system-services.js";
import { buildApp } from "../interface/http/app.js";
import { loadServerConfig } from "./config.js";

/** How long the recipe list is remembered before KitchenOwl is asked again; "refresh" in the app skips the wait. */
const RECIPE_CACHE_MS = 10 * 60_000;

/** How often the reminder is checked: the first agreed morning is hit within a minute. */
const REMINDER_CHECK_MS = 60_000;
/** How often planned dinners of yesterday and before are turned into log entries (idempotent, so often is fine). */
const MEAL_LOG_CHECK_MS = 15 * 60_000;
/** Spec config export_retry_interval: how often refused export steps are sent again. */
const EXPORT_RETRY_MS = 15 * 60_000;

/** Entry point and composition root of the server: reads the environment, builds the adapters, starts HTTP. */
async function main(): Promise<void> {
  const config = loadServerConfig();
  const client = new KitchenOwlClient(config);
  const db = openDatabase(config.databasePath);
  const hub = new InProcessEventHub();
  const sessions = new SqliteSessionRepository(db);
  const deps = { sessions, events: hub, uow: new SqliteUnitOfWork(db) };
  const clock = new SystemClock(config.timezone);
  const ids = new UuidGenerator();
  const catalog = new CachedRecipeCatalog(new KitchenOwlRecipeCatalog(client), RECIPE_CACHE_MS);
  const calendar = new SqliteDinnerCalendar(db);
  const exports = new SqliteExportRepository(db);
  const exporter = new ExportFinalizedPlan({
    exports,
    planner: new KitchenOwlPlannerGateway(client, config.shoppingListId),
    events: hub,
    uow: deps.uow,
  });
  const planning = defaultPlanningConfig;
  const vapid = loadOrCreateVapidKeys(db, () => webpush.generateVAPIDKeys());
  const pushSubscriptions = new SqlitePushSubscriptions(db);
  const notifier = new WebPushNotifier(
    pushSubscriptions,
    (s, payload) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        vapidDetails: { subject: config.vapidSubject, ...vapid },
        TTL: 12 * 3600,
      }),
    `${config.basePath}/`,
  );
  const mealLog = new SqliteMealLogRepository(db);
  const experience = new SqliteRecipeExperienceRepository(db);
  const logDeps = { mealLog, experience, events: hub, uow: deps.uow };
  const suggest = new SuggestRecipes(
    { sessions, catalog, mealLog, experience, clock, randomness: new SystemRandomness() },
    planning,
  );
  const release = new ReleaseRemovedDinners({
    sessions,
    exports,
    planner: new KitchenOwlPlannerView(client),
    events: hub,
    uow: deps.uow,
    clock,
  });
  const recipeWriter = new KitchenOwlRecipeWriter(client);
  const app = await buildApp({
    signIn: new SignIn(new KitchenOwlHouseholdDirectory(client)),
    getCurrentSession: new GetCurrentSession({ sessions, exports }),
    startSession: new StartSession({ ...deps, ids, clock, calendar }, planning),
    listTakenDates: new ListTakenDates({ calendar, clock, release, planner: new KitchenOwlPlannerView(client) }),
    closeSession: new CloseSession(deps),
    listEligibleRecipes: new ListEligibleRecipes({ sessions, catalog }, planning),
    proposeRecipe: new ProposeRecipe({ ...deps, catalog, ids }, planning),
    draftRecipeImport: new DraftRecipeImport({
      source: new WebRecipeSource(),
      extractor: new LlmRecipeExtractor(config.llm),
      writer: recipeWriter,
    }),
    createImportedRecipe: new CreateImportedRecipe({ writer: recipeWriter }),
    matchIngredients: new MatchIngredients({ writer: recipeWriter }),
    acceptProposal: new AcceptProposal({ ...deps, calendar }, planning),
    agreeInPerson: new AgreeInPerson(new AcceptProposal({ ...deps, calendar }, planning)),
    vetoProposal: new VetoProposal(deps),
    withdrawProposal: new WithdrawProposal(deps),
    refreshRecipes: new RefreshRecipes(catalog),
    getDeck: new GetDeck({ sessions, experience, suggest }),
    passSuggestion: new PassSuggestion({ ...deps, catalog }),
    markLeftoverDay: new MarkLeftoverDay(deps),
    reopenDay: new ReopenDay(deps),
    swapPlannedDays: new SwapPlannedDays(deps, planning),
    movePlannedDay: new MovePlannedDay({ ...deps, calendar }, planning),
    getRecipePhoto: new GetRecipePhoto(catalog),
    getItemIcons: new GetItemIcons(catalog),
    getExport: new GetExport(exports),
    getFinalizePreview: new GetFinalizePreview({ sessions, catalog }, planning),
    finalizePlan: new FinalizePlan({ ...deps, catalog, exports, exporter }, planning),
    retryExport: new RetryExport({ sessions, exporter }),
    listMealLog: new ListMealLog({ mealLog, clock }),
    listRecipes: new ListRecipes(catalog),
    confirmCooked: new ConfirmCooked(logDeps),
    markNotCooked: new MarkNotCooked(logDeps),
    removeLoggedMeal: new RemoveLoggedMeal(logDeps),
    correctLoggedMeal: new CorrectLoggedMeal({ ...logDeps, catalog }),
    addLoggedMeal: new AddLoggedMeal({ ...logDeps, catalog, ids, clock }),
    subscribeToPush: new SubscribeToPush(pushSubscriptions),
    sendTestNotification: new SendTestNotification(notifier),
    unsubscribeFromPush: new UnsubscribeFromPush(pushSubscriptions),
    pushPublicKey: vapid.publicKey,
    planAheadMinutes: planning.planAheadMinutes,
    links: { kitchenowl: config.kitchenowlPublicUrl, householdId: config.householdId },
    subscribe: (listener) => hub.subscribe(listener),
    sessionSecret: config.sessionSecret,
    basePath: config.basePath,
    webDist: config.webDist,
    cookieSecure: config.cookieSecure,
    trustProxy: config.trustProxy,
  });
  const remind = new RemindToFinalize({ sessions, notifier, events: hub, uow: deps.uow, clock }, planning);
  const retryRefused = new RetryRefusedExports({ sessions, exports, exporter });
  const logMeals = new LogPlannedMeals({ sessions, mealLog, events: hub, uow: deps.uow, clock, ids });
  const stopJobs = startScheduler([
    { name: "remind-to-finalize", everyMs: REMINDER_CHECK_MS, run: () => remind.execute() },
    { name: "log-planned-meals", everyMs: MEAL_LOG_CHECK_MS, run: () => logMeals.execute() },
    { name: "retry-refused-exports", everyMs: EXPORT_RETRY_MS, run: () => retryRefused.execute() },
    { name: "release-removed-dinners", everyMs: MEAL_LOG_CHECK_MS, run: () => release.execute() },
  ]);
  const stop = async () => {
    stopJobs();
    await app.close();
    db.close();
  };
  process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
  process.once("SIGINT", () => void stop().then(() => process.exit(0)));
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`weekly-planner listening on :${config.port}${config.basePath} (database ${config.databasePath})`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
