import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const PREVIEW = `GET ${api}/sessions/s1/finalize-preview`;
const FINALIZE = `POST ${api}/sessions/s1/finalize`;
const RETRY = `POST ${api}/sessions/s1/export/retry`;
const CLOSE = `POST ${api}/sessions/s1/close`;
const signedIn = { [ME]: { status: 200, body: { member: { id: "2", name: "Max" } } } };

const pasta = {
  id: 1,
  name: "Pasta",
  minutes: 30,
  base: "pasta",
  diet: "vegetarian",
  needsTime: false,
  planAhead: false,
};
const proposal = (status: string) => ({
  id: "p1",
  date: "2026-11-03",
  recipe: pasta,
  proposedBy: "3",
  status,
});
const session = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  status: "open",
  startedBy: "2",
  days: [
    { date: "2026-11-02", status: "planned", recipe: pasta },
    { date: "2026-11-03", status: "open" },
  ],
  proposals: [],
  ...over,
});
const preview = {
  dinners: [{ date: "2026-11-02", recipeName: "Pasta" }],
  items: [
    { name: "Zwiebel", description: "3 Stück", needsReview: false, recipes: ["Pasta"] },
    { name: "Salz", description: "etwas", needsReview: true, recipes: ["Pasta"] },
  ],
};
const exportOf = (over: Record<string, unknown> = {}) => ({
  complete: false,
  failure: null,
  days: [{ date: "2026-11-02", recipeName: "Pasta", status: "pending" }],
  list: { status: "pending", items: preview.items },
  ...over,
});
const finalized = (exp: unknown) => session({ status: "finalized", export: exp });

