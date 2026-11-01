import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { App } from "../src/App";

type Reply = { status: number; body?: unknown };

/** A fake server: replies per "METHOD path", and records what the app sent. */
export function server(routes: Record<string, Reply | (() => Reply)>) {
  const calls: { key: string; body?: unknown; headers?: HeadersInit | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers });
      const r = routes[key];
      if (!r) return new Response("{}", { status: 404 });
      const reply = typeof r === "function" ? r() : r;
      return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), { status: reply.status });
    }),
  );
  return calls;
}

export const renderApp = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App />
    </QueryClientProvider>,
  );

export const api = `${import.meta.env.BASE_URL}api`;

/** The rows of the plan, one per day. */
export const dayRows = () => within(screen.getByRole("list", { name: "Tage der Planung" })).getAllByRole("listitem");
export const findDayRows = async () => {
  await screen.findByRole("list", { name: "Tage der Planung" });
  return dayRows();
};
