import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
  acceptProposal,
  closeSession,
  fetchCurrentSession,
  fetchFinalizePreview,
  fetchDeck,
  fetchEligibleRecipes,
  fetchMe,
  fetchPlannedDates,
  finalizePlan,
  listenForChanges,
  login,
  LoginFailed,
  logout,
  markLeftovers,
  moveDay,
  passRecipe,
  proposeRecipe,
  refreshRecipes,
  reopenDay,
  retryExport,
  SessionFailed,
  startSession,
  swapDays,
  vetoProposal,
  withdrawProposal,
  type ExportView,
  type LoginError,
  type PlanSession,
  type SessionError,
} from "./api";
import { ExportStatus } from "./ExportStatus";
import { FinalizePanel } from "./FinalizePanel";
import { LoginForm } from "./LoginForm";
import { DueMeals, MealHistory } from "./MealLogPanel";
import { Notifications } from "./Notifications";
import { PlanBoard } from "./PlanBoard";
import type { Drop } from "./plan-moves";
import { ProposalCard } from "./ProposalCard";
import { RecipePicker } from "./RecipePicker";
import { StartSessionForm } from "./StartSessionForm";
import { Stepper } from "./Stepper";
import { SwipeDeck } from "./SwipeDeck";

const SESSION_MESSAGES: Record<SessionError, string> = {
  session_already_open: "Es läuft schon eine Planung. Sie ist jetzt zu sehen.",
  session_not_open: "Die Planung wurde beendet.",
  proposal_already_pending: "Für diesen Tag wartet schon ein Vorschlag auf eine Antwort.",
  proposal_not_pending: "Darüber ist schon entschieden.",
  recipe_already_proposed: "Dieses Gericht wartet schon an einem anderen Tag auf eine Antwort.",
  not_your_proposal: "Das ist nicht dein Vorschlag.",
  not_next_open_day: "Es ist schon ein anderer Tag dran.",
  too_long_for_weekday: "Das Rezept ist für einen Wochentag zu lang.",
  day_not_planned: "Der Tag hat sich gerade geändert.",
  day_already_open: "Der Tag hat sich gerade geändert.",
  target_not_open: "Der Tag hat sich gerade geändert.",
  date_already_taken: "Für diesen Tag ist schon ein Essen geplant, in einer anderen Planung.",
  nothing_planned: "Es ist noch kein Tag geplant.",
  export_running: "Das Eintragen läuft gerade. Gleich noch einmal nachsehen.",
  step_unconfirmed:
    "Es ist unklar, ob der letzte Schritt angekommen ist. Bitte in KitchenOwl nachsehen und dann erneut senden.",
  session_not_finalized: "Die Planung ist nicht mehr abgeschlossen.",
  unknown_entry: "Diese Mahlzeit gibt es nicht mehr.",
  already_confirmed: "Das ist schon als gekocht bestätigt.",
  no_recipe: "Ohne Rezept lässt sich das nicht bestätigen. Wähle „Etwas anderes“.",
  date_in_future: "Eine Mahlzeit in der Zukunft lässt sich nicht eintragen.",
  unavailable: "Das hat nicht geklappt. Bitte später noch einmal versuchen.",
};

/** At least one agreed day, and nobody is voting on another. */
const canFinalize = (s: PlanSession): boolean =>
  s.days.some((d) => d.status === "planned") && !s.proposals.some((p) => p.status === "pending");

/** Why the shopping list cannot be reached yet, or null when it can. */
const blockedReason = (s: PlanSession): string | null =>
  s.proposals.some((p) => p.status === "pending")
    ? "Erst müssen alle Vorschläge beantwortet oder zurückgezogen sein."
    : s.days.some((d) => d.status === "planned")
      ? null
      : "Mindestens ein Tag braucht ein Gericht.";

/** What a member is told when an action failed; the server's reason when they can act on it. */
const messageFor = (error: unknown): string | null =>
  error === null ? null : SESSION_MESSAGES[error instanceof SessionFailed ? error.reason : "unavailable"];

/**
 * Deciding and proposing. Proposals of the other member wait for an answer from you as cards; the deck goes on with
 * the next day that has no proposal yet, so nobody waits for an answer. Your own waiting proposals are rows of the
 * plan above.
 */
