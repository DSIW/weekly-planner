import { rawRecipeListSchema, type RawRecipe, authResponseSchema, householdSchema, userSchema } from "./schemas.js";

/** What the client needs to talk to KitchenOwl. The composition root fills it from the environment. */
interface KitchenOwlSettings {
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

interface KitchenOwlUser {
  readonly id: number;
  readonly name: string;
  readonly username: string;
}

/** Thin client for the KitchenOwl REST API. Only what the planner needs. */
export class KitchenOwlClient {
  constructor(
    private readonly config: KitchenOwlSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit & { token?: string }): Promise<Response> {
    const { token, ...rest } = init;
    return this.fetchImpl(`${this.config.kitchenowlUrl}/api${path}`, {
      ...rest,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers as Record<string, string>) },
      signal: AbortSignal.timeout(30_000),
    });
  }

  private async get(path: string, token = this.config.kitchenowlToken): Promise<unknown> {
    const res = await this.request(path, { token });
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

  /** A file KitchenOwl stores (a recipe photo), read with the service token; null when it is gone. */
  async fetchPhoto(file: string): Promise<{ contentType: string; data: Uint8Array } | null> {
    const res = await this.request(`/upload/${encodeURIComponent(file)}`, { token: this.config.kitchenowlToken });
    if (res.status === 404) return null;
    if (!res.ok) throw new KitchenOwlError(`KitchenOwl GET /upload failed with HTTP ${res.status}`, res.status);
    return {
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      data: new Uint8Array(await res.arrayBuffer()),
    };
  }

  /** Signs a person in with their own KitchenOwl account. Returns their access token, or null for wrong credentials. */
  async authenticate(username: string, password: string): Promise<string | null> {
    const res = await this.request("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, device: "weekly-planner" }),
    });
    if (res.status === 401 || res.status === 400) {
      // Never the credentials: only what KitchenOwl answered, so a misconfigured URL or proxy can be told apart.
      const answer = (await res.text().catch(() => "")).slice(0, 120);
      console.warn(`KitchenOwl rejected a sign-in: HTTP ${res.status} from ${this.config.kitchenowlUrl}: ${answer}`);
      return null;
    }
    if (!res.ok) throw new KitchenOwlError(`KitchenOwl sign-in failed with HTTP ${res.status}`, res.status);
    const parsed = authResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new KitchenOwlError("unexpected sign-in response shape");
    return parsed.data.access_token;
  }

  /** The account a user token belongs to. */
  async currentUser(userToken: string): Promise<KitchenOwlUser> {
    const parsed = userSchema.safeParse(await this.get("/user", userToken));
    if (!parsed.success) throw new KitchenOwlError("unexpected user response shape");
    return parsed.data;
  }

  /** Ids of the household's members, read with the service token. */
  async householdMemberIds(): Promise<number[]> {
    const parsed = householdSchema.safeParse(await this.get(`/household/${this.config.householdId}`));
    if (!parsed.success) throw new KitchenOwlError("unexpected household response shape");
    return parsed.data.member.map((m) => m.id);
  }
}
