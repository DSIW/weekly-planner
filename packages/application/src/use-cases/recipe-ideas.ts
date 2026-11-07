import {
  editIdea,
  isStale,
  keepIdea,
  mayResearch,
  noteIdea,
  pickCandidate,
  recipeIdeaId,
  replaceCandidates,
  reviewCandidates,
  useOwnRecipe,
  defaultIdeaConfig,
  type IdeaConfig,
  type MemberId,
  type RecipeDraft,
  type RecipeIdea,
  type RecipeIdeaId,
  type Result,
} from "@weekly-planner/domain";
import {
  ResearchNotConfigured,
  type IdeaResearcher,
  type InspirationReader,
  type RecipeIdeaRepository,
  type ResearchRequestLog,
} from "../ports/recipe-ideas.js";
import type { Clock, IdGenerator } from "../ports/services.js";
import type { DraftRecipeImport } from "./recipe-import.js";

const HOUR_MS = 3_600_000;
const notFound = { ok: false, reason: "idea_not_found" } as const;

/** rule NoteIdea */
export class NoteIdea {
  constructor(private readonly deps: { ideas: RecipeIdeaRepository; clock: Clock; ids: IdGenerator }) {}

  async execute(cmd: {
    member: MemberId;
    title: string;
    note?: string;
    inspirationLink?: string;
  }): Promise<Result<RecipeIdea>> {
    const idea = noteIdea({ ...cmd, id: recipeIdeaId(this.deps.ids.next()) }, this.deps.clock.now());
    if (idea.ok) await this.deps.ideas.save(idea.value);
    return idea;
  }
}

/** rule EditIdea: either member may edit any idea. */
export class EditIdea {
  constructor(private readonly deps: { ideas: RecipeIdeaRepository; clock: Clock }) {}

  async execute(cmd: {
    member: MemberId;
    idea: RecipeIdeaId;
    title: string;
    note?: string;
    inspirationLink?: string;
  }): Promise<Result<RecipeIdea>> {
    const idea = await this.deps.ideas.get(cmd.idea);
    if (!idea) return notFound;
    const edited = editIdea(idea, cmd, this.deps.clock.now());
    if (edited.ok) await this.deps.ideas.save(edited.value);
    return edited;
  }
}

export interface IdeaView extends RecipeIdea {
  readonly isStale: boolean;
}

/** surface IdeaList: every idea of the household, with whether it is stale. */
export class ListIdeas {
  constructor(
    private readonly deps: { ideas: RecipeIdeaRepository; clock: Clock },
    private readonly config: IdeaConfig = defaultIdeaConfig,
  ) {}

  async execute(): Promise<Result<readonly IdeaView[]>> {
    const now = this.deps.clock.now();
    const all = await this.deps.ideas.listAll();
    return { ok: true, value: all.map((idea) => ({ ...idea, isStale: isStale(idea, now, this.config) })) };
  }
}

/**
 * rule ResearchIdea + CountUsefulResearch + NothingFound + ReplaceCandidates. The idea's inspiration link is read
 * under the safe-fetch rules; a link that cannot be read (null or an error) only means the model gets title and note.
 * A research counts against the hourly limit only once it brought at least one usable candidate, also when the idea was
 * deleted meanwhile. A failed, malformed or empty answer is reported as nothing_found and changes nothing. The idea is
 * read again after the answer: a deleted idea is not brought back and an edit made meanwhile is kept.
 */
export class ResearchIdea {
  constructor(
    private readonly deps: {
      ideas: RecipeIdeaRepository;
      requests: ResearchRequestLog;
      researcher: IdeaResearcher;
      inspiration: InspirationReader;
      clock: Clock;
    },
    private readonly config: IdeaConfig = defaultIdeaConfig,
  ) {}