function Proposing({
  session,
  meId,
  refetch,
  apply,
}: {
  session: PlanSession;
  meId: string;
  refetch: () => void;
  apply: (s: PlanSession) => void;
}) {
  const [view, setView] = useState<"deck" | "list">("deck");
  const theirs = session.proposals.filter((p) => p.status === "pending" && p.proposedBy !== meId);
  const open = session.days.some(
    (d) => d.status === "open" && !session.proposals.some((p) => p.status === "pending" && p.date === d.date),
  );
  const deck = useQuery({
    queryKey: ["session", "deck", session.id],
    queryFn: () => fetchDeck(session.id),
    enabled: open && view === "deck",
  });
  const eligible = useQuery({
    queryKey: ["session", "eligible", session.id],
    queryFn: () => fetchEligibleRecipes(session.id),
    enabled: open && view === "list",
  });
  const settle = { onSuccess: apply, onSettled: refetch };
  const propose = useMutation({
    mutationFn: (v: { date: string; recipeId: number }) => proposeRecipe(session.id, v.date, v.recipeId),
    ...settle,
  });
  const pass = useMutation({ mutationFn: (recipeId: number) => passRecipe(session.id, recipeId), ...settle });
  const accept = useMutation({ mutationFn: (id: string) => acceptProposal(session.id, id), ...settle });
  const veto = useMutation({ mutationFn: (id: string) => vetoProposal(session.id, id), ...settle });
  const refresh = useMutation({ mutationFn: refreshRecipes, onSettled: refetch });

  const decide = theirs.map((proposal) => (
    <ProposalCard
      key={proposal.id}
      proposal={proposal}
      onAccept={() => accept.mutate(proposal.id)}
      onVeto={() => veto.mutate(proposal.id)}
      pending={accept.isPending || veto.isPending}
      error={messageFor(accept.error ?? veto.error)}
    />
  ));
  if (!open) {
    return (
      <>
        {decide}
        {theirs.length === 0 && !session.proposals.some((p) => p.status === "pending") && (
          <p className="muted">Alle Tage sind geplant.</p>
        )}
      </>
    );
  }

  const switcher = (
    <fieldset className="switch">
      <legend className="sr-only">Ansicht</legend>
      <button type="button" aria-pressed={view === "deck"} onClick={() => setView("deck")}>
        Karten
      </button>
      <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
        Liste
      </button>
    </fieldset>
  );

  if (view === "deck") {
    return (
      <>
        {decide}
        {switcher}
        {deck.isPending && <p className="muted">Lädt …</p>}
        {deck.isError && <p className="error">Die Karten konnten nicht geladen werden.</p>}
        {deck.data && (
          <SwipeDeck
            date={deck.data.date}
            cards={deck.data.cards}
            onPropose={(c) => propose.mutate({ date: deck.data.date, recipeId: c.id })}
            onPass={(c) => pass.mutate(c.id)}
            // The cards of the old day stay until the new ones are in, so nothing can be swiped meanwhile.
            pending={propose.isPending || pass.isPending || deck.isFetching}
            error={messageFor(propose.error ?? pass.error)}
          />
        )}
      </>
    );
  }
  return (
    <>
      {decide}
      {switcher}
      {eligible.isPending && <p className="muted">Lädt …</p>}
      {eligible.isError && <p className="error">Die Rezepte konnten nicht geladen werden.</p>}
      {eligible.data && (
        <RecipePicker
          date={eligible.data.date}
          recipes={eligible.data.recipes}
          onPick={(r) => propose.mutate({ date: eligible.data.date, recipeId: r.id })}
          onRefresh={() => refresh.mutate()}
          pending={propose.isPending || eligible.isFetching}
          refreshing={refresh.isPending}
          error={messageFor(propose.error ?? refresh.error)}
        />
      )}
    </>
  );
}

/** What a finished export put into KitchenOwl, for the member who finished it. */
const doneMessage = (e: ExportView): string => {
  const lines = e.list.items.length;
  return `Fertig: ${e.days.length} ${e.days.length === 1 ? "Tag" : "Tage"} im Planer und ${lines} ${lines === 1 ? "Eintrag" : "Einträge"} auf der Einkaufsliste.`;
};

