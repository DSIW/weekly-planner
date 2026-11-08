import { memberId, recipeIdeaId, type RecipeIdea } from "@weekly-planner/domain";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../../src/infrastructure/sqlite/database.js";
import {
  SqliteRecipeIdeaRepository,
  SqliteResearchRequestLog,
} from "../../src/infrastructure/sqlite/sqlite-recipe-idea-repository.js";

const idea = (id: string, over: Partial<RecipeIdea> = {}): RecipeIdea => ({
  id: recipeIdeaId(id),
  title: "Kürbisgnocchi",
  note: null,
  inspirationLink: null,
  addedBy: memberId("2"),
  addedAt: 1_000,
  lastTouchedAt: 1_000,
  archivedAt: null,
  candidates: [],
  ...over,
});

let db: Database;
afterEach(() => db.close());

describe("SqliteRecipeIdeaRepository", () => {
  it("keeps an idea with its note, link and candidates, and gives it back unchanged", async () => {
    db = openDatabase(":memory:");
    const repo = new SqliteRecipeIdeaRepository(db);
    const full = idea("a", {
      note: "etwas mit Salbei",
      inspirationLink: "https://example.org/x",
      candidates: [{ title: "Gnocchi", link: "https://example.org/g", summary: "Weich." }],
    });
    await repo.save(full);
    expect(await repo.get(full.id)).toEqual(full);
    expect(await repo.get(recipeIdeaId("none"))).toBeNull();
  });

  it("saves again over the same id and lists the newest idea first", async () => {
    db = openDatabase(":memory:");
    const repo = new SqliteRecipeIdeaRepository(db);
    await repo.save(idea("old", { addedAt: 1 }));
    await repo.save(idea("new", { addedAt: 2 }));
    await repo.save(idea("old", { addedAt: 1, title: "Geändert", lastTouchedAt: 9 }));
    const all = await repo.listAll();
    expect(all.map((i) => i.id)).toEqual(["new", "old"]);
    expect(all[1]).toMatchObject({ title: "Geändert", lastTouchedAt: 9 });
  });

  it("removes an idea with its candidates, and removing a missing one is harmless", async () => {
    db = openDatabase(":memory:");
    const repo = new SqliteRecipeIdeaRepository(db);
    await repo.save(idea("a", { candidates: [{ title: "T", link: "https://example.org", summary: "" }] }));
    await repo.remove(recipeIdeaId("a"));
    await repo.remove(recipeIdeaId("a"));
    expect(await repo.listAll()).toEqual([]);
  });
});

describe("SqliteResearchRequestLog", () => {
  it("lists only the requests made at or after the given time", async () => {
    db = openDatabase(":memory:");
    const log = new SqliteResearchRequestLog(db);
    await log.add({ requestedBy: memberId("2"), requestedAt: 100 });
    await log.add({ requestedBy: memberId("3"), requestedAt: 200 });
    expect(await log.listSince(150)).toEqual([{ requestedBy: memberId("3"), requestedAt: 200 }]);
    expect(await log.listSince(100)).toHaveLength(2);
  });
});
