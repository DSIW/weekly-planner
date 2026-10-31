import {
  acceptProposal,
  closeSession,
  eligibleRecipes,
  finalizePlan,
  markLeftoverDay,
  movePlannedDay,
  needsPlanningAhead,
  nextOpenDay,
  passSuggestion,
  proposalId,
  proposeRecipe,
  reopenDay,
  sessionId,
  startSession,
  swapPlannedDays,
  vetoProposal,
  type MemberId,
  type Outcome,
  type PlanningEvent,
  type PlanningSession,
  type Recipe,
  type Result,
  type PlanDate,
  type PlanningConfig,
  type ProposalId,
  type RecipeId,
  type SessionId,
} from "@weekly-planner/domain";
import type { RecipeCatalog } from "../ports/recipe-catalog.js";
import { OpenSessionConflict, type SessionRepository } from "../ports/repositories.js";
import type { DinnerCalendar, IdGenerator, Clock } from "../ports/services.js";
import { changeSession, type CommandResult, type SessionDeps } from "./support.js";

const unknownRecipe: CommandResult = { ok: false, reason: "unknown_recipe" };

/** rule StartSession */
export class StartSession {
  constructor(
    private readonly deps: SessionDeps & { ids: IdGenerator; clock: Clock },
    private readonly config: PlanningConfig,
  ) {}

  async execute(cmd: { member: MemberId; dates: readonly PlanDate[] }): Promise<CommandResult> {
    const { deps } = this;
    let result: Result<Outcome<PlanningSession, PlanningEvent>>;
    try {
      result = await deps.uow.run(async () => {
        const outcome = startSession(
          {
            id: sessionId(deps.ids.next()),
            startedBy: cmd.member,
            dates: cmd.dates,
            now: deps.clock.now(),
            openSessionExists: (await deps.sessions.findOpen()) !== null,
          },
          this.config,
        );
        if (outcome.ok) await deps.sessions.save(outcome.value.state);
        return outcome;
      });
    } catch (error) {
      if (error instanceof OpenSessionConflict) return { ok: false, reason: "session_already_open" };
      throw error;
    }
    if (!result.ok) return result;
    await deps.events.publish(result.value.events);
    return { ok: true, value: result.value.state };
  }
}

/** What both phones show: the session that is still open, or none. */
export class GetCurrentSession {
  constructor(private readonly sessions: Pick<SessionRepository, "findOpen">) {}

  execute(): Promise<PlanningSession | null> {
    return this.sessions.findOpen();
  }
}

/** The recipes a member may propose for the next open day, by name, and which day that is. Read-only. */
export class ListEligibleRecipes {
  constructor(
    private readonly deps: { sessions: Pick<SessionRepository, "get">; catalog: Pick<RecipeCatalog, "listAll"> },
    private readonly config: PlanningConfig,
  ) {}

  async execute(cmd: { sessionId: SessionId }): Promise<{ date: PlanDate; recipes: readonly Recipe[] } | null> {
    const session = await this.deps.sessions.get(cmd.sessionId);
    const day = session && session.status === "open" ? nextOpenDay(session) : undefined;
    if (!session || !day) return null;
    const ready = (await this.deps.catalog.listAll()).flatMap((e) => (e.kind === "ready" ? [e.recipe] : []));
    const ahead = (r: Recipe) => (needsPlanningAhead(r, this.config) ? 1 : 0);
    const recipes = eligibleRecipes(session, ready, this.config).sort(
      (a, b) => ahead(a) - ahead(b) || a.name.localeCompare(b.name, "de"),
    );
    return { date: day.date, recipes };
  }
}

/** Re-reads the recipes from KitchenOwl, for when someone just fixed a tag or a time there. */
export class RefreshRecipes {
  constructor(private readonly catalog: Pick<RecipeCatalog, "refresh">) {}

  execute(): Promise<void> {
    return this.catalog.refresh();
  }
}

/** rule ProposeRecipe */
export class ProposeRecipe {
  constructor(
    private readonly deps: SessionDeps & { catalog: RecipeCatalog; ids: IdGenerator },
    private readonly config: PlanningConfig,
  ) {}

  async execute(cmd: {
    member: MemberId;
    sessionId: SessionId;
    date: PlanDate;
    recipeId: RecipeId;
  }): Promise<CommandResult> {
    const recipe = await this.deps.catalog.find(cmd.recipeId);
    if (!recipe) return unknownRecipe;
    const id = proposalId(this.deps.ids.next());
    return changeSession(this.deps, cmd.sessionId, async (s) =>
      proposeRecipe(s, { proposalId: id, member: cmd.member, date: cmd.date, recipe }, this.config),
    );
  }
}