  async execute(cmd: { member: MemberId; idea: RecipeIdeaId }): Promise<Result<RecipeIdea>> {
    const idea = await this.deps.ideas.get(cmd.idea);
    if (!idea) return notFound;
    const asked = this.deps.clock.now();
    const recent = await this.deps.requests.listSince(asked - HOUR_MS);
    if (!mayResearch(recent, cmd.member, asked, this.config)) return { ok: false, reason: "rate_limited" };

    let inspiration: string | null = null;
    if (idea.inspirationLink) {
      try {
        inspiration = await this.deps.inspiration.readInspiration(idea.inspirationLink);
      } catch {
        inspiration = null;
      }
    }

    let answer: unknown;
    try {
      answer = await this.deps.researcher.research({ title: idea.title, note: idea.note, inspiration });
    } catch (e) {
      if (e instanceof ResearchNotConfigured) return { ok: false, reason: "not_configured" };
      return { ok: false, reason: "nothing_found" };
    }

    const found = reviewCandidates(answer, this.config);
    if (found.length === 0) return { ok: false, reason: "nothing_found" };
    // Useful: it counts from the moment the answer arrives, whether or not the idea is still there.
    await this.deps.requests.add({ requestedBy: cmd.member, requestedAt: this.deps.clock.now() });

    const current = await this.deps.ideas.get(cmd.idea);
    if (!current) return notFound;
    const replaced = replaceCandidates(current, found, this.deps.clock.now(), this.config);
    if (replaced.ok) await this.deps.ideas.save(replaced.value);
    return replaced;
  }
}

type DraftStarter = Pick<DraftRecipeImport, "execute">;

/** rule PickCandidate: starts the import with the candidate's link; the idea's clock moves even if the import refuses. */
export class PickCandidate {
  constructor(private readonly deps: { ideas: RecipeIdeaRepository; clock: Clock; draft: DraftStarter }) {}

  async execute(cmd: { member: MemberId; idea: RecipeIdeaId; candidate: number }): Promise<Result<RecipeDraft>> {
    const idea = await this.deps.ideas.get(cmd.idea);
    if (!idea) return notFound;
    const picked = pickCandidate(idea, cmd, this.deps.clock.now());
    if (!picked.ok) return picked;
    await this.deps.ideas.save(picked.value.idea);
    return this.deps.draft.execute({ member: cmd.member, address: picked.value.source });
  }
}

/** rule UseOwnRecipe: a link or pasted text of the member's own goes to the import (exactly one of them). */
export class UseOwnRecipe {
  constructor(private readonly deps: { ideas: RecipeIdeaRepository; clock: Clock; draft: DraftStarter }) {}

  async execute(cmd: {
    member: MemberId;
    idea: RecipeIdeaId;
    address?: string;
    text?: string;
  }): Promise<Result<RecipeDraft>> {
    const idea = await this.deps.ideas.get(cmd.idea);
    if (!idea) return notFound;
    // A value that is empty or only whitespace counts as not given.
    const address = cmd.address?.trim() ? cmd.address : undefined;
    const text = cmd.text?.trim() ? cmd.text : undefined;
    // Without exactly one source nothing was handed over: the import would refuse, and the idea was not touched.
    if ((address === undefined) === (text === undefined)) return { ok: false, reason: "need_one_source" };
    await this.deps.ideas.save(useOwnRecipe(idea, cmd, this.deps.clock.now()));
    return this.deps.draft.execute({
      member: cmd.member,
      ...(address === undefined ? {} : { address }),
      ...(text === undefined ? {} : { text }),
    });
  }
}

/** rule KeepIdea */
export class KeepIdea {
  constructor(
    private readonly deps: { ideas: RecipeIdeaRepository; clock: Clock },
    private readonly config: IdeaConfig = defaultIdeaConfig,
  ) {}

  async execute(cmd: { member: MemberId; idea: RecipeIdeaId }): Promise<Result<RecipeIdea>> {
    const idea = await this.deps.ideas.get(cmd.idea);
    if (!idea) return notFound;
    const kept = keepIdea(idea, cmd, this.deps.clock.now(), this.config);
    if (kept.ok) await this.deps.ideas.save(kept.value);
    return kept;
  }
}

/** rule DeleteIdea: at any time, stale or not, candidates with it. */
export class DeleteIdea {
  constructor(private readonly deps: { ideas: RecipeIdeaRepository }) {}

  async execute(cmd: { member: MemberId; idea: RecipeIdeaId }): Promise<Result<void>> {
    if (!(await this.deps.ideas.get(cmd.idea))) return notFound;
    await this.deps.ideas.remove(cmd.idea);
    return { ok: true, value: undefined };
  }
}
