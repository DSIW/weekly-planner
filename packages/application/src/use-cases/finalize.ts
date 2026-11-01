import {
  beginStep,
  completeStep,
  consolidateIngredients,
  exportComplete,
  failStep,
  finalizePlan,
  leaveOut,
  newExport,
  nextStep,
  plannedDays,
  retriableAfterRefusal,
  type ExportFailure,
  type ExportStep,
  type FinalizeExport,
  type ListItem,
  type MemberId,
  type Outcome,
  type PlanDate,
  type PlanningConfig,
  type PlanningEvent,
  type PlanningSession,
  type Recipe,
  type RecipeId,
  type Result,
  type SessionId,
} from "@weekly-planner/domain";
import { ExportNotApplied, type PlannerGateway } from "../ports/planner-gateway.js";
import type { RecipeCatalog } from "../ports/recipe-catalog.js";
import type { ExportRepository, SessionRepository } from "../ports/repositories.js";
import type { EventPublisher, UnitOfWork } from "../ports/services.js";
import { changeSession, type SessionDeps } from "./support.js";

/** What finalizing shows and sends: the consolidated list and the days it comes from. */
interface FinalizePreview {
  readonly dinners: readonly { date: PlanDate; recipeName: string }[];
  readonly items: readonly ListItem[];
}

type Catalog = Pick<RecipeCatalog, "listAll">;

/** The planned days with their ingredients: read from the catalogue now, or from the copy kept in the session. */
async function ingredientSource(session: PlanningSession, catalog: Catalog): Promise<Map<RecipeId, Recipe>> {
  const fresh = new Map<RecipeId, Recipe>();
  for (const entry of await catalog.listAll()) if (entry.kind === "ready") fresh.set(entry.recipe.id, entry.recipe);
  const out = new Map<RecipeId, Recipe>();
  for (const day of plannedDays(session)) {
    if (day.recipe) out.set(day.recipe.id, fresh.get(day.recipe.id) ?? day.recipe);
  }
  return out;
}

function previewFor(session: PlanningSession, recipes: Map<RecipeId, Recipe>, config: PlanningConfig): FinalizePreview {
  const planned = plannedDays(session).flatMap((d) =>
    d.recipe ? [{ date: d.date, recipe: recipes.get(d.recipe.id) ?? d.recipe }] : [],
  );
  return {
    dinners: planned.map((p) => ({ date: p.date, recipeName: p.recipe.name })),
    items: consolidateIngredients(
      planned.map((p) => ({
        recipeName: p.recipe.name,
        yields: p.recipe.yields,
        ingredients: p.recipe.ingredients ?? [],
      })),
      config.householdSize,
    ),
  };
}

/** The consolidated shopping list of an open session as finalizing would send it. Read-only. */
export class GetFinalizePreview {
  constructor(
    private readonly deps: { sessions: Pick<SessionRepository, "get">; catalog: Catalog },
    private readonly config: PlanningConfig,
  ) {}

  async execute(cmd: { sessionId: SessionId }): Promise<Result<FinalizePreview>> {
    const session = await this.deps.sessions.get(cmd.sessionId);
    if (!session) return { ok: false, reason: "unknown_session" };
    if (session.status !== "open") return { ok: false, reason: "session_not_open" };
    if (plannedDays(session).length === 0) return { ok: false, reason: "nothing_planned" };
    return { ok: true, value: previewFor(session, await ingredientSource(session, this.deps.catalog), this.config) };
  }
}

interface ExporterDeps {
  readonly exports: ExportRepository;
  readonly planner: PlannerGateway;
  readonly events: EventPublisher;
  readonly uow: UnitOfWork;
}

/**
 * The export saga (decision D23): sends the steps of a finalized plan one by one. Each step is saved as "sending" in
 * its own transaction before the request goes out and as "done" after the answer, so no crash and no retry can send
 * a step twice by itself. A step that was sent without an answer waits for a member to decide.
 */
export class ExportFinalizedPlan {
  /** Sessions being exported right now by this process; a second run would find steps "sending" and mislead. */
  private readonly running = new Set<SessionId>();

