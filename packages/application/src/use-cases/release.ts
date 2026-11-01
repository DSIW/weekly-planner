import { releaseRemovedDinner, type PlanningEvent } from "@weekly-planner/domain";
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
