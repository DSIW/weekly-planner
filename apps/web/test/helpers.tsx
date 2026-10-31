import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { App } from "../src/App";

type Reply = { status: number; body?: unknown };

/** A fake server: replies per "METHOD path", and records what the app sent. */
export function server(routes: Record<string, Reply | (() => Reply)>) {
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

export const renderApp = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App />
    </QueryClientProvider>,
  );

export const api = `${import.meta.env.BASE_URL}api`;
