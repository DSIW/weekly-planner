import type { InspirationReader } from "@weekly-planner/application";
import { IMPORT_LIMITS } from "@weekly-planner/domain";
import { htmlToText } from "../import/page-text.js";
import { fetchPage, type FetchLimits } from "../import/safe-fetch.js";

const LIMITS: FetchLimits = { maxBytes: 2_000_000, timeoutMs: 10_000, maxRedirects: IMPORT_LIMITS.maxRedirects };
/** What the research model gets of the page: its start is what tells where the idea came from. */
const MAX_CHARACTERS = 6_000;

interface FetchOptions extends Partial<FetchLimits> {
  allowed?: (ip: string) => boolean;
  allowedPort?: () => boolean;
}

/**
 * Adapter: the text of an idea's inspiration page, read under the import's safe-fetch rules (public addresses,
 * bounded redirects, size and time, HTML only). Whatever goes wrong, the answer is null: the research goes on without.
 */
export class WebInspirationReader implements InspirationReader {
  constructor(private readonly fetchOptions: FetchOptions = {}) {}

  async readInspiration(address: string): Promise<string | null> {
    try {
      const page = await fetchPage(address, { ...LIMITS, ...this.fetchOptions });
      if (!page.ok) return null;
      const text = htmlToText(page.html).slice(0, MAX_CHARACTERS).trim();
      return text === "" ? null : text;
    } catch {
      return null;
    }
  }
}
