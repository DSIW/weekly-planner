import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

type Reply = { status: number; body?: unknown };

/** A fake server: replies per "METHOD path", and records what the app sent. */
function server(routes: Record<string, Reply | (() => Reply)>) {
  const calls: { key: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = routes[key];
      if (!r) return new Response("{}", { status: 404 });
      const reply = typeof r === "function" ? r() : r;
      return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), { status: reply.status });
    }),
  );
  return calls;
}

const renderApp = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App />
    </QueryClientProvider>,
  );

const api = `${import.meta.env.BASE_URL}api`;
const ME = `GET ${api}/me`;
const LOGIN = `POST ${api}/login`;
const LOGOUT = `POST ${api}/logout`;
const max = { id: "2", name: "Max" };

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("greets a member who is already signed in", async () => {
    server({ [ME]: { status: 200, body: { member: max } } });
    renderApp();
    expect(await screen.findByRole("heading", { name: "Hallo, Max" })).toBeInTheDocument();
  });

  it("shows the sign-in form when nobody is signed in and greets after a successful sign-in", async () => {
    const calls = server({ [ME]: { status: 401 }, [LOGIN]: { status: 200, body: { member: max } } });
    renderApp();
    await userEvent.type(await screen.findByLabelText("Benutzername"), "dsiw");
    await userEvent.type(screen.getByLabelText("Passwort"), "geheim");
    await userEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("heading", { name: "Hallo, Max" })).toBeInTheDocument();
    expect(calls.find((c) => c.key === LOGIN)?.body).toEqual({ username: "dsiw", password: "geheim" });
  });

  it.each([
    [401, "invalid_credentials", "Benutzername oder Passwort stimmt nicht."],
    [403, "not_in_household", "Dieses Konto gehört nicht zum Haushalt."],
  ])("explains a refused sign-in (%s)", async (status, error, message) => {
    server({ [ME]: { status: 401 }, [LOGIN]: { status, body: { error } } });
    renderApp();
    await userEvent.type(await screen.findByLabelText("Benutzername"), "x");
    await userEvent.type(screen.getByLabelText("Passwort"), "y");
    await userEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("heading", { name: /Hallo/ })).not.toBeInTheDocument();
  });

  it("signs out and shows the form again", async () => {
    server({ [ME]: { status: 200, body: { member: max } }, [LOGOUT]: { status: 204 } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Abmelden" }));
    expect(await screen.findByLabelText("Benutzername")).toBeInTheDocument();
  });

  it("says so when the server cannot be reached", async () => {
    server({ [ME]: { status: 500 } });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht erreichbar");
  });
});