class FakeEventSource {
  addEventListener() {}
  close() {}
}
beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 1, 12));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the finalize panel", () => {
  it("shows the consolidated list with the lines to check highlighted", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: { status: 200, body: preview },
    });
    renderApp();
    const list = await screen.findByRole("list", { name: "Einkaufsliste" });
    const [onion, salt] = within(list).getAllByRole("listitem");
    expect(onion).toHaveTextContent("Zwiebel3 Stück");
    expect(onion).not.toHaveClass("review");
    expect(salt).toHaveTextContent("Salzetwas");
    expect(salt).toHaveClass("review");
    expect(salt).toHaveTextContent("bitte prüfen");
    expect(screen.getByText(/Eine Menge konnte nicht gelesen werden/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Einkaufsliste füllen" })).toBeEnabled();
  });

  it("is not offered while nothing is planned", async () => {
    const empty = session({
      days: [
        { date: "2026-11-02", status: "open" },
        { date: "2026-11-03", status: "open" },
      ],
    });
    server({ ...signedIn, [CURRENT]: { status: 200, body: { session: empty } } });
    renderApp();
    await screen.findByRole("heading", { name: "Planung" });
    expect(screen.queryByRole("button", { name: "Einkaufsliste füllen" })).not.toBeInTheDocument();
  });

  it("is not offered while a vote is pending", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session({ proposals: [proposal("pending")] }) } },
      [PREVIEW]: { status: 200, body: preview },
    });
    renderApp();
    await screen.findByRole("heading", { name: /Vorschlag für/ });
    expect(screen.queryByRole("button", { name: "Einkaufsliste füllen" })).not.toBeInTheDocument();
  });

  it("writes the list and tells the member it is done once the session leaves the board", async () => {
    let current: unknown = session();
    const calls = server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [PREVIEW]: { status: 200, body: preview },
      [FINALIZE]: () => {
        current = null;
        return {
          status: 200,
          body: {
            session: finalized(
              exportOf({
                complete: true,
                days: [{ date: "2026-11-02", recipeName: "Pasta", status: "done" }],
                list: { status: "done", items: preview.items },
              }),
            ),
          },
        };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Einkaufsliste füllen" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Fertig: 1 Tag im Planer und 2 Einträge auf der Einkaufsliste.",
    );
    expect(await screen.findByRole("button", { name: "Planung starten" })).toBeInTheDocument();
    expect(calls.filter((c) => c.key === FINALIZE)).toHaveLength(1);
  });

  it("keeps a failed export on screen after finalizing, with the retry", async () => {
    let current: unknown = session();
    server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [PREVIEW]: { status: 200, body: preview },
      [FINALIZE]: () => {
        current = finalized(exportOf({ failure: "refused" }));
        return { status: 200, body: { session: current } };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Einkaufsliste füllen" }));
    expect(await screen.findByRole("heading", { name: "Eintragen in KitchenOwl" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });
});

describe("the export status", () => {
  it("shows each step and retries a refused export", async () => {
    let current: unknown = finalized(exportOf({ failure: "refused" }));
    const calls = server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [RETRY]: () => {
        current = null;
        return { status: 200, body: { export: exportOf({ complete: true }) } };
      },
    });
    renderApp();
    const steps = await screen.findByRole("list", { name: "Fortschritt" });
    expect(steps).toHaveTextContent(/Planer Mo.*Pasta: wartet/);
    expect(steps).toHaveTextContent("Einkaufsliste: wartet");
    expect(screen.getByRole("alert")).toHaveTextContent("nicht angenommen");
    expect(screen.queryByRole("button", { name: "Trotzdem erneut senden" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Fertig");
    expect(calls.find((c) => c.key === RETRY)?.body).toBeUndefined();
  });

  it("asks the members to look in KitchenOwl before sending a step that may have arrived", async () => {
    const unsure = exportOf({
      failure: "unconfirmed",
      list: { status: "sending", items: preview.items },
      days: [{ date: "2026-11-02", recipeName: "Pasta", status: "done" }],
    });
    const calls = server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: finalized(unsure) } },
      [RETRY]: { status: 200, body: { export: exportOf({ complete: true }) } },
    });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("unklar, ob der Schritt angekommen ist");
    expect(screen.getByText(/Einkaufsliste: unklar, ob angekommen/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Trotzdem erneut senden" }));
    await screen.findByRole("status").catch(() => undefined);
    expect(calls.find((c) => c.key === RETRY)?.body).toEqual({ resendUnconfirmed: true });
  });

  it("shows the finalized plan locked: no handles, no leftovers, and it can be closed", async () => {
    let current: unknown = finalized(exportOf({ failure: "refused" }));
    const calls = server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [CLOSE]: () => {
        current = null;
        return { status: 200, body: { session: finalized(exportOf()) } };
      },
    });
    renderApp();
    await screen.findByRole("heading", { name: "Abgeschlossene Planung" });
    expect(screen.queryByRole("button", { name: /verschieben/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reste" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wieder öffnen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Einkaufsliste füllen" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Planung schließen" }));
    expect(await screen.findByRole("button", { name: "Planung starten" })).toBeInTheDocument();
    expect(calls.some((c) => c.key === CLOSE)).toBe(true);
  });
});

// Every action must say so when it fails.
describe("failed finalize actions are visible", () => {
  it("loading the list preview", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: { status: 500, body: {} },
    });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("Einkaufsliste konnte nicht geladen werden");
  });

  it("finalizing that the server fails on", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: { status: 200, body: preview },
      [FINALIZE]: { status: 502, body: { error: "unavailable" } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Einkaufsliste füllen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("finalizing a plan that changed meanwhile, with the server's reason", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: { status: 200, body: preview },
      [FINALIZE]: { status: 409, body: { error: "nothing_planned" } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Einkaufsliste füllen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("noch kein Tag geplant");
  });

  it("retrying that the server fails on", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: finalized(exportOf()) } },
      [RETRY]: { status: 500, body: {} },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByText(/Das hat nicht geklappt/)).toBeInTheDocument();
  });

  it("retrying while another export is running", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: finalized(exportOf()) } },
      [RETRY]: { status: 409, body: { error: "export_running" } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Erneut versuchen" }));
    expect(await screen.findByText(/läuft gerade/)).toBeInTheDocument();
  });

  it("closing a finalized session that the server fails on", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: finalized(exportOf({ failure: "refused" })) } },
      [CLOSE]: { status: 500, body: {} },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Planung schließen" }));
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(screen.getAllByRole("alert").some((a) => /nicht geklappt/.test(a.textContent ?? ""))).toBe(true);
  });
});
