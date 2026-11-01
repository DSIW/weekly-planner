import type { RecipeDraft, Vocabulary } from "@weekly-planner/domain";

/** Why a link could not be read. */
export type SourceFailure =
  | "invalid_address"
  | "address_not_public"
  | "unreachable"
  | "not_a_page"
  | "too_large"
  | "empty";

/** Port: the text of a web page, read safely (public addresses only, bounded in size and time). */
export interface RecipeSource {
  /** The text a language model should read for this address; a recipe's own structured data when the page has it. */
  read(address: string): Promise<{ ok: true; text: string } | { ok: false; reason: SourceFailure }>;
}

/** The extractor is not set up (no key): a member is told, nothing is attempted. */
export class ExtractorNotConfigured extends Error {
  constructor() {
    super("recipe extraction is not configured");
  }
}

/**
 * Port: a language model that reads a source and answers with a recipe. Its answer is untrusted: the use case checks
 * it before anyone sees it. It has no tools and no access to household data; it sees the vocabulary names only.
 */
export interface RecipeExtractor {
  extract(source: string, vocabulary: Vocabulary): Promise<unknown>;
}

/** Port: the household's recipe store, for the names a draft is checked against and for creating the recipe. */
export interface RecipeWriter {
  vocabulary(): Promise<Vocabulary>;
  /** Creates the recipe; returns its id there. */
  create(draft: RecipeDraft): Promise<{ recipeId: number }>;
}