/** rule PassSuggestion */
export class PassSuggestion {
  constructor(private readonly deps: SessionDeps & { catalog: RecipeCatalog }) {}

  async execute(cmd: { member: MemberId; sessionId: SessionId; recipeId: RecipeId }): Promise<CommandResult> {
    const recipe = await this.deps.catalog.find(cmd.recipeId);
    if (!recipe) return unknownRecipe;
    return changeSession(this.deps, cmd.sessionId, async (s) => passSuggestion(s, { member: cmd.member, recipe }));
  }
}

/** rule AcceptProposal: asks the DinnerCalendar whether another session already planned the date. */
export class AcceptProposal {
  constructor(
    private readonly deps: SessionDeps & { calendar: DinnerCalendar },
    private readonly config: PlanningConfig,
  ) {}

  async execute(cmd: { member: MemberId; sessionId: SessionId; proposalId: ProposalId }): Promise<CommandResult> {
    return changeSession(this.deps, cmd.sessionId, async (s) => {
      const date = s.proposals.find((p) => p.id === cmd.proposalId)?.date;
      const dateTakenElsewhere = date ? await this.deps.calendar.isDateTaken(date, s.id) : false;
      return acceptProposal(s, { member: cmd.member, proposalId: cmd.proposalId, dateTakenElsewhere }, this.config);
    });
  }
}

/** rule VetoProposal */
export class VetoProposal {
  constructor(private readonly deps: SessionDeps) {}

  execute(cmd: { member: MemberId; sessionId: SessionId; proposalId: ProposalId }): Promise<CommandResult> {
    return changeSession(this.deps, cmd.sessionId, async (s) => vetoProposal(s, cmd));
  }
}

/** rule MarkLeftoverDay */
export class MarkLeftoverDay {
  constructor(private readonly deps: SessionDeps) {}

  execute(cmd: { member: MemberId; sessionId: SessionId; date: PlanDate }): Promise<CommandResult> {
    return changeSession(this.deps, cmd.sessionId, async (s) => markLeftoverDay(s, cmd));
  }
}

/** rules ReopenPlannedDay and ReopenLeftoverDay */
export class ReopenDay {
  constructor(private readonly deps: SessionDeps) {}

  execute(cmd: { member: MemberId; sessionId: SessionId; date: PlanDate }): Promise<CommandResult> {
    return changeSession(this.deps, cmd.sessionId, async (s) => reopenDay(s, cmd));
  }
}

/** rule SwapPlannedDays */
export class SwapPlannedDays {
  constructor(
    private readonly deps: SessionDeps,
    private readonly config: PlanningConfig,
  ) {}

  execute(cmd: { member: MemberId; sessionId: SessionId; a: PlanDate; b: PlanDate }): Promise<CommandResult> {
    return changeSession(this.deps, cmd.sessionId, async (s) => swapPlannedDays(s, cmd, this.config));
  }
}

/** rule MovePlannedDay: asks the DinnerCalendar whether another session already planned the target date. */
export class MovePlannedDay {
  constructor(
    private readonly deps: SessionDeps & { calendar: DinnerCalendar },
    private readonly config: PlanningConfig,
  ) {}

  execute(cmd: { member: MemberId; sessionId: SessionId; from: PlanDate; to: PlanDate }): Promise<CommandResult> {
    return changeSession(this.deps, cmd.sessionId, async (s) => {
      const dateTakenElsewhere = await this.deps.calendar.isDateTaken(cmd.to, s.id);
      return movePlannedDay(s, { member: cmd.member, from: cmd.from, to: cmd.to, dateTakenElsewhere }, this.config);
    });
  }
}

/** rule FinalizePlan */
export class FinalizePlan {
  constructor(
    private readonly deps: SessionDeps,
    private readonly config: PlanningConfig,
  ) {}

  execute(cmd: { member: MemberId; sessionId: SessionId }): Promise<CommandResult> {
    return changeSession(this.deps, cmd.sessionId, async (s) => finalizePlan(s, cmd, this.config));
  }
}

/** rules AbandonSession and CloseFinalizedSession */
export class CloseSession {
  constructor(private readonly deps: SessionDeps) {}

  execute(cmd: { member: MemberId; sessionId: SessionId }): Promise<CommandResult> {
    return changeSession(this.deps, cmd.sessionId, async (s) => closeSession(s, cmd));
  }
}
