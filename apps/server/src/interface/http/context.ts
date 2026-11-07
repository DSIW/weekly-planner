import type {
  AcceptProposal,
  CreateImportedRecipe,
  DraftRecipeImport,
  FindRelatedRecipes,
  ImageShelf,
  MatchIngredients,
  MatchTags,
  ResetFinalizedDay,
  SuggestNames,
  AgreeInPerson,
  AddLoggedMeal,
  ArchiveIdea,
  DeleteIdea,
  PickCandidate,
  ResearchIdea,
  UseOwnRecipe,
  EditIdea,
  EventPublisher,
  GetMemberAvatar,
  KeepIdea,
  RestoreIdea,
  ListIdeas,
  ListMembers,
  NoteIdea,
  ConfirmCooked,
  CorrectLoggedMeal,
  ListMealLog,
  ListRecipes,
  ListTakenDates,
  MarkNotCooked,
  RemoveLoggedMeal,
  CloseSession,
  DomainEvent,
  FinalizePlan,
  GetCurrentSession,
  GetDeck,
  GetExport,
  GetFinalizePreview,
  GetItemIcons,
  GetRecipePhoto,
  Member,
  MarkLeftoverDay,
  MovePlannedDay,
  PassSuggestion,
  ListEligibleRecipes,
  ProposeRecipe,
  RefreshRecipes,
  ReopenDay,
  RetryExport,
  SendTestNotification,
  SubscribeToPush,
  UnsubscribeFromPush,
  SignIn,
  StartSession,
  SwapPlannedDays,
  VetoProposal,
  WithdrawProposal,
} from "@weekly-planner/application";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface AppOptions {
  readonly signIn: Pick<SignIn, "execute">;
  readonly getCurrentSession: Pick<GetCurrentSession, "execute">;
  readonly startSession: Pick<StartSession, "execute">;
  readonly closeSession: Pick<CloseSession, "execute">;
  readonly listEligibleRecipes: Pick<ListEligibleRecipes, "execute">;
  readonly proposeRecipe: Pick<ProposeRecipe, "execute">;
  readonly draftRecipeImport: Pick<DraftRecipeImport, "execute">;
  readonly createImportedRecipe: Pick<CreateImportedRecipe, "execute">;
  readonly matchIngredients: Pick<MatchIngredients, "execute">;
  readonly matchTags: Pick<MatchTags, "execute">;
  readonly suggestNames: Pick<SuggestNames, "execute">;
  readonly findRelatedRecipes: Pick<FindRelatedRecipes, "execute">;
  /** Where the pictures of drafts are held; without it the pictures are not served. */
  readonly draftImages?: ImageShelf;
  readonly acceptProposal: Pick<AcceptProposal, "execute">;
  readonly agreeInPerson: Pick<AgreeInPerson, "execute">;
  readonly vetoProposal: Pick<VetoProposal, "execute">;
  readonly withdrawProposal: Pick<WithdrawProposal, "execute">;
  readonly refreshRecipes: Pick<RefreshRecipes, "execute">;
  readonly getDeck: Pick<GetDeck, "execute">;
  readonly passSuggestion: Pick<PassSuggestion, "execute">;
  readonly markLeftoverDay: Pick<MarkLeftoverDay, "execute">;
  readonly reopenDay: Pick<ReopenDay, "execute">;
  readonly resetFinalizedDay: Pick<ResetFinalizedDay, "execute">;
  readonly swapPlannedDays: Pick<SwapPlannedDays, "execute">;
  readonly movePlannedDay: Pick<MovePlannedDay, "execute">;
  readonly getRecipePhoto: Pick<GetRecipePhoto, "execute">;
  readonly getItemIcons: Pick<GetItemIcons, "execute">;
  readonly getExport: Pick<GetExport, "execute">;
  readonly getFinalizePreview: Pick<GetFinalizePreview, "execute">;
  readonly finalizePlan: Pick<FinalizePlan, "execute">;
  readonly retryExport: Pick<RetryExport, "execute">;
  readonly listMealLog: Pick<ListMealLog, "execute">;
  readonly listRecipes: Pick<ListRecipes, "execute" | "incomplete">;
  readonly listTakenDates: Pick<ListTakenDates, "execute">;
  readonly confirmCooked: Pick<ConfirmCooked, "execute">;
  readonly markNotCooked: Pick<MarkNotCooked, "execute">;
  readonly removeLoggedMeal: Pick<RemoveLoggedMeal, "execute">;
  readonly correctLoggedMeal: Pick<CorrectLoggedMeal, "execute">;
  readonly addLoggedMeal: Pick<AddLoggedMeal, "execute">;
  readonly subscribeToPush: Pick<SubscribeToPush, "execute">;
  readonly sendTestNotification: Pick<SendTestNotification, "execute">;
  readonly unsubscribeFromPush: Pick<UnsubscribeFromPush, "execute">;
  /** The server's VAPID public key: a phone needs it to subscribe to notifications. */
  readonly pushPublicKey: string;
  /** Recipes longer than this need a day's lead time; the phones flag them. */
  readonly planAheadMinutes: number;
  /** Where the phones reach KitchenOwl ("" = same host); absent or null: the planner shows no links to it. */
  readonly links?: { kitchenowl: string | null; householdId: number };
  readonly listIdeas: Pick<ListIdeas, "execute">;
  readonly noteIdea: Pick<NoteIdea, "execute">;
  readonly editIdea: Pick<EditIdea, "execute">;
  readonly keepIdea: Pick<KeepIdea, "execute">;
  readonly archiveIdea: Pick<ArchiveIdea, "execute">;
  readonly restoreIdea: Pick<RestoreIdea, "execute">;
  readonly deleteIdea: Pick<DeleteIdea, "execute">;
  readonly researchIdea: Pick<ResearchIdea, "execute">;
  readonly pickCandidate: Pick<PickCandidate, "execute">;
  readonly useOwnRecipe: Pick<UseOwnRecipe, "execute">;
  readonly listMembers: Pick<ListMembers, "execute">;
  readonly getMemberAvatar: Pick<GetMemberAvatar, "execute">;
  /** Told when the ideas changed, so the other phone shows them live. */
  readonly ideaEvents: EventPublisher;
  /** Told about every committed change; returns the way to stop listening. */
  readonly subscribe: (listener: (event: DomainEvent) => void) => () => void;
  readonly sessionSecret: string;
  readonly basePath: string;
  readonly webDist: string;
  readonly cookieSecure: boolean;
  readonly trustProxy: boolean;
  readonly now?: () => number;
  /** Where failed API calls are written, one line each; defaults to the console. */
  readonly log?: (line: string) => void;
}

