import type { Member } from "@weekly-planner/application";
import { memberId } from "@weekly-planner/domain";
import { z } from "zod";

export const SESSION_COOKIE = "session";
export const SESSION_DAYS = 30;

const payload = z.object({ id: z.string().min(1), name: z.string(), exp: z.number() });

/** The cookie value (signed by the HTTP layer) that says who is signed in until when. */
export function encodeSession(member: Member, now: number): string {
  const exp = now + SESSION_DAYS * 86_400_000;
  return Buffer.from(JSON.stringify({ id: member.id, name: member.name, exp })).toString("base64url");
}

/** Null for anything that is not a well-formed, unexpired session. */
export function decodeSession(value: string, now: number): Member | null {
  try {
    const parsed = payload.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.exp <= now) return null;
    return { id: memberId(parsed.data.id), name: parsed.data.name };
  } catch {
    return null;
  }
}
