import {
  dinnersDueForLogging,
  logPlannedMeal,
  mealLogEntryId,
  remindToFinalize,
  type MealLogEvent,
  type PlanningConfig,
} from "@weekly-planner/domain";
import type { MealLogRepository, SessionRepository } from "../ports/repositories.js";
import type { Clock, EventPublisher, IdGenerator, Notifier, UnitOfWork } from "../ports/services.js";

/** rule RemindToFinalize (temporal, run by the scheduler): tells both members once that a plan is still waiting. */
export class RemindToFinalize {
  constructor(
    private readonly deps: {
      sessions: SessionRepository;
      notifier: Notifier;
      events: EventPublisher;
      uow: UnitOfWork;
      clock: Clock;
    },
    private readonly config: PlanningConfig,
  ) {}

  /** Returns the number of reminders sent. */
  async execute(): Promise<number> {
    const { deps } = this;
    let sent = 0;
    for (const looked of await deps.sessions.listAll()) {
      // The list is only a first look: the decision is made on the session as it is when the reminder is saved.
      const reminded = await deps.uow.run(async () => {
        const session = await deps.sessions.get(looked.id);
        if (!session) return null;
        const outcome = remindToFinalize(session, deps.clock.localNow(), this.config);
        if (!outcome.ok || outcome.value.events.length === 0) return null;
        await deps.sessions.save(outcome.value.state);
        return outcome.value;
      });
      if (!reminded) continue;
      await deps.notifier.finalizeReminder(reminded.state);
      await deps.events.publish(reminded.events);
      sent++;
    }
    return sent;
  }
}

/** rule LogPlannedMeal (temporal, run daily): each planned dinner of a finalized plan becomes an unconfirmed log entry. */
export class LogPlannedMeals {
  constructor(
    private readonly deps: {
      sessions: SessionRepository;
      mealLog: MealLogRepository;
      events: EventPublisher;
      uow: UnitOfWork;
      clock: Clock;
      ids: IdGenerator;
    },
  ) {}

  /** Returns the number of entries created. */
  async execute(): Promise<number> {
    const { deps } = this;
    const logged = new Set(await deps.mealLog.loggedPlanDates());
    const events: MealLogEvent[] = [];
    for (const session of await deps.sessions.listAll()) {
      for (const dinner of dinnersDueForLogging(session, deps.clock.today(), logged)) {
        const outcome = logPlannedMeal({ id: mealLogEntryId(deps.ids.next()), dinner });
        await deps.uow.run(() => deps.mealLog.save(outcome.state));
        logged.add(dinner.date); // one dinner per date, even if a later session also lists it
        events.push(...outcome.events);
      }
    }
    await deps.events.publish(events);
    return events.length;
  }
}
