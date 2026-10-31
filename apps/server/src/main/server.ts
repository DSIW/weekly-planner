import { SignIn } from "@weekly-planner/application";
import { KitchenOwlClient } from "../infrastructure/kitchenowl/client.js";
import { KitchenOwlHouseholdDirectory } from "../infrastructure/kitchenowl/kitchenowl-household-directory.js";
import { buildApp } from "../interface/http/app.js";
import { loadServerConfig } from "./config.js";

/** Entry point and composition root of the server: reads the environment, builds the adapters, starts HTTP. */
async function main(): Promise<void> {
  const config = loadServerConfig();
  const client = new KitchenOwlClient(config);
  const app = await buildApp({
    signIn: new SignIn(new KitchenOwlHouseholdDirectory(client)),
    sessionSecret: config.sessionSecret,
    basePath: config.basePath,
    webDist: config.webDist,
    cookieSecure: config.cookieSecure,
    trustProxy: config.trustProxy,
  });
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`weekly-planner listening on :${config.port}${config.basePath}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