  constructor(private readonly deps: ExporterDeps) {}

  async run(sessionId: SessionId, options: { resendUnconfirmed: boolean }): Promise<Result<FinalizeExport>> {
    if (this.running.has(sessionId)) return { ok: false, reason: "export_running" };
    this.running.add(sessionId);
    try {
      return await this.loop(sessionId, options);
    } finally {
      this.running.delete(sessionId);
    }
  }

  private async loop(sessionId: SessionId, options: { resendUnconfirmed: boolean }): Promise<Result<FinalizeExport>> {
    let resend = options.resendUnconfirmed;
    for (;;) {
      const begun = await this.apply(sessionId, (e) => {
        const step = nextStep(e);
        if (!step) return { ok: false, reason: "export_complete" };
        const outcome = beginStep(e, step, { resendUnconfirmed: resend });
        return outcome.ok ? { ok: true, value: { ...outcome.value, step } } : outcome;
      });
      if (!begun.ok) {
        // Nothing left to send is the normal end; any other refusal is the caller's to hear about.
        if (begun.reason !== "export_complete") return begun;
        return this.current(sessionId);
      }
      // Only the first step may be a deliberate resend of an unconfirmed one.
      resend = false;
      const { step, state } = begun.value;
      let failure: ExportFailure | null = null;
      try {
        await this.send(state, step);
      } catch (error) {
        failure = error instanceof ExportNotApplied ? "refused" : "unconfirmed";
      }
      const settled = await this.apply(sessionId, (e) => {
        const outcome = failure === null ? completeStep(e, step) : failStep(e, step, failure);
        return outcome.ok ? { ok: true, value: { ...outcome.value, step } } : outcome;
      });
      if (!settled.ok) return settled;
      if (failure !== null || exportComplete(settled.value.state)) return { ok: true, value: settled.value.state };
    }
  }

  private async send(e: FinalizeExport, step: ExportStep): Promise<void> {
    if (step.kind === "list") {
      const items = e.list.items.map((i) => ({
        ...(i.id !== undefined ? { id: i.id } : {}),
        name: i.name,
        description: i.description,
        optional: false,
      }));
      // An empty list is a finished step without a request.
      if (items.length > 0) await this.deps.planner.addShoppingListItems(items);
      return;
    }
    const day = e.days.find((d) => d.date === step.date);
    if (day)
      await this.deps.planner.addPlannerEntry({ recipeId: day.recipeId, date: day.date, portions: day.portions });
  }

  private async current(sessionId: SessionId): Promise<Result<FinalizeExport>> {
    const e = await this.deps.exports.get(sessionId);
    return e ? { ok: true, value: e } : { ok: false, reason: "no_export" };
  }

  /** One domain change of the export, saved in its own transaction; its events go out after the commit. */
  private async apply<T extends { state: FinalizeExport; events: readonly PlanningEvent[] }>(
    sessionId: SessionId,
    change: (e: FinalizeExport) => Result<T>,
  ): Promise<Result<T>> {
    const { deps } = this;
    const result = await deps.uow.run(async (): Promise<Result<T>> => {
      const e = await deps.exports.get(sessionId);
      if (!e) return { ok: false, reason: "no_export" };
      const outcome = change(e);
      if (outcome.ok) await deps.exports.save(outcome.value.state);
      return outcome;
    });
    if (result.ok) await deps.events.publish(result.value.events);
    return result;
  }
}

/** rule FinalizePlan: locks the plan, fixes the consolidated list, then starts the export. */
export class FinalizePlan {
  constructor(
    private readonly deps: SessionDeps & { catalog: Catalog; exports: ExportRepository; exporter: ExportFinalizedPlan },
    private readonly config: PlanningConfig,
  ) {}

