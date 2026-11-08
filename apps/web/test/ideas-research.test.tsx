import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetItemFont } from "../src/ItemIcon";
import { api, renderApp, server } from "./helpers";

const LIST = `GET ${api}/ideas`;
const RESEARCH = `POST ${api}/ideas/i1/research`;
const PICK = `POST ${api}/ideas/i1/pick`;
const OWN = `POST ${api}/ideas/i1/own`;
const CREATE = `POST ${api}/import/create`;
const base = {
  [`GET ${api}/me`]: { status: 200, body: { member: { id: "2", name: "Max" } } },
  [`GET ${api}/sessions/current`]: { status: 200, body: { session: null } },
  [`GET ${api}/planned-dates`]: { status: 200, body: { dates: [] } },
  [`GET ${api}/meal-log?days=14`]: { status: 200, body: { entries: [] } },
  [`POST ${api}/import/related`]: { status: 200, body: { related: [] } },
};
const candidates = [
  { title: "Gnocchi mit Salbei", link: "https://www.kochblog.example/gnocchi", summary: "Schnell und herzhaft." },
  { title: "Kürbis-Gnocchi vegan", link: "javascript:alert(1)", summary: "" },
];
const idea = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  title: "Kürbisgnocchi",
  note: null,
  inspirationLink: null,
  addedBy: { id: "2", name: "Max", avatar: null },
  addedAt: Date.now(),
  isStale: false,
  archivedAt: null,
  candidates: [],
  ...over,
});
const draft = {
  name: "Gnocchi mit Salbei",
  steps: ["Kochen."],
  ingredients: [{ name: "Kürbis", amount: "500 g", optional: false, isNewItem: false }],
  mealType: "main",
  base: "pasta",
  diet: "vegetarian",
  tags: [],
  source: "https://www.kochblog.example/gnocchi",
};

beforeEach(() => {
  vi.stubGlobal("EventSource", undefined);
  resetItemFont();
});
afterEach(() => vi.unstubAllGlobals());

/** Expands the row of the idea, whose header is the button named like the title. */
const expand = async () => {
  const header = screen.getByRole("button", { name: "Kürbisgnocchi" });
  if (header.getAttribute("aria-expanded") !== "true") await userEvent.click(header);
};
const openIdea = async (
  routes: Record<string, { status: number; body?: unknown } | (() => { status: number; body?: unknown })>,
) => {
  const calls = server({ ...base, ...routes });
  renderApp();
  await userEvent.click(await screen.findByRole("button", { name: "Ideen" }));
  await screen.findByRole("heading", { name: "Kürbisgnocchi" });
  return calls;
};

