import type { RecipeIdea, RecipeIdeaId, ResearchRequest } from "@weekly-planner/domain";

/** Port: the household's recipe ideas. */
export interface RecipeIdeaRepository {
  get(id: RecipeIdeaId): Promise<RecipeIdea | null>;
  save(idea: RecipeIdea): Promise<void>;
  /** Removes the idea with its candidates; nothing happens if it is gone. */
  remove(id: RecipeIdeaId): Promise<void>;
  listAll(): Promise<readonly RecipeIdea[]>;
}

/** Port: researches that brought usable candidates, kept to count against the hourly limit. */
export interface ResearchRequestLog {
  add(request: ResearchRequest): Promise<void>;
  /** Requests made at or after `from` (epoch ms). */
  listSince(from: number): Promise<readonly ResearchRequest[]>;
}

/** The research model is not set up (no key): a member is told, nothing is attempted. */
export class ResearchNotConfigured extends Error {
  constructor() {
    super("idea research is not configured");
  }
}

/**
 * Port: a language model that may search the web and proposes recipes for an idea. It gets the idea's title and note
 * and, when it could be read, the text of the idea's inspiration page (as data, never instructions); nothing of the
 * household's. Its answer is untrusted: the use case checks it before anyone sees it.
 */
export interface IdeaResearcher {
  research(query: { title: string; note: string | null; inspiration: string | null }): Promise<unknown>;
}

/**
 * Port: the text behind an idea's inspiration link, read under the import's safe-fetch rules (public addresses, bounded
 * redirects, size and time, HTML only). Null when the link cannot be read; it must not throw.
 */
export interface InspirationReader {
  readInspiration(address: string): Promise<string | null>;
}
