import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMe, login, LoginFailed, logout, type LoginError } from "./api";
import { LoginForm } from "./LoginForm";

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
    <main className="center">
      <section className="card">
        <h1>Hallo, {me.data.name}</h1>
        <p className="muted">Die gemeinsame Planung kommt als Nächstes.</p>
        <button type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Abmelden
        </button>
      </section>
    </main>
  );
}
