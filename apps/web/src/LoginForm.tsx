import { useState, type FormEvent } from "react";
import type { LoginError } from "./api";

const MESSAGES: Record<LoginError, string> = {
  invalid_credentials: "Benutzername oder Passwort stimmt nicht.",
  missing_credentials: "Bitte Benutzername und Passwort eingeben.",
  not_in_household: "Dieses Konto gehört nicht zum Haushalt.",
  unavailable: "Der Server ist gerade nicht erreichbar. Bitte später noch einmal versuchen.",
};

interface Props {
  onSubmit: (username: string, password: string) => void;
  pending: boolean;
  error: LoginError | null;
}

export function LoginForm({ onSubmit, pending, error }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(username, password);
  };
  return (
    <form className="card" onSubmit={submit}>
      <h1>Weekly Planner</h1>
      <p className="muted">Melde dich mit deinem KitchenOwl-Konto an.</p>
      <label>
        Benutzername
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          required
        />
      </label>
      <label>
        Passwort
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {MESSAGES[error]}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Anmelden …" : "Anmelden"}
      </button>
    </form>
  );
}
