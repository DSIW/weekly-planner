import { z } from "zod";

const kitchenowlSchema = z.object({
  KITCHENOWL_URL: z.string().url(),
  KITCHENOWL_TOKEN: z.string().min(1),
  KITCHENOWL_HOUSEHOLD_ID: z.coerce.number().int().positive().default(2),
});

const serverSchema = kitchenowlSchema.extend({
  SHOPPING_LIST_ID: z.coerce.number().int().positive().default(2),
  SESSION_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_PATH: z
    .string()
    .regex(/^(\/[a-z0-9-]+)*$/)
    .default("/plan"),
  WEB_DIST: z.string().min(1).default("apps/web/dist"),
  DATABASE_PATH: z.string().min(1).default("data/planner.sqlite"),
  HOUSEHOLD_TIMEZONE: z.string().min(1).default("Europe/Berlin"),
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/)
    .default("mailto:planner@example.org"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  TRUST_PROXY: z.enum(["true", "false"]).default("true"),
});

type Config = {
  kitchenowlUrl: string;
  kitchenowlToken: string;
  householdId: number;
};

type ServerConfig = Config & {
  /** The KitchenOwl shopping list that finalizing fills. */
  shoppingListId: number;
  sessionSecret: string;
  port: number;
  /** URL prefix the app is served under, without a trailing slash; empty for the root. */
  basePath: string;
  webDist: string;
  /** The SQLite file; relative paths are relative to the working directory. */
  databasePath: string;
  /** Time zone of the household, for "today" and the reminder hour. */
  timezone: string;
  /** Who the push services can contact about this server: a `mailto:` address or an https URL. */
  vapidSubject: string;
  cookieSecure: boolean;
  trustProxy: boolean;
};

function parse<T extends z.ZodType>(schema: T, env: NodeJS.ProcessEnv): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Names only: values (tokens, secrets) never reach an error message.
    const bad = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new Error(`invalid configuration: ${bad}`);
  }
  return parsed.data;
}

const kitchenowl = (d: z.infer<typeof kitchenowlSchema>): Config => ({
  kitchenowlUrl: d.KITCHENOWL_URL.replace(/\/+$/, ""),
  kitchenowlToken: d.KITCHENOWL_TOKEN,
  householdId: d.KITCHENOWL_HOUSEHOLD_ID,
});

/** The KitchenOwl settings alone, for the command line tools. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return kitchenowl(parse(kitchenowlSchema, env));
}

/** Everything the server needs. Reads the environment only; secrets are never logged. */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const d = parse(serverSchema, env);
  return {
    ...kitchenowl(d),
    shoppingListId: d.SHOPPING_LIST_ID,
    sessionSecret: d.SESSION_SECRET,
    port: d.PORT,
    basePath: d.BASE_PATH,
    webDist: d.WEB_DIST,
    databasePath: d.DATABASE_PATH,
    timezone: d.HOUSEHOLD_TIMEZONE,
    vapidSubject: d.VAPID_SUBJECT,
    cookieSecure: d.COOKIE_SECURE === "true",
    trustProxy: d.TRUST_PROXY === "true",
  };
}
