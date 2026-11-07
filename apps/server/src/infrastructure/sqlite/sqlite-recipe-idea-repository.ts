import type { RecipeIdeaRepository, ResearchRequestLog } from "@weekly-planner/application";
import {
  memberId,
  recipeIdeaId,
  type CandidateProposal,
  type RecipeIdea,
  type RecipeIdeaId,
  type ResearchRequest,
} from "@weekly-planner/domain";
import type { Database } from "./database.js";

/** Adapter: the household's recipe ideas, one row per idea with its candidates as JSON. */
export class SqliteRecipeIdeaRepository implements RecipeIdeaRepository {
  constructor(private readonly db: Database) {}

  async get(id: RecipeIdeaId): Promise<RecipeIdea | null> {
    const row = this.db.prepare("select * from recipe_idea where id = ?").get(id);
    return row ? this.load(row) : null;
  }

  async save(idea: RecipeIdea): Promise<void> {
    this.db
      .prepare(
        `insert into recipe_idea (id, title, note, inspiration_link, added_by, added_at, last_touched_at, candidates_json)
         values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update set title = excluded.title, note = excluded.note,
           inspiration_link = excluded.inspiration_link, added_by = excluded.added_by, added_at = excluded.added_at,
           last_touched_at = excluded.last_touched_at, candidates_json = excluded.candidates_json`,
      )
      .run(
        idea.id,
        idea.title,
        idea.note,
        idea.inspirationLink,
        idea.addedBy,
        idea.addedAt,
        idea.lastTouchedAt,
        JSON.stringify(idea.candidates),
      );
  }

  async remove(id: RecipeIdeaId): Promise<void> {
    this.db.prepare("delete from recipe_idea where id = ?").run(id);
  }

  async listAll(): Promise<readonly RecipeIdea[]> {
    return this.db
      .prepare("select * from recipe_idea order by added_at desc, id")
      .all()
      .map((row) => this.load(row));
  }

  private load(row: Record<string, unknown>): RecipeIdea {
    return {
      id: recipeIdeaId(row.id as string),
      title: row.title as string,
      note: (row.note as string | null) ?? null,
      inspirationLink: (row.inspiration_link as string | null) ?? null,
      addedBy: memberId(row.added_by as string),
      addedAt: row.added_at as number,
      lastTouchedAt: row.last_touched_at as number,
      candidates: JSON.parse(row.candidates_json as string) as CandidateProposal[],
    };
  }
}

/** Adapter: the researches members asked for, to count against the hourly limit. */
export class SqliteResearchRequestLog implements ResearchRequestLog {
  constructor(private readonly db: Database) {}

  async add(request: ResearchRequest): Promise<void> {
    this.db
      .prepare("insert into research_request (requested_by, requested_at) values (?, ?)")
      .run(request.requestedBy, request.requestedAt);
  }

  async listSince(from: number): Promise<readonly ResearchRequest[]> {
    return this.db
      .prepare("select requested_by, requested_at from research_request where requested_at >= ? order by requested_at")
      .all(from)
      .map((r) => ({ requestedBy: memberId(r.requested_by as string), requestedAt: r.requested_at as number }));
  }
}
