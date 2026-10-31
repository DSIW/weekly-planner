import type { Recipe, RecipeId } from "../catalog/recipe.js";
import type { MemberId, ProposalId, SessionId } from "../shared/ids.js";
import { reject, succeed, type Outcome, type Result } from "../shared/result.js";
import { defaultPlanningConfig, type PlanningConfig } from "./config.js";
import { isBefore, isWeekend, type LocalDateTime, type PlanDate } from "./dates.js";
import { fitsWeekdayLimit, isDinnerCandidate } from "./eligibility.js";
import type { PlanningEvent } from "./events.js";

export type SessionStatus = "open" | "finalized" | "closed";
export type DayStatus = "open" | "planned" | "leftovers";
export type ProposalStatus = "pending" | "accepted" | "vetoed";

/** One date of a session. `recipe` is present exactly while the day is planned. */
export interface PlanDay {
  readonly date: PlanDate;
  readonly status: DayStatus;
  readonly recipe?: Recipe;
}

/** `decidedBy` is present once the proposal is accepted or vetoed. */
export interface Proposal {
  readonly id: ProposalId;
  readonly date: PlanDate;
  readonly recipe: Recipe;
  readonly proposedBy: MemberId;
  readonly status: ProposalStatus;
  readonly decidedBy?: MemberId;
}

export interface PassedSuggestion {
  readonly recipeId: RecipeId;
  readonly passedBy: MemberId;
}

/** Aggregate root: two or three dates the household agrees dinners for, with the votes that led there. */
export interface PlanningSession {
  readonly id: SessionId;
  readonly status: SessionStatus;
  readonly startedBy: MemberId;
  readonly startedAt: number;
  /** Ordered by date. */
  readonly days: readonly PlanDay[];
  readonly proposals: readonly Proposal[];
  readonly passes: readonly PassedSuggestion[];
  /** The finalize reminder fires once. */
  readonly reminderSent: boolean;
}

type Done = Result<Outcome<PlanningSession, PlanningEvent>>;

const done = (state: PlanningSession, ...events: PlanningEvent[]): Done => succeed({ state, events });

// --- Projections -----------------------------------------------------------------------------

export const dayOn = (s: PlanningSession, date: PlanDate): PlanDay | undefined => s.days.find((d) => d.date === date);

export const openDays = (s: PlanningSession): PlanDay[] => s.days.filter((d) => d.status === "open");

export const plannedDays = (s: PlanningSession): PlanDay[] => s.days.filter((d) => d.status === "planned");

/** The day the deck is currently filling: the earliest day that is still open. */
export const nextOpenDay = (s: PlanningSession): PlanDay | undefined => openDays(s)[0];

const plannedRecipeIds = (s: PlanningSession): Set<RecipeId> =>
  new Set(plannedDays(s).flatMap((d) => (d.recipe ? [d.recipe.id] : [])));

export const vetoedRecipeIds = (s: PlanningSession): Set<RecipeId> =>
  new Set(s.proposals.filter((p) => p.status === "vetoed").map((p) => p.recipe.id));

export const passedRecipeIds = (s: PlanningSession): Set<RecipeId> => new Set(s.passes.map((p) => p.recipeId));

/** A recipe may go on a weekday only within the time limit; weekends have none. */
const fitsDate = (recipe: Recipe, date: PlanDate, config: PlanningConfig): boolean =>
  isWeekend(date) || fitsWeekdayLimit(recipe, config.weekdayTimeLimitMinutes);

// --- Helpers for state changes ---------------------------------------------------------------

const withDay = (s: PlanningSession, date: PlanDate, day: PlanDay): PlanningSession => ({
  ...s,
  days: s.days.map((d) => (d.date === date ? day : d)),
});

const plannedWith = (date: PlanDate, recipe: Recipe): PlanDay => ({ date, status: "planned", recipe });
const openOn = (date: PlanDate): PlanDay => ({ date, status: "open" });

// --- Rules -----------------------------------------------------------------------------------

export interface StartSessionCommand {
  readonly id: SessionId;
  readonly startedBy: MemberId;
  readonly dates: readonly PlanDate[];
  readonly now: number;
  /** Another session is still open; the caller asks the repository (the aggregate cannot see other sessions). */
  readonly openSessionExists?: boolean;
}

/** rule StartSession */
export function startSession(
  cmd: StartSessionCommand,
  config: PlanningConfig = defaultPlanningConfig,
): Result<Outcome<PlanningSession, PlanningEvent>> {
  if (cmd.openSessionExists) return reject("session_already_open");
  if (new Set(cmd.dates).size !== cmd.dates.length) return reject("duplicate_dates");
  if (cmd.dates.length < config.minDaysPerSession) return reject("too_few_days");
  if (cmd.dates.length > config.maxDaysPerSession) return reject("too_many_days");
  const dates = [...cmd.dates].sort();
  const state: PlanningSession = {
    id: cmd.id,
    status: "open",
    startedBy: cmd.startedBy,
    startedAt: cmd.now,
    days: dates.map(openOn),
    proposals: [],
    passes: [],
    reminderSent: false,
  };
  return done(state, { type: "SessionStarted", sessionId: cmd.id, dates });
}

