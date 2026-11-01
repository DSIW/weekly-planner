import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
  acceptProposal,
  closeSession,
  fetchCurrentSession,
  fetchDeck,
  fetchEligibleRecipes,
  fetchMe,
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
  SessionFailed,
  startSession,
  swapDays,
  vetoProposal,
  type LoginError,
  type PlanSession,
  type SessionError,
} from "./api";
import { LoginForm } from "./LoginForm";
import { PlanBoard } from "./PlanBoard";
import type { Drop } from "./plan-moves";
import { ProposalCard } from "./ProposalCard";
import { RecipePicker } from "./RecipePicker";
import { StartSessionForm } from "./StartSessionForm";
import { SwipeDeck } from "./SwipeDeck";

const SESSION_MESSAGES: Record<SessionError, string> = {
  session_already_open: "Es läuft schon eine Planung. Sie ist jetzt zu sehen.",
  session_not_open: "Die Planung wurde beendet.",
  proposal_already_pending: "Es läuft gerade eine Abstimmung. Entscheidet erst darüber.",
  proposal_not_pending: "Darüber ist schon entschieden.",
  not_next_open_day: "Es ist schon ein anderer Tag dran.",
  too_long_for_weekday: "Das Rezept ist für einen Wochentag zu lang.",
  day_not_planned: "Der Tag hat sich gerade geändert.",
  day_already_open: "Der Tag hat sich gerade geändert.",
  target_not_open: "Der Tag hat sich gerade geändert.",
  date_already_taken: "An diesem Tag ist schon ein Essen geplant.",
  unavailable: "Das hat nicht geklappt. Bitte später noch einmal versuchen.",
};

/** What a member is told when an action failed; the server's reason when they can act on it. */
const messageFor = (error: unknown): string | null =>
  error === null ? null : SESSION_MESSAGES[error instanceof SessionFailed ? error.reason : "unavailable"];

/** The next open day: swipe through the ranked cards or search the list, or decide on the other member's proposal. */
function Proposing({ session, meId, refetch }: { session: PlanSession; meId: string; refetch: () => void }) {
  const [view, setView] = useState<"deck" | "list">("deck");
  const next = session.days.find((d) => d.status === "open");
  const proposal = session.proposals.find((p) => p.status === "pending");
  const open = next !== undefined && proposal === undefined;
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
  const refresh = useMutation({ mutationFn: refreshRecipes, onSettled: refetch });

  if (!next) return <p className="muted">Alle Tage sind geplant.</p>;
  if (proposal) {
    return (
      <ProposalCard
        proposal={proposal}
        mine={proposal.proposedBy === meId}
        onAccept={() => accept.mutate(proposal.id)}
        onVeto={() => veto.mutate(proposal.id)}
        pending={accept.isPending || veto.isPending}
        error={messageFor(accept.error ?? veto.error)}
      />
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
      </>
    );
  }
  return (
    <>
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
    </>
  );
}

/** The shared plan: whatever either member does shows up for both, live. */
function Planning({ meId }: { meId: string }) {
  const client = useQueryClient();
  const refetch = useCallback(() => client.invalidateQueries({ queryKey: ["session"] }), [client]);
  useEffect(() => listenForChanges(refetch), [refetch]);
  const current = useQuery({ queryKey: ["session"], queryFn: fetchCurrentSession });
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
        {session.status === "open" && <Proposing session={session} meId={meId} refetch={refetch} />}
      </>
    );
  }
  const error = messageFor(start.error ?? null);
  return <StartSessionForm onStart={(dates) => start.mutate(dates)} pending={start.isPending} error={error} />;
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
        <button type="button" className="secondary" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Abmelden
        </button>
      </header>
      {signOut.isError && (
        <p role="alert" className="error">
          Abmelden hat nicht geklappt. Bitte noch einmal versuchen.
        </p>
      )}
      <Planning meId={me.data.id} />
    </main>
  );
}
