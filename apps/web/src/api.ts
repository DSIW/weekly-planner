interface Member {
  id: string;
  name: string;
}

export type LoginError = "invalid_credentials" | "missing_credentials" | "not_in_household" | "unavailable";

const base = `${import.meta.env.BASE_URL}api`;

/** The signed-in member, or null when nobody is signed in. */
export async function fetchMe(): Promise<Member | null> {
  const res = await fetch(`${base}/me`, { credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { member: Member }).member;
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
  needsTime: boolean;
  /** Longer than the household's lead-time limit: needs preparing the day before. */
  planAhead: boolean;
}

interface PlanDay {
  date: string;
  status: "open" | "planned" | "leftovers";
  recipe?: RecipeView;
}

export interface Proposal {
  id: string;
  date: string;
  recipe: RecipeView;
  proposedBy: string;
  status: "pending" | "accepted" | "vetoed";
}

export interface PlanSession {
  id: string;
  status: "open" | "finalized" | "closed";
  startedBy: string;
  days: PlanDay[];
  proposals: Proposal[];
}

/** Reasons the server gives that a member can do something about; anything else is just "did not work". */
const KNOWN_REASONS = [
  "session_already_open",
  "session_not_open",
  "proposal_already_pending",
  "proposal_not_pending",
  "not_next_open_day",
  "date_already_taken",
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

async function sessionCommand(path: string, body?: unknown): Promise<PlanSession> {
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
  if (res.ok) return ((await res.json()) as { session: PlanSession }).session;
  const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
  throw new SessionFailed(KNOWN_REASONS.find((r) => r === error) ?? "unavailable");
}

export const startSession = (dates: string[]) => sessionCommand("/sessions", { dates });
export const closeSession = (id: string) => sessionCommand(`/sessions/${id}/close`);
export const proposeRecipe = (sessionId: string, date: string, recipeId: number) =>
  sessionCommand(`/sessions/${sessionId}/proposals`, { date, recipeId });
export const acceptProposal = (sessionId: string, proposalId: string) =>
  sessionCommand(`/sessions/${sessionId}/proposals/${proposalId}/accept`);
export const vetoProposal = (sessionId: string, proposalId: string) =>
  sessionCommand(`/sessions/${sessionId}/proposals/${proposalId}/veto`);

/** The recipes that may be proposed for the next open day, by name. */
export async function fetchEligibleRecipes(sessionId: string): Promise<{ date: string; recipes: RecipeView[] }> {
  const res = await fetch(`${base}/sessions/${sessionId}/recipes`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { date: string; recipes: RecipeView[] };
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