describe("research for an idea", () => {
  it("searches, shows up to five candidates with title, site, summary and link, and a spinner meanwhile", async () => {
    let found = false;
    const calls = await openIdea({
      [LIST]: () => ({ status: 200, body: { ideas: [idea(found ? { candidates } : {})] } }),
      [RESEARCH]: () => {
        found = true;
        return { status: 200, body: { idea: idea({ candidates }) } };
      },
    });
    await expand();
    await userEvent.click(screen.getByRole("button", { name: "Rezepte suchen" }));
    const list = await screen.findByRole("list", { name: "Vorschläge für Kürbisgnocchi" });
    expect(calls.map((c) => c.key)).toContain(RESEARCH);
    const first = within(list).getAllByRole("listitem")[0]!;
    expect(first).toHaveTextContent("Gnocchi mit Salbei");
    expect(first).toHaveTextContent("kochblog.example");
    expect(first).toHaveTextContent("Schnell und herzhaft.");
    const link = within(first).getByRole("link", { name: "Seite ansehen" });
    expect(link).toHaveAttribute("href", "https://www.kochblog.example/gnocchi");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    // a link that is no web link is never clickable
    expect(within(within(list).getAllByRole("listitem")[1]!).queryByRole("link")).toBeNull();
  });

  it("offers a link to search in Claude that opens a new tab and calls nothing", async () => {
    const calls = await openIdea({
      [LIST]: () => ({
        status: 200,
        body: { ideas: [idea({ note: "ohne Sahne", inspirationLink: "https://x.example/a" })] },
      }),
    });
    await expand();
    const before = calls.length;
    const link = screen.getByRole("link", { name: "In Claude suchen" });
    const href = link.getAttribute("href") ?? "";
    expect(href.startsWith("https://claude.ai/new?q=")).toBe(true);
    const q = new URL(href).searchParams.get("q") ?? "";
    expect(q).toContain("Kürbisgnocchi");
    expect(q).toContain("ohne Sahne");
    expect(q).toContain("https://x.example/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    // no request of any kind (a stray refetch would show here too)
    expect(calls.length).toBe(before);
  });

  it("shows a spinner while the model works", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    server({ ...base, [LIST]: { status: 200, body: { ideas: [idea()] } } });
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (`${init?.method} ${url}` === RESEARCH) {
        await gate;
        return new Response(JSON.stringify({ idea: idea({ candidates }) }));
      }
      return real(url, init);
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Ideen" }));
    await userEvent.click(await screen.findByRole("button", { name: "Kürbisgnocchi" }));
    await userEvent.click(screen.getByRole("button", { name: "Rezepte suchen" }));
    expect(await screen.findByText(/Es wird gesucht/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rezepte suchen" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByText(/Es wird gesucht/)).toBeNull());
  });

  it.each([
    ["rate_limited", 429, /Zu viele Suchen/],
    ["not_configured", 503, /noch nicht eingerichtet/],
    ["nothing_found", 422, /Nichts gefunden – die bisherigen Vorschläge bleiben/],
    ["idea_not_found", 404, /gibt es nicht mehr/],
  ])("tells the member when the search answers %s", async (error, status, message) => {
    await openIdea({ [LIST]: { status: 200, body: { ideas: [idea()] } }, [RESEARCH]: { status, body: { error } } });
    await expand();
    await userEvent.click(screen.getByRole("button", { name: "Rezepte suchen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("keeps the old candidates, with their links, when a new search finds nothing", async () => {
    await openIdea({
      [LIST]: { status: 200, body: { ideas: [idea({ candidates })] } },
      [RESEARCH]: { status: 422, body: { error: "nothing_found" } },
    });
    await expand();
    await userEvent.click(screen.getByRole("button", { name: "Rezepte suchen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nichts gefunden – die bisherigen Vorschläge bleiben");
    expect(screen.getByRole("button", { name: "Gnocchi mit Salbei übernehmen" })).toBeEnabled();
    expect(screen.getAllByRole("link", { name: "Seite ansehen" })[0]).toHaveAttribute("href");
  });

  it("hides and shows the suggestions inside the expanded row", async () => {
    await openIdea({ [LIST]: { status: 200, body: { ideas: [idea({ candidates })] } } });
    expect(screen.queryByRole("list", { name: "Vorschläge für Kürbisgnocchi" })).toBeNull();
    await expand();
    expect(screen.getByRole("list", { name: "Vorschläge für Kürbisgnocchi" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Vorschläge ausblenden" }));
    expect(screen.queryByRole("list", { name: "Vorschläge für Kürbisgnocchi" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Vorschläge zeigen (2)" }));
    expect(screen.getByRole("list", { name: "Vorschläge für Kürbisgnocchi" })).toBeInTheDocument();
  });

  it("tells the member when the server cannot be reached at all", async () => {
    await openIdea({ [LIST]: { status: 200, body: { ideas: [idea()] } }, [RESEARCH]: { status: 500 } });
    await expand();
    await userEvent.click(screen.getByRole("button", { name: "Rezepte suchen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Das hat nicht geklappt");
  });
});

describe("picking a candidate or an own source", () => {
  const withCandidates = { [LIST]: { status: 200, body: { ideas: [idea({ candidates })] } } };

  it("opens the import's review with the draft; creating removes the idea from the list and says so", async () => {
    let created = false;
    const calls = await openIdea({
      [LIST]: () => ({ status: 200, body: { ideas: created ? [] : [idea({ candidates })] } }),
      [PICK]: { status: 200, body: { draft } },
      [CREATE]: () => {
        created = true;
        return { status: 201, body: { recipeId: 9, draft, photoAttached: false } };
      },
    });
    await expand();
    await userEvent.click(screen.getByRole("button", { name: "Gnocchi mit Salbei übernehmen" }));
    expect(await screen.findByRole("heading", { name: "Rezept prüfen" })).toBeInTheDocument();
    expect(calls.find((c) => c.key === PICK)?.body).toEqual({ candidate: 0 });
    expect(screen.getByLabelText("Name")).toHaveValue("Gnocchi mit Salbei");
    await userEvent.click(screen.getByRole("button", { name: "In KitchenOwl anlegen" }));
    expect(await screen.findByRole("status")).toHaveTextContent("ist jetzt in KitchenOwl");
    expect(calls.find((c) => c.key === CREATE)?.body).toMatchObject({
      idea: "i1",
      draft: { name: "Gnocchi mit Salbei" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Zurück zu den Ideen" }));
    await screen.findByText(/Noch keine Ideen/);
    expect(screen.queryByRole("heading", { name: "Kürbisgnocchi" })).toBeNull();
  });

  it("discarding the review goes back to the idea, which stays", async () => {
    await openIdea({ ...withCandidates, [PICK]: { status: 200, body: { draft } } });
    await expand();
    await userEvent.click(screen.getByRole("button", { name: "Gnocchi mit Salbei übernehmen" }));
    await userEvent.click(await screen.findByRole("button", { name: "Verwerfen" }));
    expect(await screen.findByRole("heading", { name: "Kürbisgnocchi" })).toBeInTheDocument();
  });

  it.each([
    ["address_not_public", /Diese Adresse darf nicht gelesen werden/],
    ["unreachable", /nicht erreichbar/],
    ["not_a_recipe", /kein Rezept gefunden/],
    ["not_configured", /Der Import ist auf dem Server noch nicht eingerichtet/],
    ["rate_limited", /Zu viele Versuche/],
    ["no_such_candidate", /noch einmal suchen/],
  ])(
    "tells the member when the import refuses the pick (%s) and leaves the others to choose",
    async (error, message) => {
      await openIdea({ ...withCandidates, [PICK]: { status: 422, body: { error } } });
      await expand();
      await userEvent.click(screen.getByRole("button", { name: "Gnocchi mit Salbei übernehmen" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByRole("button", { name: "Kürbis-Gnocchi vegan übernehmen" })).toBeEnabled();
    },
  );

  it("takes an own link, or an own text, instead", async () => {
    const calls = await openIdea({ ...withCandidates, [OWN]: { status: 200, body: { draft } } });
    await expand();
    await userEvent.click(screen.getByRole("button", { name: "Eigenen Link einfügen" }));
    await userEvent.click(screen.getByRole("textbox", { name: /Link oder Rezepttext/ }));
    await userEvent.paste("https://example.org/mein-rezept");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    expect(await screen.findByRole("heading", { name: "Rezept prüfen" })).toBeInTheDocument();
    expect(calls.find((c) => c.key === OWN)?.body).toEqual({ address: "https://example.org/mein-rezept" });
  });

  it("sends pasted text as text, and shows the import's refusal of an own source", async () => {
    const calls = await openIdea({ ...withCandidates, [OWN]: { status: 422, body: { error: "address_not_public" } } });
    await expand();
    await userEvent.click(screen.getByRole("button", { name: "Eigenen Link einfügen" }));
    await userEvent.click(screen.getByRole("textbox", { name: /Link oder Rezepttext/ }));
    await userEvent.paste("Kürbis kochen und stampfen");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Diese Adresse darf nicht gelesen werden");
    expect(calls.find((c) => c.key === OWN)?.body).toEqual({ text: "Kürbis kochen und stampfen" });
  });

  it("shows the failure when creating the recipe fails, and keeps the review open", async () => {
    await openIdea({
      ...withCandidates,
      [PICK]: { status: 200, body: { draft } },
      [CREATE]: { status: 502, body: { error: "kitchenowl_unavailable" } },
    });
    await expand();
    await userEvent.click(screen.getByRole("button", { name: "Gnocchi mit Salbei übernehmen" }));
    await userEvent.click(await screen.findByRole("button", { name: "In KitchenOwl anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("KitchenOwl ist gerade nicht erreichbar");
    expect(screen.getByRole("heading", { name: "Rezept prüfen" })).toBeInTheDocument();
  });
});
