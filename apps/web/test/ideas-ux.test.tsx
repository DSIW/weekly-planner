import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetItemFont } from "../src/ItemIcon";
import { resetResearchActivity } from "../src/research-activity";
import { api, renderApp, server } from "./helpers";

const LIST = `GET ${api}/ideas`;
const ADD = `POST ${api}/ideas`;
const RESEARCH = `POST ${api}/ideas/i1/research`;
const CURRENT = `GET ${api}/sessions/current`;
const base = {
  [`GET ${api}/me`]: { status: 200, body: { member: { id: "2", name: "Max" } } },
  [CURRENT]: { status: 200, body: { session: null } },
  [`GET ${api}/planned-dates`]: { status: 200, body: { dates: [] } },
  [`GET ${api}/meal-log?days=14`]: { status: 200, body: { entries: [] } },
  [`POST ${api}/import/related`]: { status: 200, body: { related: [] } },
};
const idea = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Idee ${id}`,
  note: null,
  inspirationLink: null,
  addedBy: { id: "2", name: "Max", avatar: null },
  addedAt: Date.now(),
  isStale: false,
  candidates: [],
  ...over,
});
const other = { id: "3", name: "AC", avatar: null };
const candidate = { title: "Gnocchi", link: "https://ex.org/g", summary: "" };
const list = (...ideas: unknown[]) => ({ status: 200, body: { ideas } });

beforeEach(() => {
  vi.stubGlobal("EventSource", undefined);
  resetItemFont();
  resetResearchActivity();
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const openIdeas = async () => {
  renderApp();
  await userEvent.click(await screen.findByRole("button", { name: "Ideen" }));
};

describe("quick add", () => {
  it("turns a pasted link into the idea's link and a title guessed from the address", async () => {
    const calls = server({ ...base, [LIST]: list(), [ADD]: { status: 201, body: { idea: idea("i9") } } });
    await openIdeas();
    await userEvent.click(await screen.findByLabelText("Neue Idee"));
    await userEvent.paste("https://www.lecker.de/zuercher-geschnetzeltes");
    expect(screen.getByText(/Link erkannt – Titel „Zuercher geschnetzeltes“/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === ADD)?.body).toEqual({
        title: "Zuercher geschnetzeltes",
        inspirationLink: "https://www.lecker.de/zuercher-geschnetzeltes",
      }),
    );
  });

  it("lets the guessed title be adjusted in the full form before it is saved", async () => {
    server({ ...base, [LIST]: list() });
    await openIdeas();
    await userEvent.click(await screen.findByLabelText("Neue Idee"));
    await userEvent.paste("https://ex.org/rezept/12345");
    await userEvent.click(screen.getByRole("button", { name: "Anpassen" }));
    expect(screen.getByLabelText("Titel")).toHaveValue("Rezept von ex.org");
    expect(screen.getByLabelText(/Link/)).toHaveValue("https://ex.org/rezept/12345");
  });

  it("does not add an empty line", async () => {
    server({ ...base, [LIST]: list() });
    await openIdeas();
    expect(await screen.findByRole("button", { name: "Hinzufügen" })).toBeDisabled();
  });
});

describe("empty state", () => {
  it("tells what ideas are for and how to add one", async () => {
    server({ ...base, [LIST]: list() });
    await openIdeas();
    expect(await screen.findByText("Noch keine Ideen.")).toBeInTheDocument();
    expect(screen.getByText(/Schreib oben ein Gericht auf/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Ideen filtern" })).toBeNull();
  });
});

describe("filters", () => {
  const ideas = [
    idea("a", { title: "Frisch von mir", candidates: [candidate] }),
    idea("b", { title: "Alt von AC", isStale: true, addedBy: other }),
    idea("c", { title: "Frisch von AC", addedBy: other }),
  ];
  const titles = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

  it("narrows the list by chip, with counts, and goes back to all", async () => {
    server({ ...base, [LIST]: list(...ideas) });
    await openIdeas();
    const chips = await screen.findByRole("group", { name: "Ideen filtern" });
    expect(within(chips).getByRole("button", { name: "Alle 3" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(chips).getByRole("button", { name: "Veraltet 1" }));
    expect(screen.getByRole("button", { name: "Alt von AC" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Frisch von AC" })).toBeNull();
    await userEvent.click(within(chips).getByRole("button", { name: "Mit Vorschlägen 1" }));
    expect(screen.getByRole("button", { name: "Frisch von mir" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Alt von AC" })).toBeNull();
    await userEvent.click(within(chips).getByRole("button", { name: "Von mir 1" }));
    expect(screen.getByRole("button", { name: "Frisch von mir" })).toBeInTheDocument();
    await userEvent.click(within(chips).getByRole("button", { name: "Alle 3" }));
    expect(screen.getByRole("button", { name: "Frisch von AC" })).toBeInTheDocument();
    expect(titles()).toContain("Veraltet · Lange nichts damit gemacht");
  });

  it("hides chips that would be empty", async () => {
    server({ ...base, [LIST]: list(idea("a")) });
    await openIdeas();
    const chips = await screen.findByRole("group", { name: "Ideen filtern" });
    expect(
      within(chips)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Alle 1", "Von mir 1"]);
  });
});

describe("cleanup of stale ideas", () => {
  const stale = (id: string) => idea(id, { title: `Alt ${id}`, isStale: true, addedBy: other, note: `Notiz ${id}` });

  it("steps through them: keep, delete after a second tap, later", async () => {
    let kept = false;
    let deleted = false;
    const calls = server({
      ...base,
      [LIST]: () =>
        list(
          ...[stale("x"), stale("y"), stale("z")]
            .filter((i) => !(i.id === "y" && deleted))
            .map((i) => (i.id === "x" && kept ? { ...i, isStale: false } : i)),
        ),
      [`POST ${api}/ideas/x/keep`]: () => {
        kept = true;
        return { status: 200, body: { idea: stale("x") } };
      },
      [`DELETE ${api}/ideas/y`]: () => {
        deleted = true;
        return { status: 204 };
      },
    });
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Veraltete aufräumen (3)" }));
    expect(screen.getByText("Aufräumen · 1 von 3")).toBeInTheDocument();
    expect(screen.getByText("Notiz x")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Alt x behalten" }));
    expect(await screen.findByText("Aufräumen · 2 von 3")).toBeInTheDocument();
    expect(calls.some((c) => c.key === `POST ${api}/ideas/x/keep`)).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Alt y löschen" }));
    expect(calls.some((c) => c.key === `DELETE ${api}/ideas/y`)).toBe(false); // one tap is not enough
    await userEvent.click(screen.getByRole("button", { name: "Alt y wirklich löschen" }));
    expect(await screen.findByText("Aufräumen · 3 von 3")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Später" }));
    expect(await screen.findByText("Aufgeräumt.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Fertig" }));
    expect(screen.getByRole("button", { name: "Alt z" })).toBeInTheDocument(); // left for later, still there
  });

  it("is not offered without stale ideas", async () => {
    server({ ...base, [LIST]: list(idea("a")) });
    await openIdeas();
    await screen.findByRole("button", { name: "Idee a" });
    expect(screen.queryByRole("button", { name: /aufräumen/ })).toBeNull();
  });
});

describe("research progress", () => {
  /** Holds back the research answer until `release` is called; everything else answers at once. */
  const slowResearch = () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (`${init?.method ?? "GET"} ${url}` === RESEARCH) await gate;
      return (inner as typeof fetch)(url, init);
    });
    return release;
  };

  it("shows a status in the row, and a badge on the tab when the member went elsewhere and the search finished", async () => {
    server({
      ...base,
      [LIST]: list(idea("i1", { title: "Gnocchi" })),
      [RESEARCH]: { status: 200, body: { idea: idea("i1", { title: "Gnocchi", candidates: [candidate] }) } },
    });
    const release = slowResearch();
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Gnocchi" }));
    await userEvent.click(screen.getByRole("button", { name: "Rezepte suchen" }));
    expect(screen.getAllByText("Suche läuft …").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("button", { name: "Planung" }));
    expect(screen.getByRole("button", { name: /Ideen.*Suche läuft/ })).toBeInTheDocument();

    release();
    await screen.findByText("neue Vorschläge", { exact: false });
    const tab = screen.getByRole("button", { name: /Ideen\s*1\s*neue Vorschläge/ });
    await userEvent.click(tab);
    expect(await screen.findByRole("button", { name: "Gnocchi" })).toBeInTheDocument();
    // Seen now: the badge is gone.
    await userEvent.click(screen.getByRole("button", { name: "Planung" }));
    expect(screen.getByRole("button", { name: "Ideen" })).toBeInTheDocument();
  });

  it("knows a search that is still running when the row is built again", async () => {
    server({
      ...base,
      [LIST]: list(idea("i1", { title: "Gnocchi" })),
      [RESEARCH]: { status: 200, body: { idea: idea("i1") } },
    });
    const release = slowResearch();
    await openIdeas();
    await userEvent.click(await screen.findByRole("button", { name: "Gnocchi" }));
    await userEvent.click(screen.getByRole("button", { name: "Rezepte suchen" }));
    await userEvent.click(screen.getByRole("button", { name: /Planung/ }));
    await userEvent.click(screen.getByRole("button", { name: /Ideen/ }));
    expect((await screen.findAllByText("Suche läuft …")).length).toBeGreaterThan(0);
    release();
  });
});

describe("sharing a link to the app", () => {
  it("opens the import with the shared link and cleans the address", async () => {
    window.history.replaceState(null, "", "/?title=Gnocchi&text=Siehe%20https%3A%2F%2Fwww.lecker.de%2Fgnocchi");
    server({ ...base });
    renderApp();
    expect(await screen.findByRole("textbox", { name: /Link oder Rezepttext/ })).toHaveValue(
      "https://www.lecker.de/gnocchi",
    );
    expect(screen.getByRole("button", { name: "Import" })).toHaveAttribute("aria-pressed", "true");
    expect(window.location.search).toBe("");
  });

  it("opens the plan as usual without a share", async () => {
    server({ ...base });
    renderApp();
    expect(await screen.findByRole("button", { name: "Planung" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("adding a created recipe to the plan", () => {
  const draft = {
    name: "Linsensuppe",
    steps: ["Kochen."],
    ingredients: [{ name: "Linsen", amount: "200 g", optional: false, isNewItem: false }],
    mealType: "main",
    base: "other",
    diet: "vegan",
    tags: [],
  };
  const session = (over: Record<string, unknown> = {}) => ({
    id: "s1",
    status: "open",
    startedBy: "2",
    reminderSent: false,
    days: [
      { date: "2026-11-02", status: "planned" },
      { date: "2026-11-03", status: "open" },
      { date: "2026-11-04", status: "open" },
    ],
    proposals: [],
    ...over,
  });
  const PROPOSE = `POST ${api}/sessions/s1/proposals`;
  const create = async () => {
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    await userEvent.click(screen.getByRole("textbox", { name: /Link oder Rezepttext/ }));
    await userEvent.paste("https://example.org/linsen");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    await userEvent.click(await screen.findByRole("button", { name: "In KitchenOwl anlegen" }));
    await screen.findByRole("heading", { name: "Rezept angelegt" });
  };
  const routes = {
    ...base,
    [`POST ${api}/import/draft`]: { status: 200, body: { draft } },
    [`POST ${api}/import/create`]: { status: 201, body: { recipeId: 173, draft } },
    [`GET ${api}/links`]: { status: 200, body: { links: null } },
    [`POST ${api}/recipes/refresh`]: { status: 204 },
  };

  it("proposes the new recipe for the next open day, after reading the recipes again", async () => {
    const calls = server({
      ...routes,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PROPOSE]: { status: 200, body: { session: session() } },
    });
    await create();
    await userEvent.click(await screen.findByRole("button", { name: /^Für .* vorschlagen$/ }));
    expect(await screen.findByText(/vorgeschlagen\. Die andere Person kann jetzt zustimmen/)).toBeInTheDocument();
    const keys = calls.map((c) => c.key);
    expect(keys.indexOf(`POST ${api}/recipes/refresh`)).toBeLessThan(keys.indexOf(PROPOSE));
    expect(calls.find((c) => c.key === PROPOSE)?.body).toEqual({ date: "2026-11-03", recipeId: 173 });
  });

  it("skips days that already wait for an answer", async () => {
    const calls = server({
      ...routes,
      [CURRENT]: {
        status: 200,
        body: {
          session: session({
            proposals: [
              { id: "p1", date: "2026-11-03", status: "pending", proposedBy: "3", recipe: { id: 1, name: "X" } },
            ],
          }),
        },
      },
      [PROPOSE]: { status: 200, body: { session: session() } },
    });
    await create();
    await userEvent.click(await screen.findByRole("button", { name: /^Für .* vorschlagen$/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === PROPOSE)?.body).toEqual({ date: "2026-11-04", recipeId: 173 }),
    );
  });

  it("warns when the recipe is too long for a weekday and proposes anyway on request", async () => {
    let attempts = 0;
    const calls = server({
      ...routes,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PROPOSE]: () =>
        ++attempts === 1
          ? { status: 409, body: { error: "too_long_for_weekday" } }
          : { status: 200, body: { session: session() } },
    });
    await create();
    await userEvent.click(await screen.findByRole("button", { name: /^Für .* vorschlagen$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("eigentlich zu lang");
    await userEvent.click(screen.getByRole("button", { name: "Trotzdem vorschlagen" }));
    await waitFor(() =>
      expect(calls.filter((c) => c.key === PROPOSE)[1]?.body).toEqual({
        date: "2026-11-03",
        recipeId: 173,
        despiteTime: true,
      }),
    );
  });

  it("is not offered without an open plan", async () => {
    server({ ...routes });
    await create();
    expect(screen.queryByRole("button", { name: /vorschlagen/ })).toBeNull();
  });
});
