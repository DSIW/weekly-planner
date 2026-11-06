import {
  releaseRemovedDinner,
  type PlanDate,
  type PlanningEvent,
  type Result,
  type SessionId,
} from "@weekly-planner/domain";
import type { PlannerGateway } from "../ports/planner-gateway.js";
import type { ExportRepository, SessionRepository } from "../ports/repositories.js";
import type { Clock, EventPublisher, PlannerView, UnitOfWork } from "../ports/services.js";

/**
 * rule ReleaseRemovedDinner (run by the scheduler and before the taken dates are listed): a dinner that was written
 * to KitchenOwl's planner and is no longer there stops holding its date. When KitchenOwl does not answer nothing is
 * released: a date is never freed on a guess.
 */
export class ReleaseRemovedDinners {
  constructor(
    private readonly deps: {
      sessions: SessionRepository;
      exports: ExportRepository;
      planner: PlannerView;
      events: EventPublisher;
      uow: UnitOfWork;
      clock: Clock;
    },
  ) {}

  /** Returns the number of dinners released. */
  async execute(): Promise<number> {
    const { deps } = this;
    const today = deps.clock.today();
    const onPlanner = await deps.planner.plannedDatesFrom(today);
    if (!onPlanner) return 0;
    let released = 0;
    for (const looked of await deps.sessions.listAll()) {
      if (looked.status !== "finalized") continue;
      const gone = looked.days.filter(
        (d) => d.status === "planned" && !d.removedInPlanner && d.date >= today && !onPlanner.has(d.date),
      );
      if (gone.length === 0) continue;
      const events = await deps.uow.run(async () => {
        let session = await deps.sessions.get(looked.id);
        if (!session) return [];
        const exported = await deps.exports.get(looked.id);
        const changed: PlanningEvent[] = [];
        for (const day of gone) {
          const wasExported = exported?.days.some((d) => d.date === day.date && d.status === "done") ?? false;
          const outcome = releaseRemovedDinner(session, { date: day.date, wasExported });
          if (!outcome.ok) continue;
          session = outcome.value.state;
          changed.push(...outcome.value.events);
        }
        if (changed.length > 0) await deps.sessions.save(session);
        return changed;
      });
      if (events.length === 0) continue;
      await deps.events.publish(events);
      released += events.length;
    }
    return released;
  }
}

/**
 * rule ResetFinalizedDay: a member gives up a finalized dinner before its day is over. It is taken off KitchenOwl's
 * planner first (when that fails nothing changes here), then its date is let go like one somebody removed there. The
 * shopping list is locked: what is on it stays.
 */
export class ResetFinalizedDay {
  constructor(
    private readonly deps: {
      sessions: SessionRepository;
      exports: Pick<ExportRepository, "get">;
      planner: Pick<PlannerGateway, "removePlannerEntry">;
      events: EventPublisher;
      uow: UnitOfWork;
      clock: Clock;
    },
  ) {}

  async execute(cmd: { sessionId: SessionId; date: PlanDate }): Promise<Result<true>> {
    const { deps } = this;
    const session = await deps.sessions.get(cmd.sessionId);
    if (!session) return { ok: false, reason: "unknown_session" };
    const day = session.days.find((d) => d.date === cmd.date);
    const exported = await deps.exports.get(cmd.sessionId);
    const onPlanner = exported?.days.some((d) => d.date === cmd.date && d.status === "done") ?? false;
    // The same checks as the release rule: asked now, before KitchenOwl is touched.
    const check = releaseRemovedDinner(session, { date: cmd.date, wasExported: onPlanner });
    if (!check.ok) return check;
    if (cmd.date < deps.clock.today()) return { ok: false, reason: "day_passed" };
    if (!day?.recipe) return { ok: false, reason: "day_not_planned" };
    try {
      await deps.planner.removePlannerEntry({ recipeId: day.recipe.id, date: cmd.date });
    } catch {
      return { ok: false, reason: "kitchenowl_unavailable" };
    }
    const events = await deps.uow.run(async () => {
      const fresh = await deps.sessions.get(cmd.sessionId);
      if (!fresh) return [];
      const outcome = releaseRemovedDinner(fresh, { date: cmd.date, wasExported: onPlanner });
      if (!outcome.ok) return [];
      await deps.sessions.save(outcome.value.state);
      return outcome.value.events;
    });
    await deps.events.publish(events);
    return { ok: true, value: true };
  }
}