export interface ProposeRecipeCommand {
  readonly proposalId: ProposalId;
  readonly member: MemberId;
  readonly date: PlanDate;
  readonly recipe: Recipe;
}

/** rule ProposeRecipe */
export function proposeRecipe(
  s: PlanningSession,
  cmd: ProposeRecipeCommand,
  config: PlanningConfig = defaultPlanningConfig,
): Done {
  if (s.status !== "open") return reject("session_not_open");
  const day = dayOn(s, cmd.date);
  if (!day) return reject("unknown_day");
  if (day.status !== "open") return reject("day_not_open");
  if (nextOpenDay(s)?.date !== cmd.date) return reject("not_next_open_day");
  if (s.proposals.some((p) => p.date === cmd.date && p.status === "pending")) return reject("proposal_already_pending");
  if (!isDinnerCandidate(cmd.recipe)) return reject("not_a_dinner");
  if (vetoedRecipeIds(s).has(cmd.recipe.id)) return reject("recipe_vetoed");
  if (passedRecipeIds(s).has(cmd.recipe.id)) return reject("recipe_passed");
  if (plannedRecipeIds(s).has(cmd.recipe.id)) return reject("recipe_already_planned");
  if (!fitsDate(cmd.recipe, cmd.date, config)) return reject("too_long_for_weekday");
  const proposal: Proposal = {
    id: cmd.proposalId,
    date: cmd.date,
    recipe: cmd.recipe,
    proposedBy: cmd.member,
    status: "pending",
  };
  return done(
    { ...s, proposals: [...s.proposals, proposal] },
    {
      type: "RecipeProposed",
      sessionId: s.id,
      proposalId: proposal.id,
      date: cmd.date,
      recipeId: cmd.recipe.id,
      proposedBy: cmd.member,
    },
  );
}

/** rule PassSuggestion */
export function passSuggestion(s: PlanningSession, cmd: { member: MemberId; recipe: Recipe }): Done {
  if (s.status !== "open") return reject("session_not_open");
  if (passedRecipeIds(s).has(cmd.recipe.id)) return reject("already_passed");
  return done(
    { ...s, passes: [...s.passes, { recipeId: cmd.recipe.id, passedBy: cmd.member }] },
    { type: "SuggestionPassed", sessionId: s.id, recipeId: cmd.recipe.id, passedBy: cmd.member },
  );
}

const decide = (s: PlanningSession, p: Proposal, status: "accepted" | "vetoed", by: MemberId): PlanningSession => ({
  ...s,
  proposals: s.proposals.map((x) => (x.id === p.id ? { ...x, status, decidedBy: by } : x)),
});

export interface AcceptProposalCommand {
  readonly member: MemberId;
  readonly proposalId: ProposalId;
  /** Another session already planned a dinner on this date; the use case asks the DinnerCalendar. */
  readonly dateTakenElsewhere: boolean;
}

/** rule AcceptProposal */
export function acceptProposal(
  s: PlanningSession,
  cmd: AcceptProposalCommand,
  config: PlanningConfig = defaultPlanningConfig,
): Done {
  const proposal = s.proposals.find((p) => p.id === cmd.proposalId);
  if (!proposal) return reject("unknown_proposal");
  if (proposal.status !== "pending") return reject("proposal_not_pending");
  if (s.status !== "open") return reject("session_not_open");
  if (dayOn(s, proposal.date)?.status !== "open") return reject("day_not_open");
  if (cmd.member === proposal.proposedBy) return reject("own_proposal");
  if (cmd.dateTakenElsewhere) return reject("date_already_taken");
  // Guards the session invariants even when proposals were made in a different order than they are decided.
  if (plannedRecipeIds(s).has(proposal.recipe.id)) return reject("recipe_already_planned");
  if (!fitsDate(proposal.recipe, proposal.date, config)) return reject("too_long_for_weekday");
  return done(
    withDay(decide(s, proposal, "accepted", cmd.member), proposal.date, plannedWith(proposal.date, proposal.recipe)),
    {
      type: "ProposalAccepted",
      sessionId: s.id,
      proposalId: proposal.id,
      date: proposal.date,
      recipeId: proposal.recipe.id,
      decidedBy: cmd.member,
    },
  );
}

/** rule VetoProposal */
export function vetoProposal(s: PlanningSession, cmd: { member: MemberId; proposalId: ProposalId }): Done {
  const proposal = s.proposals.find((p) => p.id === cmd.proposalId);
  if (!proposal) return reject("unknown_proposal");
  if (proposal.status !== "pending") return reject("proposal_not_pending");
  if (s.status !== "open") return reject("session_not_open");
  if (cmd.member === proposal.proposedBy) return reject("own_proposal");
  return done(decide(s, proposal, "vetoed", cmd.member), {
    type: "ProposalVetoed",
    sessionId: s.id,
    proposalId: proposal.id,
    date: proposal.date,
    recipeId: proposal.recipe.id,
    decidedBy: cmd.member,
  });
}

