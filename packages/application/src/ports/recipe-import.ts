import type { MemberId, RecipeDraft, Vocabulary } from "@weekly-planner/domain";

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
  read(address: string): Promise<{ ok: true; text: string; imageUrl?: string } | { ok: false; reason: SourceFailure }>;
}

/** A recipe's title picture: what it is is checked by its bytes, not by its name or a header. */
export interface DraftImage {
  readonly bytes: Uint8Array;
  readonly contentType: "image/jpeg" | "image/png" | "image/webp";
}

/** Port: a picture from the web, read as safely as a page (public addresses, bounded size and time). Null if it fails. */
export interface ImageFetcher {
  fetch(address: string): Promise<DraftImage | null>;
}

/** Port: pictures held for a short while between the draft and the creation, under a token only the planner knows. */
export interface ImageShelf {
  keep(image: DraftImage): string;
  get(token: string): DraftImage | null;
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
  /** Creates the recipe, with its picture if given and accepted; returns its id there. */
  create(draft: RecipeDraft, image?: DraftImage): Promise<{ recipeId: number; photoAttached: boolean }>;
}

/** Port: the drafts members asked for (a model was about to be asked), kept to count against the hourly allowance. */
export interface DraftRequestLog {
  add(request: { requestedBy: MemberId; requestedAt: number }): Promise<void>;
  /** Drafts asked for at or after `from` (epoch ms), oldest first. */
  listSince(from: number): Promise<readonly { requestedBy: MemberId; requestedAt: number }[]>;
}
