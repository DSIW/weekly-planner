import { needsTime, isVegetarian, type Recipe } from "@weekly-planner/domain";
import { loadConfig } from "../config.js";
import { KitchenOwlClient } from "../kitchenowl/client.js";
import { deriveRecipe } from "../kitchenowl/recipeAttributes.js";

/** M0 acceptance: every recipe in KitchenOwl maps to the attributes the spec needs. */
async function main(): Promise<void> {
  const client = new KitchenOwlClient(loadConfig());
  const raw = await client.listRecipes();
  const derived = raw.map((r) => ({ raw: r, ...deriveRecipe(r) }));

  const recipes = derived.flatMap((d) => (d.recipe ? [d.recipe] : []));
  const count = <K extends string>(items: Recipe[], key: (r: Recipe) => K): string =>
    Object.entries(
      items.reduce<Record<string, number>>((acc, r) => ({ ...acc, [key(r)]: (acc[key(r)] ?? 0) + 1 }), {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");

  const mains = recipes.filter((r) => r.mealType === "main");
  const weekday = mains.filter((r) => r.totalTimeMinutes === null || r.totalTimeMinutes <= 45);
  console.log(`${raw.length} recipes read from KitchenOwl, ${recipes.length} mapped`);
  console.log(`meal types: ${count(recipes, (r) => r.mealType)}`);
  console.log(`bases: ${count(recipes, (r) => r.base)}`);
  console.log(`diets: ${count(recipes, (r) => r.diet)}`);
  console.log(`proven: ${recipes.filter((r) => r.isProven).length}, new: ${recipes.filter((r) => !r.isProven).length}, want to try: ${recipes.filter((r) => r.wantsToTry).length}`);
  console.log(`main dishes: ${mains.length} (${mains.filter(isVegetarian).length} vegetarian/vegan), usable on a weekday: ${weekday.length}`);

  const noTime = mains.filter(needsTime);
  console.log(`main dishes without a time (offered with a reminder): ${noTime.length}${noTime.length ? " -> " + noTime.map((r) => r.name).join(", ") : ""}`);

  const bad = derived.filter((d) => d.problems.length > 0);
  if (bad.length === 0) {
    console.log("\nneeds-data list: empty");
    return;
  }
  console.log(`\nneeds-data list: ${bad.length} recipe(s)`);
  for (const d of bad) console.log(`  ${d.raw.name}: ${d.problems.join("; ")}`);
  process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 2;
});
