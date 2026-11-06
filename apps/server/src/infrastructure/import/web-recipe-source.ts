import type { DraftImage, ImageFetcher, RecipeSource } from "@weekly-planner/application";
import { IMPORT_LIMITS } from "@weekly-planner/domain";
import { pageToSourceText, recipeImageUrl } from "./page-text.js";
import { fetchPage, fetchPicture, type FetchLimits } from "./safe-fetch.js";

const LIMITS: FetchLimits = { maxBytes: 2_000_000, timeoutMs: 10_000, maxRedirects: IMPORT_LIMITS.maxRedirects };
const PICTURE_LIMITS: FetchLimits = { ...LIMITS, maxBytes: IMPORT_LIMITS.maxImageBytes };

interface FetchOptions extends Partial<FetchLimits> {
  allowed?: (ip: string) => boolean;
  allowedPort?: () => boolean;
}

/** Adapter: the text of a recipe page, read safely (see `fetchPage`), and where its title picture is. */
export class WebRecipeSource implements RecipeSource {
  constructor(private readonly fetchOptions: FetchOptions = {}) {}

  async read(address: string) {
    const page = await fetchPage(address, { ...LIMITS, ...this.fetchOptions });
    if (!page.ok) return page;
    const text = pageToSourceText(page.html).trim();
    if (text === "") return { ok: false, reason: "empty" } as const;
    const imageUrl = recipeImageUrl(page.html, page.url);
    return { ok: true, text, ...(imageUrl ? { imageUrl } : {}) } as const;
  }
}

/** Adapter: a picture from the web, read as safely as a page and judged by its bytes. */
export class WebImageFetcher implements ImageFetcher {
  constructor(private readonly fetchOptions: FetchOptions = {}) {}

  async fetch(address: string): Promise<DraftImage | null> {
    // KitchenOwl cannot show AVIF. A WordPress site often keeps the original beside it ("a.jpg.avif" next to "a.jpg").
    const original = address.replace(/(\.(?:jpe?g|png|webp))\.avif(?=$|[?#])/i, "$1");
    for (const candidate of original === address ? [address] : [original, address]) {
      const picture = await fetchPicture(candidate, { ...PICTURE_LIMITS, ...this.fetchOptions });
      if (picture.ok) return { bytes: picture.bytes, contentType: picture.contentType };
    }
    return null;
  }
}
