import { z } from "zod";

const schema = z.object({
  KITCHENOWL_URL: z.string().url(),
  KITCHENOWL_TOKEN: z.string().min(1),
  KITCHENOWL_HOUSEHOLD_ID: z.coerce.number().int().positive().default(2),
});

export type Config = {
  kitchenowlUrl: string;
  kitchenowlToken: string;
  householdId: number;
};

/** Reads the configuration from the environment. The token is never logged. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse({
    KITCHENOWL_URL: env.KITCHENOWL_URL ?? "https://kitchenowl.s.dsiw-it.de",
    KITCHENOWL_TOKEN: env.KITCHENOWL_TOKEN,
    KITCHENOWL_HOUSEHOLD_ID: env.KITCHENOWL_HOUSEHOLD_ID,
  });
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`invalid configuration: ${missing}`);
  }
  return {
    kitchenowlUrl: parsed.data.KITCHENOWL_URL.replace(/\/+$/, ""),
    kitchenowlToken: parsed.data.KITCHENOWL_TOKEN,
    householdId: parsed.data.KITCHENOWL_HOUSEHOLD_ID,
  };
}
