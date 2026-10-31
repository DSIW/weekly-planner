import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import {
  closeSession,
  fetchCurrentSession,
  fetchMe,
  listenForChanges,
  login,
  LoginFailed,
  logout,
  SessionFailed,
  startSession,
  type LoginError,
} from "./api";
import { LoginForm } from "./LoginForm";
import { PlanBoard } from "./PlanBoard";
import { StartSessionForm } from "./StartSessionForm";

const SESSION_MESSAGES = {
  session_already_open: "Es läuft schon eine Planung. Sie ist jetzt zu sehen.",
  unavailable: "Das hat nicht geklappt. Bitte später noch einmal versuchen.",
} as const;

/** The shared plan: whatever either member does shows up for both, live. */
function Planning() {
  const client = useQueryClient();
  const refetch = useCallback(() => client.invalidateQueries({ queryKey: ["session"] }), [client]);
  useEffect(() => listenForChanges(refetch), [refetch]);
  const current = useQuery({ queryKey: ["session"], queryFn: fetchCurrentSession });
  const start = useMutation({ mutationFn: startSession, onSettled: refetch });
  const close = useMutation({ mutationFn: closeSession, onSettled: refetch });

  if (current.isPending) return <p className="muted">Lädt …</p>;
  if (current.isError) return <p className="error">Die Planung konnte nicht geladen werden.</p>;
  const session = current.data;
  if (session) {
    return (
      <PlanBoard
        session={session}
        onClose={() => close.mutate(session.id)}
        pending={close.isPending}
        error={close.isError ? SESSION_MESSAGES.unavailable : null}
      />
    );
  }
  const error = start.error instanceof SessionFailed ? SESSION_MESSAGES[start.error.reason] : null;
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
      <Planning />
    </main>
  );
}
