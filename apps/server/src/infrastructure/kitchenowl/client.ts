import { rawRecipeListSchema, type RawRecipe } from "./schemas.js";

/** What the client needs to talk to KitchenOwl. The composition root fills it from the environment. */
export interface KitchenOwlSettings {
  readonly kitchenowlUrl: string;
  readonly kitchenowlToken: string;
  readonly householdId: number;
}

export class KitchenOwlError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KitchenOwlError";
  }
}

/** Thin client for the KitchenOwl REST API. Only what the planner needs. */
export class KitchenOwlClient {
  constructor(
    private readonly config: KitchenOwlSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${this.config.kitchenowlUrl}/api${path}`, {
      headers: { Authorization: `Bearer ${this.config.kitchenowlToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new KitchenOwlError(`KitchenOwl GET ${path} failed with HTTP ${res.status}`, res.status);
    return res.json();
  }

  async listRecipes(): Promise<RawRecipe[]> {
    const body = await this.get(`/household/${this.config.householdId}/recipe`);
    const parsed = rawRecipeListSchema.safeParse(body);
    if (!parsed.success) {
      throw new KitchenOwlError(`unexpected recipe list shape: ${parsed.error.issues[0]?.path.join(".")}`);
    }
    return parsed.data;
  }
}