export const COMMAND_REJECTIONS: Record<string, number> = {
  need_one_source: 400,
  invalid_address: 400,
  address_not_public: 422,
  unreachable: 502,
  not_a_page: 422,
  too_large: 422,
  empty: 422,
  empty_title: 422,
  idea_not_found: 404,
  rate_limited: 429,
  research_failed: 502,
  nothing_found: 422,
  no_candidates: 422,
  too_many_candidates: 422,
  no_such_candidate: 404,
  not_stale: 409,
  archived: 409,
  already_archived: 409,
  not_archived: 409,
  not_configured: 503,
  extraction_failed: 502,
  not_a_recipe: 422,
  too_many_steps: 422,
  too_many_ingredients: 422,
  kitchenowl_unavailable: 502,
  session_already_open: 409,
  session_already_closed: 409,
  unknown_session: 404,
  nothing_planned: 409,
  session_not_finalized: 409,
  export_running: 409,
  step_unconfirmed: 409,
  step_already_done: 409,
  unknown_step: 409,
  no_export: 404,
  unknown_recipe: 404,
  unknown_proposal: 404,
  unknown_day: 404,
  unknown_entry: 404,
  no_recipe: 409,
  already_confirmed: 409,
  date_in_future: 422,
  own_proposal: 403,
  not_your_proposal: 403,
  not_next_open_day: 409,
  proposal_already_pending: 409,
  proposal_not_pending: 409,
  day_not_planned: 409,
  day_already_open: 409,
  day_passed: 409,
  already_released: 409,
  not_exported: 409,
  target_not_open: 409,
  same_day: 422,
  session_not_open: 409,
  day_not_open: 409,
  date_already_taken: 409,
  recipe_vetoed: 409,
  recipe_already_proposed: 409,
  recipe_passed: 409,
  already_passed: 409,
  recipe_already_planned: 409,
  not_a_dinner: 422,
  too_long_for_weekday: 422,
  duplicate_dates: 422,
  too_few_days: 422,
  too_many_days: 422,
};

/** What every route module gets: the Fastify instance, the API prefix, the use cases and the sign-in check. */
export interface RouteContext {
  readonly app: FastifyInstance;
  readonly api: string;
  readonly options: AppOptions;
  readonly now: () => number;
  readonly memberOf: (req: FastifyRequest) => Member | null;
  /** Answers 401 and returns null when nobody is signed in. */
  readonly requireMember: (
    req: FastifyRequest,
    reply: { code(n: number): { send(b: unknown): unknown } },
  ) => Member | null;
}
