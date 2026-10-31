import {
  AcceptProposal,
  CloseSession,
  GetCurrentSession,
  ListEligibleRecipes,
  ProposeRecipe,
  RefreshRecipes,
  SignIn,
  StartSession,
  VetoProposal,
} from "@weekly-planner/application";
import { defaultPlanningConfig } from "@weekly-planner/domain";
import { InProcessEventHub } from "../infrastructure/events/in-process-event-hub.js";
import { CachedRecipeCatalog } from "../infrastructure/kitchenowl/cached-recipe-catalog.js";
import { KitchenOwlClient } from "../infrastructure/kitchenowl/client.js";
import { KitchenOwlHouseholdDirectory } from "../infrastructure/kitchenowl/kitchenowl-household-directory.js";
import { KitchenOwlRecipeCatalog } from "../infrastructure/kitchenowl/kitchenowl-recipe-catalog.js";
import { openDatabase } from "../infrastructure/sqlite/database.js";
import { SqliteDinnerCalendar } from "../infrastructure/sqlite/sqlite-dinner-calendar.js";
import { SqliteSessionRepository } from "../infrastructure/sqlite/sqlite-session-repository.js";
import { SqliteUnitOfWork } from "../infrastructure/sqlite/sqlite-unit-of-work.js";
import { SystemClock, UuidGenerator } from "../infrastructure/system/system-services.js";
import { buildApp } from "../interface/http/app.js";
import { loadServerConfig } from "./config.js";

/** How long the recipe list is remembered before KitchenOwl is asked again; "refresh" in the app skips the wait. */
const RECIPE_CACHE_MS = 10 * 60_000;

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
  const planning = defaultPlanningConfig;
  const app = await buildApp({
    signIn: new SignIn(new KitchenOwlHouseholdDirectory(client)),
    getCurrentSession: new GetCurrentSession(sessions),
    startSession: new StartSession({ ...deps, ids, clock }, planning),
    closeSession: new CloseSession(deps),
    listEligibleRecipes: new ListEligibleRecipes({ sessions, catalog }, planning),
    proposeRecipe: new ProposeRecipe({ ...deps, catalog, ids }, planning),
    acceptProposal: new AcceptProposal({ ...deps, calendar }, planning),
    vetoProposal: new VetoProposal(deps),
    refreshRecipes: new RefreshRecipes(catalog),
    planAheadMinutes: planning.planAheadMinutes,
    subscribe: (listener) => hub.subscribe(listener),
    sessionSecret: config.sessionSecret,
    basePath: config.basePath,
    webDist: config.webDist,
    cookieSecure: config.cookieSecure,
    trustProxy: config.trustProxy,
  });
  const stop = async () => {
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
