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
  await fetch(`${base}/logout`, { method: "POST", credentials: "same-origin" });
}

interface PlanDay {
  date: string;
  status: "open" | "planned" | "leftovers";
}

export interface PlanSession {
  id: string;
  status: "open" | "finalized" | "closed";
  startedBy: string;
  days: PlanDay[];
}

type SessionError = "session_already_open" | "unavailable";

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
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new SessionFailed("unavailable");
  }
  if (res.ok) return ((await res.json()) as { session: PlanSession }).session;
  const error = ((await res.json().catch(() => ({}))) as { error?: string }).error;
  throw new SessionFailed(error === "session_already_open" ? error : "unavailable");
}

export const startSession = (dates: string[]) => sessionCommand("/sessions", { dates });
export const closeSession = (id: string) => sessionCommand(`/sessions/${id}/close`);

/** Opens the live stream; `onChange` fires when anything changed and again after every (re)connect. */
export function listenForChanges(onChange: () => void): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(`${base}/events`, { withCredentials: true });
  source.addEventListener("ready", onChange);
  source.addEventListener("changed", onChange);
  return () => source.close();
}