/** Step 3: the consolidated list as it will be sent, once at least one day is agreed and no vote runs. */
function Finalizing({
  session,
  onDone,
  onBack,
}: {
  session: PlanSession;
  onDone: (message: string) => void;
  onBack: () => void;
}) {
  const client = useQueryClient();
  const preview = useQuery({
    queryKey: ["session", "finalize-preview", session.id],
    queryFn: () => fetchFinalizePreview(session.id),
  });
  const finalize = useMutation({
    mutationFn: (skip: string[]) => finalizePlan(session.id, skip),
    onSuccess: (done) => {
      if (done.export?.complete) onDone(doneMessage(done.export));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const dinners = session.days.flatMap((d) =>
    d.status === "planned" && d.recipe ? [{ date: d.date, recipe: d.recipe }] : [],
  );
  return (
    <FinalizePanel
      dinners={dinners}
      items={preview.data?.items}
      loading={preview.isPending}
      loadFailed={preview.isError}
      onFinalize={(skip) => finalize.mutate(skip)}
      onBack={onBack}
      pending={finalize.isPending}
      error={messageFor(finalize.error)}
    />
  );
}

/** A finalized plan whose export did not finish. */
function Exporting({ session, onDone }: { session: PlanSession; onDone: (message: string) => void }) {
  const client = useQueryClient();
  const retry = useMutation({
    mutationFn: (resend: boolean) => retryExport(session.id, resend),
    onSuccess: (done) => {
      if (done.complete) onDone(doneMessage(done));
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ["session"] });
    },
  });
  if (!session.export) return null;
  return (
    <ExportStatus
      status={session.export}
      onRetry={(resend) => retry.mutate(resend)}
      pending={retry.isPending}
      error={messageFor(retry.error)}
    />
  );
}

/**
 * The shared plan as three steps: pick the days, agree on the dishes, fill the shopping list. Whatever either member
 * does shows up for both, live.
 */
function Planning({ meId }: { meId: string }) {
  const client = useQueryClient();
  // Refetching goes on in the background: a button is free again as soon as its own request has been answered.
  const refetch = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["meal-log"] });
    void client.invalidateQueries({ queryKey: ["session"] });
  }, [client]);
  useEffect(() => listenForChanges(refetch), [refetch]);
  const [exported, setExported] = useState<string | null>(null);
  const [step, setStep] = useState<"dishes" | "list">("dishes");
  const current = useQuery({ queryKey: ["session"], queryFn: fetchCurrentSession });
  const taken = useQuery({
    queryKey: ["session", "planned-dates"],
    queryFn: fetchPlannedDates,
    enabled: current.data === null,
  });
  // An answer to a command is the new state of the plan: it shows at once, the refetch only confirms it.
  const apply = useCallback(
    (s: PlanSession) => {
      if (s.status === "open") client.setQueryData(["session"], s);
    },
    [client],
  );
  const start = useMutation({
    mutationFn: startSession,
    onSuccess: (s) => {
      setStep("dishes");
      apply(s);
    },
    onSettled: refetch,
  });
  const close = useMutation({ mutationFn: closeSession, onSettled: refetch });
  const withdraw = useMutation({
    mutationFn: ({ sessionId, proposalId }: { sessionId: string; proposalId: string }) =>
      withdrawProposal(sessionId, proposalId),
    onSuccess: apply,
    onSettled: refetch,
  });
  const shape = useMutation({
    mutationFn: (
      change: { sessionId: string } & ({ kind: "leftovers"; date: string } | { kind: "reopen"; date: string } | Drop),
    ) =>
      change.kind === "leftovers"
        ? markLeftovers(change.sessionId, change.date)
        : change.kind === "reopen"
          ? reopenDay(change.sessionId, change.date)
          : change.kind === "swap"
            ? swapDays(change.sessionId, change.a, change.b)
            : moveDay(change.sessionId, change.from, change.to),
    onSuccess: apply,
    onSettled: refetch,
  });

  if (current.isPending) return <p className="muted">Lädt …</p>;
  if (current.isError) return <p className="error">Die Planung konnte nicht geladen werden.</p>;
  const session = current.data;
  if (session) {
    const open = session.status === "open";
    // The shopping list needs an agreed day and no vote running; if that stops being true the list step ends.
    const onList = open && step === "list" && canFinalize(session);
    return (
      <>
        <Stepper current={open && !onList ? 2 : 3} />
        {session.status === "open" && session.reminderSent && session.days.some((d) => d.status === "planned") && (
          <p role="status" className="banner">
            Noch offen: die Einkaufsliste füllen. Dann ist die Planung abgeschlossen.
          </p>
        )}
        {onList ? (
          <Finalizing session={session} onDone={setExported} onBack={() => setStep("dishes")} />
        ) : (
          <>
            <PlanBoard
              session={session}
              meId={meId}
              onClose={() => close.mutate(session.id)}
              onLeftovers={(date) => shape.mutate({ sessionId: session.id, kind: "leftovers", date })}
              onReopen={(date) => shape.mutate({ sessionId: session.id, kind: "reopen", date })}
              onDrop={(drop) => shape.mutate({ sessionId: session.id, ...drop })}
              onWithdraw={(proposalId) => withdraw.mutate({ sessionId: session.id, proposalId })}
              {...(open ? { onNext: () => setStep("list"), nextBlocked: blockedReason(session) } : {})}
              pending={close.isPending || shape.isPending || withdraw.isPending}
              error={close.isError ? SESSION_MESSAGES.unavailable : messageFor(shape.error ?? withdraw.error)}
            >
              {open && <Proposing session={session} meId={meId} refetch={refetch} apply={apply} />}
            </PlanBoard>
            {session.status === "finalized" && <Exporting session={session} onDone={setExported} />}
          </>
        )}
      </>
    );
  }
  const error = messageFor(start.error ?? null);
  return (
    <>
      <Stepper current={1} />
      {exported && (
        <p role="status" className="success">
          {exported}
        </p>
      )}
      <StartSessionForm
        onStart={(dates) => start.mutate(dates)}
        pending={start.isPending}
        error={error}
        takenDates={taken.data ?? []}
      />
    </>
  );
}

