import { z } from "zod";

const kitchenowlSchema = z.object({
  KITCHENOWL_URL: z.string().url(),
  KITCHENOWL_TOKEN: z.string().min(1),
  KITCHENOWL_HOUSEHOLD_ID: z.coerce.number().int().positive().default(2),
});

const serverSchema = kitchenowlSchema.extend({
  SESSION_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
  BASE_PATH: z
    .string()
    .regex(/^(\/[a-z0-9-]+)*$/)
    .default("/plan"),
  WEB_DIST: z.string().min(1).default("apps/web/dist"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  TRUST_PROXY: z.enum(["true", "false"]).default("true"),
});

type Config = {
  kitchenowlUrl: string;
  kitchenowlToken: string;
  householdId: number;
};

type ServerConfig = Config & {
  sessionSecret: string;
  port: number;
  /** URL prefix the app is served under, without a trailing slash; empty for the root. */
  basePath: string;
  webDist: string;
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
    sessionSecret: d.SESSION_SECRET,
    port: d.PORT,
    basePath: d.BASE_PATH,
    webDist: d.WEB_DIST,
    cookieSecure: d.COOKIE_SECURE === "true",
    trustProxy: d.TRUST_PROXY === "true",
  };
}
