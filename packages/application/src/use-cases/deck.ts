import {
  isNewRecipe,
  nextOpenDay,
  type PlanDate,
  type Recipe,
  type RecipeId,
  type SessionId,
} from "@weekly-planner/domain";
import type { RecipeCatalog, RecipePhoto } from "../ports/recipe-catalog.js";
import type { RecipeExperienceRepository, SessionRepository } from "../ports/repositories.js";
import type { SuggestRecipes } from "./suggest-recipes.js";

export interface DeckCard {
  readonly recipe: Recipe;
  /** Not tagged proven and never confirmed as cooked: shown with a "new" badge. */
  readonly isNew: boolean;
}

/** The ranked deck for the next open day: what the board swipes through. Read-only. */
export class GetDeck {
  constructor(
    private readonly deps: {
      sessions: Pick<SessionRepository, "get">;
      experience: Pick<RecipeExperienceRepository, "allRecipeIds">;
      suggest: Pick<SuggestRecipes, "execute">;
    },
  ) {}

  async execute(cmd: { sessionId: SessionId }): Promise<{ date: PlanDate; cards: readonly DeckCard[] } | null> {
    const session = await this.deps.sessions.get(cmd.sessionId);
    const day = session && session.status === "open" ? nextOpenDay(session) : undefined;
    if (!session || !day) return null;
    const experienced: ReadonlySet<RecipeId> = await this.deps.experience.allRecipeIds();
    const ranked = await this.deps.suggest.execute({ sessionId: session.id });
    return { date: day.date, cards: ranked.map((recipe) => ({ recipe, isNew: isNewRecipe(recipe, experienced) })) };
  }
}

/** The source's own icon font for ingredients, so the shopping list shows the icons KitchenOwl shows. */
export class GetItemIcons {
  constructor(private readonly catalog: Pick<RecipeCatalog, "itemIcons">) {}

  execute(): Promise<RecipePhoto | null> {
    return this.catalog.itemIcons();
  }
}

/** A recipe's picture, for the deck cards. */
export class GetRecipePhoto {
  constructor(private readonly catalog: Pick<RecipeCatalog, "photo">) {}

  execute(cmd: { recipeId: RecipeId }): Promise<RecipePhoto | null> {
    return this.catalog.photo(cmd.recipeId);
  }
}