  async execute(cmd: {
    member: MemberId;
    sessionId: SessionId;
    /** Ingredients the household has in stock, by name: they stay off the shopping list. */
    skip?: readonly string[];
  }): Promise<Result<{ session: PlanningSession; export: FinalizeExport }>> {
    const { deps } = this;
    const before = await deps.sessions.get(cmd.sessionId);
    // Looked up before the transaction: it asks KitchenOwl. The session is read again inside it.
    const recipes = before && before.status === "open" ? await ingredientSource(before, deps.catalog) : new Map();
    let started: FinalizeExport | undefined;
    const finalized = await changeSession(deps, cmd.sessionId, async (s) => {
      const outcome: Result<Outcome<PlanningSession, PlanningEvent>> = finalizePlan(s, cmd, this.config);
      if (!outcome.ok) return outcome;
      const event = outcome.value.events[0];
      if (event?.type !== "PlanFinalized") return { ok: false, reason: "unexpected_event" };
      started = newExport(s.id, event.dinners, leaveOut(previewFor(s, recipes, this.config).items, cmd.skip ?? []));
      await deps.exports.save(started);
      return outcome;
    });
    if (!finalized.ok) return finalized;
    const exported = await deps.exporter.run(cmd.sessionId, { resendUnconfirmed: false });
    // The plan is finalized either way; a failure to start the export is the retry button's business.
    const state = exported.ok ? exported.value : (started as FinalizeExport);
    return { ok: true, value: { session: finalized.value, export: state } };
  }
}

/** Sends what is still missing after a failure. Steps sent without an answer wait for `resendUnconfirmed`. */
export class RetryExport {
  constructor(private readonly deps: { sessions: Pick<SessionRepository, "get">; exporter: ExportFinalizedPlan }) {}

  async execute(cmd: { sessionId: SessionId; resendUnconfirmed: boolean }): Promise<Result<FinalizeExport>> {
    const session = await this.deps.sessions.get(cmd.sessionId);
    if (!session) return { ok: false, reason: "unknown_session" };
    if (session.status !== "finalized") return { ok: false, reason: "session_not_finalized" };
    return this.deps.exporter.run(cmd.sessionId, { resendUnconfirmed: cmd.resendUnconfirmed });
  }
}

/**
 * rule RetryRefusedExports (run by the scheduler): sends again what KitchenOwl refused, since nothing was written.
 * A step that went out without an answer is left to the members.
 */
export class RetryRefusedExports {
  constructor(
    private readonly deps: {
      sessions: Pick<SessionRepository, "listAll">;
      exports: Pick<ExportRepository, "get">;
      exporter: ExportFinalizedPlan;
    },
  ) {}

  /** Returns the number of exports it tried again. */
  async execute(): Promise<number> {
    const { deps } = this;
    let tried = 0;
    for (const session of await deps.sessions.listAll()) {
      if (session.status !== "finalized") continue;
      const pending = await deps.exports.get(session.id);
      if (!pending || !retriableAfterRefusal(pending)) continue;
      await deps.exporter.run(session.id, { resendUnconfirmed: false });
      tried++;
    }
    return tried;
  }
}

/** How far a finalized session's export has come; null when it has none (not finalized, or from before S4). */
export class GetExport {
  constructor(private readonly exports: Pick<ExportRepository, "get">) {}

  execute(cmd: { sessionId: SessionId }): Promise<FinalizeExport | null> {
    return this.exports.get(cmd.sessionId);
  }
}

/**
 * What both phones show: the session that is still open; while none is, a finalized one whose export is not complete,
 * so a failed write can be retried (decision D24). A finalized session that was exported completely leaves the board.
 */
export class GetCurrentSession {
  constructor(
    private readonly deps: {
      sessions: Pick<SessionRepository, "findOpen" | "listAll">;
      exports: Pick<ExportRepository, "get">;
    },
  ) {}

  async execute(): Promise<PlanningSession | null> {
    const open = await this.deps.sessions.findOpen();
    if (open) return open;
    const finalized = (await this.deps.sessions.listAll()).filter((s) => s.status === "finalized").reverse();
    for (const s of finalized) {
      const e = await this.deps.exports.get(s.id);
      if (e && !exportComplete(e)) return s;
    }
    return null;
  }
}
