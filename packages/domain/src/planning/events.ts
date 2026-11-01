import type { MemberId, ProposalId, SessionId } from "../shared/ids.js";
import type { RecipeId } from "../catalog/recipe.js";
import type { PlanDate } from "./dates.js";
import type { ExportFailure } from "./export.js";

/** One agreed dinner as announced to the shopping list when the plan is finalized. */
export interface FinalizedDinner {
  readonly date: PlanDate;
  readonly recipeId: RecipeId;
  readonly recipeName: string;
  readonly recipeYields: number;
  readonly portions: number;
}

export type PlanningEvent =
  | { readonly type: "SessionStarted"; readonly sessionId: SessionId; readonly dates: readonly PlanDate[] }
  | {
      readonly type: "RecipeProposed";
      readonly sessionId: SessionId;
      readonly proposalId: ProposalId;
      readonly date: PlanDate;
      readonly recipeId: RecipeId;
      readonly proposedBy: MemberId;
    }
  | {
      readonly type: "SuggestionPassed";
      readonly sessionId: SessionId;
      readonly recipeId: RecipeId;
      readonly passedBy: MemberId;
    }
  | {
      readonly type: "ProposalAccepted";
      readonly sessionId: SessionId;
      readonly proposalId: ProposalId;
      readonly date: PlanDate;
      readonly recipeId: RecipeId;
      readonly decidedBy: MemberId;
    }
  | {
      readonly type: "ProposalWithdrawn";
      readonly sessionId: SessionId;
      readonly proposalId: ProposalId;
      readonly date: PlanDate;
      readonly recipeId: RecipeId;
    }
  | {
      readonly type: "ProposalVetoed";
      readonly sessionId: SessionId;
      readonly proposalId: ProposalId;
      readonly date: PlanDate;
      readonly recipeId: RecipeId;
      readonly decidedBy: MemberId;
    }
  | { readonly type: "DayMarkedLeftovers"; readonly sessionId: SessionId; readonly date: PlanDate }
  | { readonly type: "DayReopened"; readonly sessionId: SessionId; readonly date: PlanDate }
  | { readonly type: "DaysSwapped"; readonly sessionId: SessionId; readonly dates: readonly [PlanDate, PlanDate] }
  | { readonly type: "DayMoved"; readonly sessionId: SessionId; readonly from: PlanDate; readonly to: PlanDate }
  | { readonly type: "PlanFinalized"; readonly sessionId: SessionId; readonly dinners: readonly FinalizedDinner[] }
  | {
      readonly type: "ExportProgressed";
      readonly sessionId: SessionId;
      readonly complete: boolean;
      readonly failure: ExportFailure | null;
    }
  | { readonly type: "FinalizeReminderDue"; readonly sessionId: SessionId }
  | { readonly type: "SessionClosed"; readonly sessionId: SessionId };
