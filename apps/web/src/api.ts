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