export function App() {
  const client = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  const signIn = useMutation({
    mutationFn: (v: { username: string; password: string }) => login(v.username, v.password),
    onSuccess: (member) => client.setQueryData(["me"], member),
  });
  const signOut = useMutation({ mutationFn: logout, onSuccess: () => client.setQueryData(["me"], null) });
  const [tab, setTab] = useState<"plan" | "log">("plan");

  if (me.isPending) return <main className="center muted">Lädt …</main>;
  if (me.isError)
    return (
      <main className="center error" role="alert">
        Der Server ist gerade nicht erreichbar.
      </main>
    );

  if (me.data === null) {
    const error: LoginError | null =
      signIn.error instanceof LoginFailed ? signIn.error.reason : signIn.isError ? "unavailable" : null;
    return (
      <main className="center">
        <LoginForm
          onSubmit={(username, password) => signIn.mutate({ username, password })}
          pending={signIn.isPending}
          error={error}
        />
      </main>
    );
  }

  return (
    <main className="page">
      <header className="bar">
        <h1>Hallo, {me.data.name}</h1>
        <div className="bar-actions">
          <Notifications />
          <button type="button" className="secondary" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            Abmelden
          </button>
        </div>
      </header>
      {signOut.isError && (
        <p role="alert" className="error">
          Abmelden hat nicht geklappt. Bitte noch einmal versuchen.
        </p>
      )}
      <fieldset className="switch tabs">
        <legend className="sr-only">Bereich</legend>
        <button type="button" aria-pressed={tab === "plan"} onClick={() => setTab("plan")}>
          Planung
        </button>
        <button type="button" aria-pressed={tab === "log"} onClick={() => setTab("log")}>
          Verlauf
        </button>
      </fieldset>
      {tab === "log" ? (
        <MealHistory messageFor={messageFor} />
      ) : (
        <>
          <DueMeals messageFor={messageFor} />
          <Planning meId={me.data.id} />
        </>
      )}
    </main>
  );
}
