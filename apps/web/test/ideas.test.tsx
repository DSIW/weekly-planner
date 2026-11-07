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
const ARCHIVE1 = `POST ${api}/ideas/i1/archive`;
const RESTORE1 = `POST ${api}/ideas/i1/restore`;
const ARCHIVE2 = `POST ${api}/ideas/i2/archive`;
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
  archivedAt: null,
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
/** Expands the row of an idea (its whole header is the button named like the title). */
const expandRow = async (title: string) => {
  const header = await screen.findByRole("button", { name: title });
  if (header.getAttribute("aria-expanded") !== "true") await userEvent.click(header);
  return header;
};
/** Expands the row of an idea and presses one of its actions. */
const chooseFromMenu = async (title: string, item: string) => {
  await expandRow(title);
  await userEvent.click(screen.getByRole("button", { name: item }));
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

  it("marks stale ideas as veraltet with a visible Behalten and Archivieren in the expanded row, apart from the others", async () => {
    server({ ...base, [LIST]: list(fresh, stale) });
    await openIdeas();
    const staleList = await screen.findByRole("list", { name: "Veraltete Ideen" });
    const card = within(staleList).getByRole("heading", { name: "Linsencurry" }).closest("li")!;
    expect(card).toHaveTextContent("veraltet");
    expect(card).toHaveTextContent("vor 2 Monaten");
    expect(within(card).getByRole("button", { name: "Linsencurry behalten" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Archivieren" })).toBeNull();
    await userEvent.click(within(card).getByRole("button", { name: "Linsencurry" }));
    expect(within(card).getByRole("button", { name: "Archivieren" })).toBeInTheDocument();
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

  it("archives with one tap: the idea leaves the list and shows up in the archive", async () => {
    let archivedAt: number | null = null;
    const calls = server({
      ...base,
      [LIST]: () => list({ ...fresh, archivedAt }),
      [ARCHIVE1]: () => {
        archivedAt = NOW;
        return { status: 200, body: { idea: { ...fresh, archivedAt } } };
      },
    });
    await openIdeas();
    await chooseFromMenu("Kürbisgnocchi", "Archivieren");
    await waitFor(() => expect(calls.some((c) => c.key === ARCHIVE1)).toBe(true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Kürbisgnocchi" })).toBeNull());
    expect(screen.getByText(/„Kürbisgnocchi“ archiviert/)).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith("DELETE"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Archiv 1" }));
    const archive = screen.getByRole("list", { name: "Archivierte Ideen" });
    expect(within(archive).getByRole("heading", { name: "Kürbisgnocchi" })).toBeInTheDocument();
  });

  it("restores from the archive, and deletes for good only after a second tap", async () => {
    let archivedAt: number | null = NOW;
    let gone = false;
    const calls = server({
      ...base,
      [LIST]: () => list(...(gone ? [] : [{ ...fresh, archivedAt }])),
      [RESTORE1]: () => {
        archivedAt = null;
        return { status: 200, body: { idea: fresh } };
      },
      [DELETE1]: () => {
        gone = true;
        return { status: 204 };
      },
    });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Archiv 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Kürbisgnocchi endgültig löschen" }));
    expect(calls.some((c) => c.key === DELETE1)).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Kürbisgnocchi endgültig löschen bestätigen" }));
    await waitFor(() => expect(calls.some((c) => c.key === DELETE1)).toBe(true));
    expect(await screen.findByText(/Noch keine Ideen/)).toBeInTheDocument();
  });

  it("brings an archived idea back to the list", async () => {
    let archivedAt: number | null = NOW;
    const calls = server({
      ...base,
      [LIST]: () => list({ ...fresh, archivedAt }),
      [RESTORE1]: () => {
        archivedAt = null;
        return { status: 200, body: { idea: fresh } };
      },
    });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Archiv 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Kürbisgnocchi wiederherstellen" }));
    await waitFor(() => expect(calls.some((c) => c.key === RESTORE1)).toBe(true));
    expect(await screen.findByRole("button", { name: "Kürbisgnocchi" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Archiv \d/ })).toBeNull();
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
    await userEvent.type(await screen.findByLabelText("Neue Idee"), "Etwas mit Kürbis");
    await userEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    expect(await screen.findByRole("heading", { name: "Etwas mit Kürbis" })).toBeInTheDocument();
    expect(calls.find((c) => c.key === ADD)?.body).toEqual({ title: "Etwas mit Kürbis" });
    expect(screen.getByText(/Max · heute/)).toBeInTheDocument();
    expect(screen.getByLabelText("Neue Idee")).toHaveValue(""); // the line is empty again
  });

  it("sends note and link when given", async () => {
    const calls = server({ ...base, [LIST]: list(), [ADD]: { status: 201, body: { idea: idea("i9") } } });
    await openIdeas();
    await userEvent.type(await screen.findByLabelText("Neue Idee"), "Gnocchi");
    await userEvent.click(screen.getByRole("button", { name: "Mit Notiz oder Link" }));
    expect(screen.getByLabelText("Titel")).toHaveValue("Gnocchi");
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
    await chooseFromMenu("Kürbisgnocchi", "Bearbeiten");
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

describe("the compact list", () => {
  it("has a slim header with the count and a one-line add field", async () => {
    server({ ...base, [LIST]: list(fresh, stale) });
    await openIdeas();
    const heading = await screen.findByRole("heading", { level: 2, name: /Ideen/ });
    await waitFor(() => expect(heading).toHaveTextContent("Ideen (2)"));
    expect(screen.getByLabelText("Neue Idee")).toBeInTheDocument();
    expect(screen.queryByLabelText("Titel")).toBeNull(); // the full form is one tap away, not in the way
  });

  it("shows avatar, title, meta line and a chevron toggle, but no action buttons while collapsed", async () => {
    server({ ...base, [LIST]: list(fresh) });
    await openIdeas();
    const row = (await screen.findByRole("heading", { name: "Kürbisgnocchi" })).closest("li")!;
    expect(row).toHaveTextContent("Max · vor 3 Tagen");
    expect(row.querySelector(".chevron")).not.toBeNull();
    expect(within(row).queryByRole("button", { name: /suchen|bearbeiten|archivieren|Eigenen/i })).toBeNull();
    expect(within(row).queryByRole("link", { name: "In Claude suchen" })).toBeNull();
    expect(within(row).queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: /Weitere Aktionen/ })).toBeNull();
  });
});

describe("the expandable rows", () => {
  it("toggles with the header button: aria-expanded, aria-controls, actions only when expanded", async () => {
    const calls = server({ ...base, [LIST]: list(fresh) });
    await openIdeas();
    const header = await screen.findByRole("button", { name: "Kürbisgnocchi" });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Rezepte suchen" })).toBeNull();
    const before = calls.length;
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(header.getAttribute("aria-controls")!)!;
    expect(
      within(panel)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Rezepte suchen", "Eigenen Link", "Bearbeiten", "Archivieren"]);
    expect(within(panel).getByRole("link", { name: "In Claude suchen" })).toBeInTheDocument();
    // the full note and the link are shown in the panel (once, not twice)
    expect(within(panel).getByText("mit Salbei")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Inspiration ansehen" })).toHaveLength(1);
    expect(calls.length).toBe(before);
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Archivieren" })).toBeNull();
  });

  it("toggles from the keyboard with Enter and Space", async () => {
    server({ ...base, [LIST]: list(fresh) });
    await openIdeas();
    const header = await screen.findByRole("button", { name: "Kürbisgnocchi" });
    header.focus();
    await userEvent.keyboard("{Enter}");
    expect(header).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard(" ");
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("opens only one row at a time", async () => {
    server({ ...base, [LIST]: list(fresh, stale) });
    await openIdeas();
    const a = await screen.findByRole("button", { name: "Kürbisgnocchi" });
    const b = screen.getByRole("button", { name: "Linsencurry" });
    await userEvent.click(a);
    await userEvent.click(b);
    expect(a).toHaveAttribute("aria-expanded", "false");
    expect(b).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("button", { name: "Archivieren" })).toHaveLength(1);
  });

  it("does not collapse a row with an open edit form when another row is opened", async () => {
    server({ ...base, [LIST]: list(fresh, stale) });
    await openIdeas();
    await chooseFromMenu("Kürbisgnocchi", "Bearbeiten");
    await userEvent.type(screen.getByLabelText("Titel"), " neu");
    await userEvent.click(screen.getByRole("button", { name: "Linsencurry" }));
    expect(screen.getByRole("button", { name: "Linsencurry" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Kürbisgnocchi" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Titel")).toHaveValue("Kürbisgnocchi neu");
    // toggling the row with the form does nothing until the form is done
    await userEvent.click(screen.getByRole("button", { name: "Kürbisgnocchi" }));
    expect(screen.getByLabelText("Titel")).toBeInTheDocument();
  });

  it("Behalten works on the collapsed row and does not toggle it", async () => {
    let kept = false;
    const calls = server({
      ...base,
      [LIST]: () => list(kept ? { ...stale, isStale: false } : stale),
      [KEEP]: () => {
        kept = true;
        return { status: 200, body: { idea: { ...stale, isStale: false } } };
      },
    });
    await openIdeas();
    const header = await screen.findByRole("button", { name: "Linsencurry" });
    await userEvent.click(screen.getByRole("button", { name: "Linsencurry behalten" }));
    expect(header).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(calls.some((c) => c.key === KEEP)).toBe(true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Linsencurry behalten" })).toBeNull());
    expect(screen.getByRole("button", { name: "Linsencurry" })).toHaveAttribute("aria-expanded", "false");
  });

  it("offers the Claude search as a real new-tab link that calls nothing", async () => {
    const calls = server({ ...base, [LIST]: list(fresh) });
    await openIdeas();
    await expandRow("Kürbisgnocchi");
    const before = calls.length;
    const claude = screen.getByRole("link", { name: "In Claude suchen" });
    expect(claude.getAttribute("href")).toMatch(/^https:\/\/claude\.ai\/new\?q=/);
    expect(claude).toHaveAttribute("target", "_blank");
    expect(claude).toHaveAttribute("rel", "noopener noreferrer");
    expect(claude).toHaveAccessibleDescription(/Antwort danach über/);
    expect(screen.getByText(/Antwort danach über/)).toBeVisible();
    expect(calls.length).toBe(before);
  });

  it("keeps the open row open and its form state when the list is refetched live", async () => {
    server({ ...base, [LIST]: list(fresh, stale) });
    await openIdeas();
    await chooseFromMenu("Kürbisgnocchi", "Bearbeiten");
    await userEvent.type(screen.getByLabelText("Titel"), "!");
    FakeEventSource.instances.at(-1)!.emit("changed");
    await waitFor(() => expect(screen.getByRole("button", { name: "Kürbisgnocchi" })).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("button", { name: "Kürbisgnocchi" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Titel")).toHaveValue("Kürbisgnocchi!");
  });

  it("keeps a plainly opened row open across a live refetch", async () => {
    server({ ...base, [LIST]: list(fresh) });
    await openIdeas();
    await expandRow("Kürbisgnocchi");
    FakeEventSource.instances.at(-1)!.emit("changed");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("button", { name: "Kürbisgnocchi" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Archivieren" })).toBeInTheDocument();
  });

  it("closes an open row with Escape and returns focus to its header", async () => {
    server({ ...base, [LIST]: list(fresh) });
    await openIdeas();
    const header = await expandRow("Kürbisgnocchi");
    screen.getByRole("button", { name: "Bearbeiten" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveFocus();
  });

  it("does not close a row with a form on Escape", async () => {
    server({ ...base, [LIST]: list(fresh) });
    await openIdeas();
    await chooseFromMenu("Kürbisgnocchi", "Bearbeiten");
    await userEvent.type(screen.getByLabelText("Titel"), "x");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByLabelText("Titel")).toHaveValue("Kürbisgnocchix");
  });

  it("opens the own-link form inside the expanded row", async () => {
    server({ ...base, [LIST]: list(fresh) });
    await openIdeas();
    await chooseFromMenu("Kürbisgnocchi", "Eigenen Link einfügen");
    expect(screen.getByRole("textbox", { name: /Link oder Rezepttext/ })).toBeInTheDocument();
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
    await userEvent.type(await screen.findByLabelText("Neue Idee"), "Gnocchi");
    await userEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
    expect(screen.getByLabelText("Neue Idee")).toHaveValue("Gnocchi");
  });

  it("adding an idea with a link the server refuses", async () => {
    server({ ...base, [LIST]: list(), [ADD]: { status: 400, body: { error: "invalid_request" } } });
    await openIdeas();
    await userEvent.type(await screen.findByLabelText("Neue Idee"), "https://example.org/gnocchi");
    await userEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("gültigen Link");
  });

  it("editing an idea that the server fails on", async () => {
    server({ ...base, [LIST]: list(fresh), [EDIT]: { status: 500, body: {} } });
    await openIdeas();
    await chooseFromMenu("Kürbisgnocchi", "Bearbeiten");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("editing an idea that was deleted meanwhile", async () => {
    server({ ...base, [LIST]: list(fresh), [EDIT]: { status: 404, body: { error: "idea_not_found" } } });
    await openIdeas();
    await chooseFromMenu("Kürbisgnocchi", "Bearbeiten");
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("gibt es nicht mehr");
  });

  it("keeping an idea that the server fails on", async () => {
    server({ ...base, [LIST]: list(stale), [KEEP]: { status: 500, body: {} } });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Linsencurry behalten" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("archiving an idea that the server fails on", async () => {
    server({ ...base, [LIST]: list(stale), [ARCHIVE2]: { status: 500, body: {} } });
    await openIdeas();
    await chooseFromMenu("Linsencurry", "Archivieren");
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
    expect(screen.getByRole("button", { name: "Linsencurry" })).toBeInTheDocument(); // stays where it was
  });
});
