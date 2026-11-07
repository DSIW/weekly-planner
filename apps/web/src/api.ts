interface Member {
  id: string;
  name: string;
}

export type LoginError = "invalid_credentials" | "missing_credentials" | "not_in_household" | "unavailable";

import type { KitchenOwlLinks } from "./Links";

const base = `${import.meta.env.BASE_URL}api`;

/** The signed-in member, or null when nobody is signed in. */
export async function fetchMe(): Promise<Member | null> {
  const res = await fetch(`${base}/me`, { credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { member: Member }).member;
}

/** Where KitchenOwl's pages are, or null when the server does not know. */
export async function fetchLinks(): Promise<KitchenOwlLinks | null> {
  const res = await fetch(`${base}/links`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { links: KitchenOwlLinks | null }).links;
}

export class LoginFailed extends Error {
  constructor(readonly reason: LoginError) {
    super(reason);
  }
}

export async function login(username: string, password: string): Promise<Member> {
  let res: Response;
  try {
    res = await fetch(`${base}/login`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new LoginFailed("unavailable");
  }
  if (res.ok) return ((await res.json()) as { member: Member }).member;
  const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
  throw new LoginFailed(
    error === "invalid_credentials" || error === "missing_credentials" || error === "not_in_household"
      ? error
      : "unavailable",
  );
}

export async function logout(): Promise<void> {
  const res = await fetch(`${base}/logout`, { method: "POST", credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export interface RecipeView {
  id: number;
  name: string;
  minutes: number | null;
  base: string;
  diet: string;
  /** KitchenOwl's tags worth showing on a card, emoji included; empty on recipes from before tags were kept. */
  tags?: string[];
  needsTime: boolean;
  /** Longer than the household's lead-time limit: needs preparing the day before. */
  planAhead: boolean;
}

interface PlanDay {
  date: string;
  status: "open" | "planned" | "leftovers";
  recipe?: RecipeView;
  /** The dinner was taken off KitchenOwl's planner again: its date is free. */
  removedInPlanner?: boolean;
}

export interface Proposal {
  id: string;
  date: string;
  recipe: RecipeView;
  proposedBy: string;
  status: "pending" | "accepted" | "vetoed" | "withdrawn";
}

export type StepStatus = "pending" | "sending" | "done";

/** One line of the consolidated shopping list. */
export interface ListLine {
  name: string;
  /** KitchenOwl's icon key of the item ("butter"), when it has one. */
  icon?: string | null;
  /** Salt, pepper, oil, water: assumed to be at home, so the list starts with them left off. */
  staple?: boolean;
  /** Amount and unit, summed over the recipes; empty when no recipe gave one. */
  description: string;
  /** An amount could not be read: someone should look at this line in KitchenOwl. */
  needsReview: boolean;
  recipes: string[];
}

/** How far writing a finalized plan to KitchenOwl has come. */
export interface ExportView {
  complete: boolean;
  /** "refused": nothing was written, retry is safe. "unconfirmed": no answer, it may have arrived. */
  failure: "refused" | "unconfirmed" | null;
  days: { date: string; recipeName: string; status: StepStatus }[];
  list: { status: StepStatus; items: ListLine[] };
}

export interface PlanSession {
  id: string;
  status: "open" | "finalized" | "closed";
  startedBy: string;
  /** The reminder to finalize has gone out; the board repeats it for phones without notifications. */
  reminderSent: boolean;
  days: PlanDay[];
  proposals: Proposal[];
  /** Present on a finalized session. */
  export?: ExportView;
}

/** Reasons the server gives that a member can do something about; anything else is just "did not work". */
const KNOWN_REASONS = [
  "session_already_open",
  "session_not_open",
  "proposal_already_pending",
  "proposal_not_pending",
  "recipe_already_proposed",
  "not_your_proposal",
  "not_next_open_day",
  "date_already_taken",
  "too_long_for_weekday",
  "day_not_planned",
  "day_already_open",
  "target_not_open",
  "nothing_planned",
  "export_running",
  "step_unconfirmed",
  "session_not_finalized",
  "unknown_entry",
  "already_confirmed",
  "no_recipe",
  "date_in_future",
  "day_passed",
  "already_released",
  "kitchenowl_unavailable",
] as const;
export type SessionError = (typeof KNOWN_REASONS)[number] | "unavailable";

export class SessionFailed extends Error {
  constructor(readonly reason: SessionError) {
    super(reason);
  }
}

/** The session both members are working on, or null when none is open. */
export async function fetchCurrentSession(): Promise<PlanSession | null> {
  const res = await fetch(`${base}/sessions/current`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { session: PlanSession | null }).session;
}

/** A POST whose answer is `T`; a refusal becomes a `SessionFailed` with the server's reason. */
async function command<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      credentials: "same-origin",
      // A JSON content type without a body is rejected by the server, so it goes with the body only.
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new SessionFailed("unavailable");
  }
  if (res.ok) return (await res.json()) as T;
  const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
  throw new SessionFailed(KNOWN_REASONS.find((r) => r === error) ?? "unavailable");
}

const sessionCommand = async (path: string, body?: unknown): Promise<PlanSession> =>
  (await command<{ session: PlanSession }>(path, body)).session;

/** Locks the plan and writes the planner entries and the shopping list to KitchenOwl. */
export const finalizePlan = (sessionId: string, skip: string[] = []) =>
  sessionCommand(`/sessions/${sessionId}/finalize`, skip.length > 0 ? { skip } : undefined);

/** Sends what is still missing. `resendUnconfirmed` also sends a step that may already have arrived. */
export async function retryExport(sessionId: string, resendUnconfirmed: boolean): Promise<ExportView> {
  const body = resendUnconfirmed ? { resendUnconfirmed } : undefined;
  return (await command<{ export: ExportView }>(`/sessions/${sessionId}/export/retry`, body)).export;
}

/** The consolidated shopping list of an open session as finalizing would send it. */
export async function fetchFinalizePreview(
  sessionId: string,
): Promise<{ dinners: { date: string; recipeName: string }[]; items: ListLine[] }> {
  const res = await fetch(`${base}/sessions/${sessionId}/finalize-preview`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { dinners: { date: string; recipeName: string }[]; items: ListLine[] };
}

/** A date that already holds a planned dinner, with the dinner. */
export interface TakenDate {
  date: string;
  recipeName: string;
  recipeId?: number;
  /** The plan that holds it; absent for a dinner somebody chose in KitchenOwl itself. */
  sessionId?: string;
}

/** The dates from today on that already hold a planned dinner, in a plan that is still counted. */
export async function fetchPlannedDates(): Promise<TakenDate[]> {
  const res = await fetch(`${base}/planned-dates`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { dates: TakenDate[] }).dates;
}

/** Gives up a finalized dinner: it comes off KitchenOwl's planner and its date is free again. */
export const resetDay = async (sessionId: string, date: string): Promise<void> => {
  await command<{ reset: true }>(`/sessions/${sessionId}/days/${date}/reset`);
};

export const startSession = (dates: string[]) => sessionCommand("/sessions", { dates });
export const closeSession = (id: string) => sessionCommand(`/sessions/${id}/close`);
export const markLeftovers = (sessionId: string, date: string) =>
  sessionCommand(`/sessions/${sessionId}/days/${date}/leftovers`);
export const reopenDay = (sessionId: string, date: string) =>
  sessionCommand(`/sessions/${sessionId}/days/${date}/reopen`);
export const swapDays = (sessionId: string, a: string, b: string) =>
  sessionCommand(`/sessions/${sessionId}/swap`, { a, b });
export const moveDay = (sessionId: string, from: string, to: string) =>
  sessionCommand(`/sessions/${sessionId}/move`, { from, to });
export const proposeRecipe = (sessionId: string, date: string, recipeId: number, despiteTime = false) =>
  sessionCommand(`/sessions/${sessionId}/proposals`, { date, recipeId, ...(despiteTime ? { despiteTime } : {}) });
export const acceptProposal = (sessionId: string, proposalId: string) =>
  sessionCommand(`/sessions/${sessionId}/proposals/${proposalId}/accept`);
/** "We agreed in the room": the proposer settles the dish without the other member confirming on a phone. */
export const agreeInPerson = (sessionId: string, proposalId: string) =>
  sessionCommand(`/sessions/${sessionId}/proposals/${proposalId}/agree`);
export const withdrawProposal = (sessionId: string, proposalId: string) =>
  sessionCommand(`/sessions/${sessionId}/proposals/${proposalId}/withdraw`);
export const vetoProposal = (sessionId: string, proposalId: string) =>
  sessionCommand(`/sessions/${sessionId}/proposals/${proposalId}/veto`);

export interface DeckCard extends RecipeView {
  /** Not tagged proven and never cooked: shown with a "new" badge. */
  isNew: boolean;
}

/** The ranked cards for the next open day, best first; the same order for both members. */
export async function fetchDeck(sessionId: string): Promise<{ date: string; cards: DeckCard[] }> {
  const res = await fetch(`${base}/sessions/${sessionId}/deck`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { date: string; cards: DeckCard[] };
}

/** Hides a dish for the rest of this session, for both members. */
export const passRecipe = (sessionId: string, recipeId: number) =>
  sessionCommand(`/sessions/${sessionId}/passes`, { recipeId });

/** KitchenOwl's icon font for ingredients, passed on by the server. */
export const itemIconsUrl = `${base}/item-icons`;

/** Where a recipe's picture is served; recipes without one answer 404. */
export const photoUrl = (recipeId: number) => `${base}/recipes/${recipeId}/photo`;

/** The recipes that may be proposed for the next open day, by name. */
/** What keeps a recipe from being offered for the day. Only a time too long for a weekday may be overruled. */
export type Hindrance = "not_a_dinner" | "vetoed" | "waiting" | "passed" | "planned" | "too_long_for_weekday";

/** The recipes for the next open day: those offered, and the rest, found only by searching. */
export interface EligibleRecipes {
  date: string;
  recipes: RecipeView[];
  others: (RecipeView & { hindrances: Hindrance[] })[];
  /** In KitchenOwl but lacking what the planner needs; `problems` says what. */
  unavailable: { id: number; name: string; problems: string[] }[];
}

export async function fetchEligibleRecipes(sessionId: string): Promise<EligibleRecipes> {
  const res = await fetch(`${base}/sessions/${sessionId}/recipes`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as Partial<EligibleRecipes> & { date: string; recipes: RecipeView[] };
  return { ...body, others: body.others ?? [], unavailable: body.unavailable ?? [] };
}

/** Asks the server to read the recipes from KitchenOwl again, after someone fixed a tag or a time there. */
export async function refreshRecipes(): Promise<void> {
  const res = await fetch(`${base}/recipes/refresh`, { method: "POST", credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Opens the live stream; `onChange` fires when anything changed and again after every (re)connect. */
export function listenForChanges(onChange: () => void): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(`${base}/events`, { withCredentials: true });
  source.addEventListener("ready", onChange);
  source.addEventListener("changed", onChange);
  return () => source.close();
}

export const BASES = ["pasta", "rice", "potatoes", "grains", "bread", "other"] as const;
export type BaseName = (typeof BASES)[number];

/** One logged meal: what the household ate on a day. */
export interface MealEntry {
  id: string;
  date: string;
  base: BaseName;
  /** Null for a meal given by its base only. */
  recipe: RecipeView | null;
  source: "from_plan" | "corrected" | "added";
  /** A member said this was really cooked. */
  confirmed: boolean;
}

/** What was eaten in the last days, newest first. */
export async function fetchMealLog(days = 14): Promise<MealEntry[]> {
  const res = await fetch(`${base}/meal-log?days=${days}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { entries: MealEntry[] }).entries;
}

/** Every recipe that can be named for a meal, by name. */
export async function fetchRecipes(): Promise<{
  recipes: RecipeView[];
  unavailable: EligibleRecipes["unavailable"];
}> {
  const res = await fetch(`${base}/recipes`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { recipes: RecipeView[]; unavailable?: EligibleRecipes["unavailable"] };
  return { recipes: body.recipes, unavailable: body.unavailable ?? [] };
}

export const confirmMeal = (id: string) => command<{ entry: MealEntry }>(`/meal-log/${id}/confirm`);
export const removeMeal = (id: string) => command<{ entry: MealEntry }>(`/meal-log/${id}/remove`);
export const notCooked = (id: string) => command<{ entry: MealEntry }>(`/meal-log/${id}/not-cooked`);
export const correctMeal = (id: string, baseName: BaseName, recipeId: number | null) =>
  command<{ entry: MealEntry }>(`/meal-log/${id}/correct`, { base: baseName, recipeId });
export const addMeal = (date: string, baseName: BaseName, recipeId: number | null) =>
  command<{ entry: MealEntry }>("/meal-log", { date, base: baseName, recipeId });

interface DraftIngredient {
  name: string;
  amount: string;
  optional: boolean;
  /** No known item has this name: KitchenOwl creates it. */
  isNewItem: boolean;
  /** KitchenOwl's icon key of the known item. */
  icon?: string;
}

/** A recipe read from a link or a text, for a member to review before it is created. */
export interface RecipeDraft {
  name: string;
  subtitle?: string;
  steps: string[];
  ingredients: DraftIngredient[];
  mealType: string;
  base: string;
  diet: string;
  tags: string[];
  totalMinutes?: number;
  yields?: number;
  source?: string;
  /** The page's title picture, held by the planner until the recipe is created. */
  imageToken?: string;
}

/** The import was refused; `reason` is the server's word for why. */
export class ImportFailed extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

async function importCall<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ImportFailed("unavailable");
  }
  if (res.ok) return (await res.json()) as T;
  throw new ImportFailed(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "unavailable");
}

/** Reads a web link or a pasted text into a draft recipe. Can take a minute. */
export const draftImport = async (source: { address: string } | { text: string }): Promise<RecipeDraft> =>
  (await importCall<{ draft: RecipeDraft }>("/import/draft", source)).draft;

/** Which of the household's items each typed ingredient name is, with its icon, or that it is new. */
export const matchIngredients = async (names: string[]) =>
  (
    await importCall<{ items: { written: string; name: string; isNewItem: boolean; icon?: string }[] }>(
      "/import/match",
      { names },
    )
  ).items;

/** The household's spelling, emoji included, of each typed tag; `isKnown` is false for a tag KitchenOwl does not have. */
export const matchTags = async (names: string[]) =>
  (await importCall<{ tags: { written: string; name: string; isKnown: boolean }[] }>("/import/match-tags", { names }))
    .tags;

/** The household's items (with icon) or tags that fit the letters typed so far. */
export const suggestNames = async (kind: "item" | "tag", query: string) =>
  (await importCall<{ names: { name: string; icon?: string }[] }>("/import/suggest", { kind, query })).names;

/** A recipe the household already has that looks like a draft, and why. */
export interface RelatedRecipe {
  id: number;
  name: string;
  reasons: ("same_source" | "similar_name" | "shared_ingredients")[];
  sharedIngredients: number;
}

/** The household's recipes that look like this draft (same source, similar name, shared ingredients). */
export const relatedRecipes = async (draft: { name: string; ingredients: string[]; source?: string }) =>
  (await importCall<{ related: RelatedRecipe[] }>("/import/related", draft)).related;

/** Where the draft's title picture is served (by the planner itself). */
export const importImageUrl = (token: string) => `${base}/import/image/${token}`;

/** Creates the recipe a member confirmed in KitchenOwl. */
export const createImport = (draft: RecipeDraft, idea?: string) =>
  importCall<{ recipeId: number; draft: RecipeDraft; photoAttached: boolean }>("/import/create", {
    draft,
    ...(idea === undefined ? {} : { idea }),
  });

/** One recipe idea, with who noted it. */
export interface Idea {
  id: string;
  title: string;
  note: string | null;
  inspirationLink: string | null;
  addedBy: {
    id: string;
    name: string /** Identifies the member's picture; null when they have none. */;
    avatar: string | null;
  };
  /** Epoch milliseconds. */
  addedAt: number;
  /** Nobody touched it for weeks: marked for cleanup, never removed by itself. */
  isStale: boolean;
  /** What the last research found (at most 5). */
  candidates: Candidate[];
}

/** A recipe the research proposes; the link is not trusted and only ever read by the server's import. */
export interface Candidate {
  title: string;
  link: string;
  summary: string;
}

export type IdeaInput = { title: string; note?: string; inspirationLink?: string };

/** An idea action was refused; `reason` is the server's word for why. */
export class IdeaFailed extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

async function ideaCall<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      credentials: "same-origin",
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new IdeaFailed("unavailable");
  }
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  throw new IdeaFailed(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "unavailable");
}

export const fetchIdeas = async (): Promise<Idea[]> => (await ideaCall<{ ideas: Idea[] }>("GET", "/ideas")).ideas;
export const addIdea = (idea: IdeaInput) => ideaCall<{ idea: Idea }>("POST", "/ideas", idea);
export const editIdea = (id: string, idea: IdeaInput) => ideaCall<{ idea: Idea }>("PUT", `/ideas/${id}`, idea);
export const keepIdea = (id: string) => ideaCall<{ idea: Idea }>("POST", `/ideas/${id}/keep`);
export const deleteIdea = (id: string) => ideaCall<void>("DELETE", `/ideas/${id}`);

/** Asks the model (with web search) for candidates. Can take a minute. */
export const researchIdea = async (id: string): Promise<Idea> =>
  (await ideaCall<{ idea: Idea }>("POST", `/ideas/${id}/research`)).idea;
/** Starts the import's draft with a candidate's link. */
export const pickCandidate = async (id: string, candidate: number): Promise<RecipeDraft> =>
  (await ideaCall<{ draft: RecipeDraft }>("POST", `/ideas/${id}/pick`, { candidate })).draft;
/** Starts the import's draft with a link or text of the member's own. */
export const submitOwnSource = async (
  id: string,
  source: { address: string } | { text: string },
): Promise<RecipeDraft> => (await ideaCall<{ draft: RecipeDraft }>("POST", `/ideas/${id}/own`, source)).draft;

/** A member's own KitchenOwl picture, served by the planner; `version` changes with the picture. */
export const memberAvatarUrl = (memberId: string, version: string) =>
  `${base}/members/${encodeURIComponent(memberId)}/avatar?v=${encodeURIComponent(version)}`;