/** rule MarkLeftoverDay */
export function markLeftoverDay(s: PlanningSession, cmd: { member: MemberId; date: PlanDate }): Done {
  if (s.status !== "open") return reject("session_not_open");
  const day = dayOn(s, cmd.date);
  if (!day) return reject("unknown_day");
  if (day.status !== "open") return reject("day_not_open");
  return done(withDay(s, cmd.date, { date: cmd.date, status: "leftovers" }), {
    type: "DayMarkedLeftovers",
    sessionId: s.id,
    date: cmd.date,
  });
}

/** rules ReopenPlannedDay and ReopenLeftoverDay */
export function reopenDay(s: PlanningSession, cmd: { member: MemberId; date: PlanDate }): Done {
  if (s.status !== "open") return reject("session_not_open");
  const day = dayOn(s, cmd.date);
  if (!day) return reject("unknown_day");
  if (day.status === "open") return reject("day_already_open");
  return done(withDay(s, cmd.date, openOn(cmd.date)), { type: "DayReopened", sessionId: s.id, date: cmd.date });
}

/** rule SwapPlannedDays */
export function swapPlannedDays(
  s: PlanningSession,
  cmd: { member: MemberId; a: PlanDate; b: PlanDate },
  config: PlanningConfig = defaultPlanningConfig,
): Done {
  if (s.status !== "open") return reject("session_not_open");
  if (cmd.a === cmd.b) return reject("same_day");
  const a = dayOn(s, cmd.a);
  const b = dayOn(s, cmd.b);
  if (!a || !b) return reject("unknown_day");
  if (a.status !== "planned" || b.status !== "planned" || !a.recipe || !b.recipe) return reject("day_not_planned");
  if (!fitsDate(a.recipe, b.date, config) || !fitsDate(b.recipe, a.date, config)) return reject("too_long_for_weekday");
  const swapped = withDay(withDay(s, a.date, plannedWith(a.date, b.recipe)), b.date, plannedWith(b.date, a.recipe));
  return done(swapped, { type: "DaysSwapped", sessionId: s.id, dates: [a.date, b.date] });
}

/** rule MovePlannedDay */
export function movePlannedDay(
  s: PlanningSession,
  cmd: {
    member: MemberId;
    from: PlanDate;
    to: PlanDate;
    /** Another session already planned a dinner on the target date; the use case asks the DinnerCalendar. */
    dateTakenElsewhere?: boolean;
  },
  config: PlanningConfig = defaultPlanningConfig,
): Done {
  if (s.status !== "open") return reject("session_not_open");
  const from = dayOn(s, cmd.from);
  const to = dayOn(s, cmd.to);
  if (!from || !to) return reject("unknown_day");
  if (from.status !== "planned" || !from.recipe) return reject("day_not_planned");
  if (to.status !== "open") return reject("target_not_open");
  if (cmd.dateTakenElsewhere) return reject("date_already_taken");
  if (!fitsDate(from.recipe, to.date, config)) return reject("too_long_for_weekday");
  const moved = withDay(withDay(s, to.date, plannedWith(to.date, from.recipe)), from.date, openOn(from.date));
  return done(moved, { type: "DayMoved", sessionId: s.id, from: from.date, to: to.date });
}

/** rule FinalizePlan: announces the ingredients of every agreed day, for the household's portions. */
export function finalizePlan(
  s: PlanningSession,
  _cmd: { member: MemberId },
  config: PlanningConfig = defaultPlanningConfig,
): Done {
  if (s.status !== "open") return reject("session_not_open");
  const planned = plannedDays(s);
  if (planned.length === 0) return reject("nothing_planned");
  return done(
    { ...s, status: "finalized" },
    {
      type: "PlanFinalized",
      sessionId: s.id,
      dinners: planned.flatMap((d) =>
        d.recipe
          ? [
              {
                date: d.date,
                recipeId: d.recipe.id,
                recipeName: d.recipe.name,
                recipeYields: d.recipe.yields,
                portions: config.householdSize,
              },
            ]
          : [],
      ),
    },
  );
}

/** rules AbandonSession and CloseFinalizedSession */
export function closeSession(s: PlanningSession, _cmd: { member: MemberId }): Done {
  if (s.status === "closed") return reject("session_already_closed");
  return done({ ...s, status: "closed" }, { type: "SessionClosed", sessionId: s.id });
}

// --- Reminder (temporal rule RemindToFinalize) -----------------------------------------------

/** When the reminder to finalize is due: the morning of the first agreed day. Null while nothing is agreed. */
export function reminderDueAt(
  s: PlanningSession,
  config: PlanningConfig = defaultPlanningConfig,
): LocalDateTime | null {
  const first = plannedDays(s)[0];
  return first ? { date: first.date, hour: config.reminderHour } : null;
}

/** rule RemindToFinalize: raises the reminder once, when it is due and the plan is still open. */
export function remindToFinalize(
  s: PlanningSession,
  now: LocalDateTime,
  config: PlanningConfig = defaultPlanningConfig,
): Done {
  const due = reminderDueAt(s, config);
  if (s.status !== "open" || s.reminderSent || !due || isBefore(now, due)) return done(s);
  return done({ ...s, reminderSent: true }, { type: "FinalizeReminderDue", sessionId: s.id });
}
