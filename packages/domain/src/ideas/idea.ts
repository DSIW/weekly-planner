import { cleanText } from "../import/draft.js";
import type { MemberId } from "../shared/ids.js";
import { reject, succeed, type Result } from "../shared/result.js";

// spec/recipe-ideas.allium: dishes the household might cook some day, noted before there is a recipe for them.

export type RecipeIdeaId = string & { readonly __brand: "RecipeIdeaId" };
export const recipeIdeaId = (s: string): RecipeIdeaId => s as RecipeIdeaId;

const HOUR_MS = 3_600_000;

/** spec config. */
export interface IdeaConfig {
  readonly maxCandidates: number;
  readonly ideaStaleAfterMs: number;
  /** Per member. */
  readonly maxResearchPerHour: number;
}

export const defaultIdeaConfig: IdeaConfig = {
  maxCandidates: 5,
  ideaStaleAfterMs: 8 * 7 * 24 * HOUR_MS,
  maxResearchPerHour: 20,
};

/** One recipe the research model proposes for an idea, after the checks in `reviewCandidates`. */
export interface CandidateProposal {
  readonly title: string;
  readonly link: string;
  readonly summary: string;
}

export interface RecipeIdea {
  readonly id: RecipeIdeaId;
  readonly title: string;
  readonly note: string | null;
  /** Where the idea came from; shown, and read by research (under the safe-fetch rules). */
  readonly inspirationLink: string | null;
  readonly addedBy: MemberId;
  readonly addedAt: number;
  /** Moved on by what a member does with the idea; merely looking at it does not count. */
  readonly lastTouchedAt: number;
  /** Set while the idea is put aside: out of the list and cleanup, everything else kept. Null in the list. */
  readonly archivedAt: number | null;
  readonly candidates: readonly CandidateProposal[];
}

/** A research a member asked for, kept to count against the hourly limit. */
export interface ResearchRequest {
  readonly requestedBy: MemberId;
  readonly requestedAt: number;
}

/** rule NoteIdea */
export function noteIdea(
  cmd: { id: RecipeIdeaId; member: MemberId; title: string; note?: string; inspirationLink?: string },
  now: number,
): Result<RecipeIdea> {
  if (cmd.title.trim() === "") return reject("empty_title");
  return succeed({
    id: cmd.id,
    title: cmd.title,
    note: cmd.note ?? null,
    inspirationLink: cmd.inspirationLink ?? null,
    addedBy: cmd.member,
    addedAt: now,
    lastTouchedAt: now,
    archivedAt: null,
    candidates: [],
  });
}

/** rule EditIdea: keeps who noted the idea, when, and its candidates. */
export function editIdea(
  idea: RecipeIdea,
  cmd: { member: MemberId; title: string; note?: string; inspirationLink?: string },
  now: number,
): Result<RecipeIdea> {
  if (idea.archivedAt !== null) return reject("archived");
  if (cmd.title.trim() === "") return reject("empty_title");
  return succeed({
    ...idea,
    title: cmd.title,
    note: cmd.note ?? null,
    inspirationLink: cmd.inspirationLink ?? null,
    lastTouchedAt: now,
  });
}

/** Derived is_stale: only a mark, the idea stays until a member keeps, archives or deletes it; never for an archived idea. */
export const isStale = (idea: RecipeIdea, now: number, config: IdeaConfig): boolean =>
  idea.archivedAt === null && idea.lastTouchedAt + config.ideaStaleAfterMs <= now;

/** rule ArchiveIdea: put aside without touching the idea's clock; note, link and candidates stay. */
export function archiveIdea(idea: RecipeIdea, _cmd: { member: MemberId }, now: number): Result<RecipeIdea> {
  if (idea.archivedAt !== null) return reject("already_archived");
  return succeed({ ...idea, archivedAt: now });
}

/** rule RestoreIdea: back in the list, with its clock started again so it does not return stale. */
export function restoreIdea(idea: RecipeIdea, _cmd: { member: MemberId }, now: number): Result<RecipeIdea> {
  if (idea.archivedAt === null) return reject("not_archived");
  return succeed({ ...idea, archivedAt: null, lastTouchedAt: now });
}

/** rule KeepIdea: keeping a stale idea starts its clock again. */
export function keepIdea(
  idea: RecipeIdea,
  _cmd: { member: MemberId },
  now: number,
  config: IdeaConfig,
): Result<RecipeIdea> {
  if (!isStale(idea, now, config)) return reject("not_stale");
  return succeed({ ...idea, lastTouchedAt: now });
}

const MAX_CANDIDATE_TITLE = 120;
const MAX_CANDIDATE_SUMMARY = 300;
const MAX_CANDIDATE_LINK = 500;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const webLink = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const link = value.trim();
  if (link === "" || link.length > MAX_CANDIDATE_LINK) return null;
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:" ? link : null;
  } catch {
    return null;
  }
};

/**
 * The research model's answer, whatever it is, as candidate proposals: text without links or markup, only http(s)
 * links, at most `maxCandidates`. An answer that does not fit the shape gives nothing.
 */
export function reviewCandidates(raw: unknown, config: IdeaConfig): CandidateProposal[] {
  if (!isObject(raw) || !Array.isArray(raw.candidates)) return [];
  const found: CandidateProposal[] = [];
  for (const entry of raw.candidates) {
    if (!isObject(entry)) continue;
    const link = webLink(entry.link);
    const title = cleanText(entry.title, MAX_CANDIDATE_TITLE);
    if (link === null || title === "") continue;
    found.push({ title, link, summary: cleanText(entry.summary, MAX_CANDIDATE_SUMMARY) });
  }
  return found.slice(0, Math.max(0, config.maxCandidates));
}

/**
 * rule ReplaceCandidates: a new research replaces the earlier candidates. No candidate (or too many) changes
 * nothing, so the idea keeps its candidates and its clock.
 */
export function replaceCandidates(
  idea: RecipeIdea,
  found: readonly CandidateProposal[],
  now: number,
  config: IdeaConfig,
): Result<RecipeIdea> {
  if (found.length < 1) return reject("no_candidates");
  if (found.length > config.maxCandidates) return reject("too_many_candidates");
  return succeed({ ...idea, candidates: [...found], lastTouchedAt: now });
}

/** rule PickCandidate: the candidate's link goes to the import as its source; the idea's clock moves. */
export function pickCandidate(
  idea: RecipeIdea,
  cmd: { member: MemberId; candidate: number },
  now: number,
): Result<{ source: string; idea: RecipeIdea }> {
  if (idea.archivedAt !== null) return reject("archived");
  const picked = Number.isInteger(cmd.candidate) ? idea.candidates[cmd.candidate] : undefined;
  if (picked === undefined) return reject("no_such_candidate");
  return succeed({ source: picked.link, idea: { ...idea, lastTouchedAt: now } });
}

/** rule UseOwnRecipe: the member hands over a source of their own; the idea's clock moves. */
export const useOwnRecipe = (idea: RecipeIdea, _cmd: { member: MemberId }, now: number): RecipeIdea => ({
  ...idea,
  lastTouchedAt: now,
});

/** rule ResearchIdea: fewer than the limit within the last hour for this member. */
export const mayResearch = (
  requests: readonly ResearchRequest[],
  member: MemberId,
  now: number,
  config: IdeaConfig,
): boolean =>
  requests.filter((r) => r.requestedBy === member && r.requestedAt + HOUR_MS > now).length < config.maxResearchPerHour;
