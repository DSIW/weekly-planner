import { IMPORT_LIMITS } from "@weekly-planner/domain";
import type { RecipeSource } from "@weekly-planner/application";
import { pageToSourceText } from "./page-text.js";
import { fetchPage, type FetchLimits } from "./safe-fetch.js";

const LIMITS: FetchLimits = { maxBytes: 2_000_000, timeoutMs: 10_000, maxRedirects: IMPORT_LIMITS.maxRedirects };

/** Adapter: the text of a recipe page, read safely (see `fetchPage`). */
export class WebRecipeSource implements RecipeSource {
  constructor(
    private readonly fetchOptions: {
      allowed?: (ip: string) => boolean;
      allowedPort?: () => boolean;
    } & Partial<FetchLimits> = {},
  ) {}

  async read(address: string) {
    const page = await fetchPage(address, { ...LIMITS, ...this.fetchOptions });
    if (!page.ok) return page;
    const text = pageToSourceText(page.html).trim();
    return text === "" ? ({ ok: false, reason: "empty" } as const) : ({ ok: true, text } as const);
  }
}
