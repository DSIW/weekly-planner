import { AuditRecipeCatalog } from "@weekly-planner/application";
import { defaultPlanningConfig } from "@weekly-planner/domain";
import { KitchenOwlClient } from "../infrastructure/kitchenowl/client.js";
import { KitchenOwlRecipeCatalog } from "../infrastructure/kitchenowl/kitchenowl-recipe-catalog.js";
import { formatAudit } from "../interface/cli/format-audit.js";
import { loadConfig } from "./config.js";

/** Entry point and composition root for `npm run recipes:check`: wires adapters to the use case. */
async function main(): Promise<void> {
  const catalog = new KitchenOwlRecipeCatalog(new KitchenOwlClient(loadConfig()));
  const audit = await new AuditRecipeCatalog(catalog, defaultPlanningConfig).execute();
  console.log(formatAudit(audit));
  if (audit.needsData.length > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
});
