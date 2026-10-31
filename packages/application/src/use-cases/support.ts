import type { Outcome, PlanningEvent, PlanningSession, Result, SessionId } from "@weekly-planner/domain";
import type { SessionRepository } from "../ports/repositories.js";
import type { EventPublisher, UnitOfWork } from "../ports/services.js";

export interface SessionDeps {
  readonly sessions: SessionRepository;
  readonly events: EventPublisher;
  readonly uow: UnitOfWork;
}

/** The command's result as the caller sees it: the new session, or why the rule rejected it. */
export type CommandResult = Result<PlanningSession>;

/**
 * Load a session, apply one domain rule, save, and publish the events after the commit.
 * `change` may be async because some rules need an answer from a port first (for example the DinnerCalendar).
 */
export async function changeSession(
  deps: SessionDeps,
  id: SessionId,
  change: (session: PlanningSession) => Promise<Result<Outcome<PlanningSession, PlanningEvent>>>,
): Promise<CommandResult> {
  const result = await deps.uow.run(async () => {
    const session = await deps.sessions.get(id);
    if (!session) return { ok: false, reason: "unknown_session" } as const;
    const outcome = await change(session);
    if (!outcome.ok) return outcome;
    await deps.sessions.save(outcome.value.state);
    return outcome;
  });
  if (!result.ok) return result;
  await deps.events.publish(result.value.events);
  return { ok: true, value: result.value.state };
}
