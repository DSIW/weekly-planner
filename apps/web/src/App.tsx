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
import { MealLogPanel } from "./MealLogPanel";
import { Notifications } from "./Notifications";
import { PlanBoard } from "./PlanBoard";
import type { Drop } from "./plan-moves";
import { ProposalCard } from "./ProposalCard";
import { WaitingProposals } from "./WaitingProposals";
import { RecipePicker } from "./RecipePicker";
import { StartSessionForm } from "./StartSessionForm";
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

/** What a member is told when an action failed; the server's reason when they can act on it. */
const messageFor = (error: unknown): string | null =>
  error === null ? null : SESSION_MESSAGES[error instanceof SessionFailed ? error.reason : "unavailable"];

/**
 * Proposing and deciding. Proposals of the other member wait for an answer from you; your own wait in a short list
 * below the deck. The deck goes on with the next day that has no proposal yet, so nobody waits for an answer.
 */
function Proposing({ session, meId, refetch }: { session: PlanSession; meId: string; refetch: () => void }) {
  const [view, setView] = useState<"deck" | "list">("deck");
  const waiting = session.proposals.filter((p) => p.status === "pending");
  const theirs = waiting.filter((p) => p.proposedBy !== meId);
  const mine = waiting.filter((p) => p.proposedBy === meId);
  const free = session.days.find((d) => d.status === "open" && !waiting.some((p) => p.date === d.date));
  const open = free !== undefined;
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
  const propose = useMutation({
    mutationFn: (v: { date: string; recipeId: number }) => proposeRecipe(session.id, v.date, v.recipeId),
    onSettled: refetch,
  });
  const pass = useMutation({ mutationFn: (recipeId: number) => passRecipe(session.id, recipeId), onSettled: refetch });
  const accept = useMutation({ mutationFn: (id: string) => acceptProposal(session.id, id), onSettled: refetch });
  const veto = useMutation({ mutationFn: (id: string) => vetoProposal(session.id, id), onSettled: refetch });
  const withdraw = useMutation({ mutationFn: (id: string) => withdrawProposal(session.id, id), onSettled: refetch });
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
  const waitingList = mine.length > 0 && (
    <WaitingProposals
      proposals={mine}
      onWithdraw={(p) => withdraw.mutate(p.id)}
      pending={withdraw.isPending}
      error={messageFor(withdraw.error)}
    />
  );
  if (!open) {
    return (
      <>
        {decide}
        {waiting.length === 0 && <p className="muted">Alle Tage sind geplant.</p>}
        {waitingList}
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
            pending={propose.isPending || pass.isPending}
            error={messageFor(propose.error ?? pass.error)}
          />
        )}
        {waitingList}
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
          pending={propose.isPending}
          refreshing={refresh.isPending}
          error={messageFor(propose.error ?? refresh.error)}
        />
      )}
      {waitingList}
    </>
  );
}

/** What a finished export put into KitchenOwl, for the member who finished it. */
const doneMessage = (e: ExportView): string => {
  const lines = e.list.items.length;
  return `Fertig: ${e.days.length} ${e.days.length === 1 ? "Tag" : "Tage"} im Planer und ${lines} ${lines === 1 ? "Eintrag" : "Einträge"} auf der Einkaufsliste.`;
};

/** Finalize: the consolidated list as it will be sent, once at least one day is agreed and no vote runs. */
function Finalizing({ session, onDone }: { session: PlanSession; onDone: (message: string) => void }) {
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
    onSettled: () => client.invalidateQueries({ queryKey: ["session"] }),
  });
  return (
    <FinalizePanel
      dinners={preview.data?.dinners}
      items={preview.data?.items}
      loading={preview.isPending}
      loadFailed={preview.isError}
      onFinalize={(skip) => finalize.mutate(skip)}
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
    onSettled: () => client.invalidateQueries({ queryKey: ["session"] }),
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

/** The shared plan: whatever either member does shows up for both, live. */
function Planning({ meId }: { meId: string }) {
  const client = useQueryClient();
  const refetch = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["meal-log"] });
    return client.invalidateQueries({ queryKey: ["session"] });
  }, [client]);
  useEffect(() => listenForChanges(refetch), [refetch]);
  const [exported, setExported] = useState<string | null>(null);
  const current = useQuery({ queryKey: ["session"], queryFn: fetchCurrentSession });
  const taken = useQuery({
    queryKey: ["session", "planned-dates"],
    queryFn: fetchPlannedDates,
    enabled: current.data === null,
  });
  const start = useMutation({ mutationFn: startSession, onSettled: refetch });
  const close = useMutation({ mutationFn: closeSession, onSettled: refetch });
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
    onSettled: refetch,
  });

  if (current.isPending) return <p className="muted">Lädt …</p>;
  if (current.isError) return <p className="error">Die Planung konnte nicht geladen werden.</p>;
  const session = current.data;
  if (session) {
    return (
      <>
        <PlanBoard
          session={session}
          onClose={() => close.mutate(session.id)}
          onLeftovers={(date) => shape.mutate({ sessionId: session.id, kind: "leftovers", date })}
          onReopen={(date) => shape.mutate({ sessionId: session.id, kind: "reopen", date })}
          onDrop={(drop) => shape.mutate({ sessionId: session.id, ...drop })}
          pending={close.isPending || shape.isPending}
          error={close.isError ? SESSION_MESSAGES.unavailable : messageFor(shape.error)}
        />
        {session.status === "open" && session.reminderSent && session.days.some((d) => d.status === "planned") && (
          <p role="status" className="banner">
            Erinnerung: Ihr habt Tage geplant, aber die Einkaufsliste ist noch nicht gefüllt. Schließt die Planung ab.
          </p>
        )}
        {session.status === "open" && canFinalize(session) && <Finalizing session={session} onDone={setExported} />}
        {session.status === "open" && <Proposing session={session} meId={meId} refetch={refetch} />}
        {session.status === "finalized" && <Exporting session={session} onDone={setExported} />}
      </>
    );
  }
  const error = messageFor(start.error ?? null);
  return (
    <>
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
      <MealLogPanel messageFor={messageFor} />
      <Planning meId={me.data.id} />
    </main>
  );
}
