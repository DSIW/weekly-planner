import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const LIST = `GET ${api}/ideas`;
const ADD = `POST ${api}/ideas`;
const EDIT = `PUT ${api}/ideas/i1`;
const KEEP = `POST ${api}/ideas/i2/keep`;
const DELETE1 = `DELETE ${api}/ideas/i1`;
const DELETE2 = `DELETE ${api}/ideas/i2`;
const base = {
  [ME]: { status: 200, body: { member: { id: "2", name: "Max" } } },
  [CURRENT]: { status: 200, body: { session: null } },
};

const NOW = new Date(2026, 10, 1, 12).getTime(); // Sunday 1 November 2026
const DAY = 86_400_000;
const idea = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: "Kürbisgnocchi",
  note: null,
  inspirationLink: null,
  addedBy: { id: "2", name: "Max", avatar: "max.png" },
  addedAt: NOW - 3 * DAY,
  isStale: false,
  candidates: [],
  ...over,
});
const fresh = idea("i1", { note: "mit Salbei", inspirationLink: "https://example.org/kuerbis" });
const stale = idea("i2", {
  title: "Linsencurry",
  addedBy: { id: "3", name: "AC", avatar: null },
  addedAt: NOW - 70 * DAY,
  isStale: true,
});
const list = (...ideas: unknown[]) => ({ status: 200, body: { ideas } });

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private readonly listeners = new Map<string, (() => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {}
  emit(type: string) {
    for (const l of this.listeners.get(type) ?? []) l();
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const openIdeas = async () => {
  renderApp();
  await userEvent.click(await screen.findByRole("button", { name: "Ideen" }));
};

describe("the ideas tab", () => {
  it("shows each idea with who added it, their KitchenOwl picture, and when", async () => {
    server({ ...base, [LIST]: list(fresh) });
    await openIdeas();
    const card = (await screen.findByRole("heading", { name: "Kürbisgnocchi" })).closest("li")!;
    expect(card).toHaveTextContent("Max");
    expect(card).toHaveTextContent("vor 3 Tagen");
    expect(card).toHaveTextContent("mit Salbei");
    expect(card.querySelector("img")).toHaveAttribute("src", `${api}/members/2/avatar?v=max.png`);
    const link = within(card).getByRole("link", { name: "Inspiration ansehen" });
    expect(link).toHaveAttribute("href", "https://example.org/kuerbis");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("falls back to the initial of the name when the member has no picture or it does not load", async () => {
    server({ ...base, [LIST]: list(stale, fresh) });
    await openIdeas();
    const ac = (await screen.findByRole("heading", { name: "Linsencurry" })).closest("li")!;
    expect(ac.querySelector("img")).toBeNull();
    expect(within(ac).getByText("A")).toBeInTheDocument();
    const max = screen.getByRole("heading", { name: "Kürbisgnocchi" }).closest("li")!;
    const img = max.querySelector("img")!;
    img.dispatchEvent(new Event("error"));
    await waitFor(() => expect(max.querySelector("img")).toBeNull());
    expect(within(max).getByText("M")).toBeInTheDocument();
  });

  it("never turns a link that is not a web link into a link", async () => {
    server({ ...base, [LIST]: list(idea("i1", { inspirationLink: "javascript:alert(1)" })) });
    await openIdeas();
    await screen.findByRole("heading", { name: "Kürbisgnocchi" });
    expect(screen.queryByRole("link", { name: "Inspiration ansehen" })).toBeNull();
  });

  it("says so when there are no ideas", async () => {
    server({ ...base, [LIST]: list() });
    await openIdeas();
    expect(await screen.findByText(/Noch keine Ideen/)).toBeInTheDocument();
  });

  it("marks stale ideas as veraltet with Behalten and Löschen, apart from the others", async () => {
    server({ ...base, [LIST]: list(fresh, stale) });
    await openIdeas();
    const staleList = await screen.findByRole("list", { name: "Veraltete Ideen" });
    const card = within(staleList).getByRole("heading", { name: "Linsencurry" }).closest("li")!;
    expect(card).toHaveTextContent("veraltet");
    expect(card).toHaveTextContent("vor 2 Monaten");
    expect(within(card).getByRole("button", { name: "Linsencurry behalten" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Linsencurry löschen" })).toBeInTheDocument();
    const freshCard = screen.getByRole("heading", { name: "Kürbisgnocchi" }).closest("li")!;
    expect(freshCard).not.toHaveTextContent("veraltet");
    expect(within(freshCard).queryByRole("button", { name: /behalten/ })).toBeNull();
  });

  it("keeps a stale idea and refetches the list", async () => {
    let kept = false;
    const calls = server({
      ...base,
      [LIST]: () => list(kept ? { ...stale, isStale: false, addedAt: stale.addedAt } : stale),
      [KEEP]: () => {
        kept = true;
        return { status: 200, body: { idea: { ...stale, isStale: false } } };
      },
    });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Linsencurry behalten" }));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Veraltete Ideen" })).toBeNull());
    expect(calls.some((c) => c.key === KEEP)).toBe(true);
    expect(screen.getByRole("heading", { name: "Linsencurry" })).toBeInTheDocument();
  });

  it("asks before deleting, and deleting removes the idea", async () => {
    let gone = false;
    const calls = server({
      ...base,
      [LIST]: () => list(...(gone ? [] : [fresh])),
      [DELETE1]: () => {
        gone = true;
        return { status: 204 };
      },
    });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Kürbisgnocchi löschen" }));
    expect(calls.some((c) => c.key === DELETE1)).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Kürbisgnocchi wirklich löschen" }));
    expect(await screen.findByText(/Noch keine Ideen/)).toBeInTheDocument();
    expect(calls.some((c) => c.key === DELETE1)).toBe(true);
  });

  it("can back out of deleting", async () => {
    const calls = server({ ...base, [LIST]: list(fresh) });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Kürbisgnocchi löschen" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.getByRole("button", { name: "Kürbisgnocchi löschen" })).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith("DELETE"))).toBe(false);
  });

  it("adds an idea with a title only, then shows it", async () => {
    let added = false;
    const calls = server({
      ...base,
      [LIST]: () => list(...(added ? [idea("i9", { title: "Etwas mit Kürbis", addedAt: NOW })] : [])),
      [ADD]: () => {
        added = true;
        return { status: 201, body: { idea: idea("i9") } };
      },
    });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Idee hinzufügen" }));
    await userEvent.type(screen.getByLabelText("Titel"), "Etwas mit Kürbis");
    await userEvent.click(screen.getByRole("button", { name: "Idee hinzufügen" }));
    expect(await screen.findByRole("heading", { name: "Etwas mit Kürbis" })).toBeInTheDocument();
    expect(calls.find((c) => c.key === ADD)?.body).toEqual({ title: "Etwas mit Kürbis" });
    expect(screen.getByText("heute")).toBeInTheDocument();
    expect(screen.queryByLabelText("Titel")).toBeNull(); // the form closed
  });

  it("sends note and link when given", async () => {
    const calls = server({ ...base, [LIST]: list(), [ADD]: { status: 201, body: { idea: idea("i9") } } });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Idee hinzufügen" }));
    await userEvent.type(screen.getByLabelText("Titel"), "Gnocchi");
    await userEvent.type(screen.getByLabelText(/Notiz/), "mit Salbei");
    await userEvent.type(screen.getByLabelText(/Link/), "https://example.org/g");
    await userEvent.click(screen.getByRole("button", { name: "Idee hinzufügen" }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === ADD)?.body).toEqual({
        title: "Gnocchi",
        note: "mit Salbei",
        inspirationLink: "https://example.org/g",
      }),
    );
  });

  it("edits an idea in place, starting from what it says now", async () => {
    const calls = server({
      ...base,
      [LIST]: list(fresh),
      [EDIT]: { status: 200, body: { idea: { ...fresh, title: "Gnocchi" } } },
    });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Kürbisgnocchi bearbeiten" }));
    const title = screen.getByLabelText("Titel");
    expect(title).toHaveValue("Kürbisgnocchi");
    expect(screen.getByLabelText(/Notiz/)).toHaveValue("mit Salbei");
    await userEvent.clear(title);
    await userEvent.type(title, "Gnocchi");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === EDIT)?.body).toEqual({
        title: "Gnocchi",
        note: "mit Salbei",
        inspirationLink: "https://example.org/kuerbis",
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Titel")).toBeNull());
  });

  it("shows the other phone's change live", async () => {
    let ideas: unknown[] = [];
    server({ ...base, [LIST]: () => list(...ideas) });
    await openIdeas();
    await screen.findByText(/Noch keine Ideen/);
    ideas = [fresh];
    FakeEventSource.instances.at(-1)!.emit("changed");
    expect(await screen.findByRole("heading", { name: "Kürbisgnocchi" })).toBeInTheDocument();
  });
});

// Every action must say so when it fails; a silent failure looks like a broken button.
describe("failed idea actions are visible", () => {
  it("loading the ideas", async () => {
    server({ ...base, [LIST]: { status: 500, body: {} } });
    await openIdeas();
    expect(await screen.findByRole("alert")).toHaveTextContent("konnten nicht geladen werden");
  });

  it("adding an idea that the server fails on, and the form keeps what was typed", async () => {
    server({ ...base, [LIST]: list(), [ADD]: { status: 500, body: {} } });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Idee hinzufügen" }));
    await userEvent.type(screen.getByLabelText("Titel"), "Gnocchi");
    await userEvent.click(screen.getByRole("button", { name: "Idee hinzufügen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
    expect(screen.getByLabelText("Titel")).toHaveValue("Gnocchi");
  });

  it("adding an idea with a link the server refuses", async () => {
    server({ ...base, [LIST]: list(), [ADD]: { status: 400, body: { error: "invalid_request" } } });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Idee hinzufügen" }));
    await userEvent.type(screen.getByLabelText("Titel"), "Gnocchi");
    await userEvent.click(screen.getByRole("button", { name: "Idee hinzufügen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("gültigen Link");
  });

  it("editing an idea that the server fails on", async () => {
    server({ ...base, [LIST]: list(fresh), [EDIT]: { status: 500, body: {} } });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Kürbisgnocchi bearbeiten" }));
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("editing an idea that was deleted meanwhile", async () => {
    server({ ...base, [LIST]: list(fresh), [EDIT]: { status: 404, body: { error: "idea_not_found" } } });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Kürbisgnocchi bearbeiten" }));
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("gibt es nicht mehr");
  });

  it("keeping an idea that the server fails on", async () => {
    server({ ...base, [LIST]: list(stale), [KEEP]: { status: 500, body: {} } });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Linsencurry behalten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("deleting an idea that the server fails on", async () => {
    server({ ...base, [LIST]: list(stale), [DELETE2]: { status: 500, body: {} } });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Linsencurry löschen" }));
    await userEvent.click(screen.getByRole("button", { name: "Linsencurry wirklich löschen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });
});
