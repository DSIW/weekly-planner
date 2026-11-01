import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayPlanDate } from "../src/dates";
import { api, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const LOG = `GET ${api}/meal-log?days=14`;
const RECIPES = `GET ${api}/recipes`;
const ADD = `POST ${api}/meal-log`;
const CONFIRM = `POST ${api}/meal-log/e1/confirm`;
const NOT_COOKED = `POST ${api}/meal-log/e1/not-cooked`;
const CORRECT = `POST ${api}/meal-log/e1/correct`;
const base = {
  [ME]: { status: 200, body: { member: { id: "2", name: "Max" } } },
  [CURRENT]: { status: 200, body: { session: null } },
};

const recipe = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  minutes: 30,
  base: "pasta",
  diet: "vegetarian",
  tags: [],
  needsTime: false,
  planAhead: false,
  ...over,
});
const pasta = recipe(1, "Pasta", { tags: ["🍝 Pasta"] });
const risotto = recipe(2, "Risotto", { base: "rice" });
const entry = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  date: "2026-10-31",
  base: "pasta",
  recipe: pasta,
  source: "from_plan",
  confirmed: false,
  ...over,
});
const logOf = (...entries: unknown[]) => ({ status: 200, body: { entries } });
const recipes = { status: 200, body: { recipes: [pasta, risotto] } };

beforeEach(() => {
  vi.stubGlobal("EventSource", undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 1, 12)); // Sunday 1 November 2026
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the question the day after", () => {
  it("asks about yesterday's planned dinner on a card with its picture and tags", async () => {
    server({ ...base, [LOG]: logOf(entry()) });
    renderApp();
    const heading = await screen.findByRole("heading", { name: /Habt ihr das gekocht\? .*31\.10\./ });
    const card = heading.closest("section")!;
    expect(card.querySelector("img")).toHaveAttribute("src", `${api}/recipes/1/photo`);
    expect(card).toHaveTextContent("Pasta");
    expect(card).toHaveTextContent("🍝 Pasta");
    expect(within(card).getByRole("button", { name: "Gekocht" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Nicht gekocht" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Etwas anderes" })).toBeInTheDocument();
  });

  it("does not ask about today's dinner, a confirmed one, or one the household added or corrected", async () => {
    server({
      ...base,
      [LOG]: logOf(
        entry({ id: "today", date: "2026-11-01" }),
        entry({ id: "done", confirmed: true }),
        entry({ id: "added", source: "added", confirmed: true }),
        entry({ id: "fixed", source: "corrected", confirmed: true }),
      ),
    });
    renderApp();
    await screen.findByText(/Hallo, Max/);
    await waitFor(() => expect(screen.getByRole("list", { name: "Verlauf" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: /Habt ihr das gekocht/ })).not.toBeInTheDocument();
  });

  it("asks once per day, oldest first", async () => {
    server({
      ...base,
      [LOG]: logOf(entry({ id: "b", date: "2026-10-31" }), entry({ id: "a", date: "2026-10-30", recipe: risotto })),
    });
    renderApp();
    const headings = await screen.findAllByRole("heading", { name: /Habt ihr das gekocht/ });
    expect(headings.map((h) => h.textContent)).toEqual([
      expect.stringContaining("30.10."),
      expect.stringContaining("31.10."),
    ]);
  });

  it("confirms with one tap and the question goes away", async () => {
    let entries = [entry()];
    const calls = server({
      ...base,
      [LOG]: () => logOf(...entries),
      [CONFIRM]: () => {
        entries = [entry({ confirmed: true })];
        return { status: 200, body: { entry: entries[0] } };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Gekocht" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /Habt ihr das gekocht/ })).not.toBeInTheDocument(),
    );
    expect(calls.some((c) => c.key === CONFIRM)).toBe(true);
  });

  it("removes the meal when it was not cooked", async () => {
    let entries = [entry()];
    const calls = server({
      ...base,
      [LOG]: () => logOf(...entries),
      [NOT_COOKED]: () => {
        entries = [];
        return { status: 200, body: { entry: entry() } };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Nicht gekocht" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /Habt ihr das gekocht/ })).not.toBeInTheDocument(),
    );
    expect(calls.some((c) => c.key === NOT_COOKED)).toBe(true);
  });

  it("says why when the answer was refused", async () => {
    server({
      ...base,
      [LOG]: logOf(entry()),
      [CONFIRM]: { status: 409, body: { error: "already_confirmed" } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Gekocht" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("schon als gekocht bestätigt");
  });

  it("says so when answering failed for any other reason", async () => {
    server({ ...base, [LOG]: logOf(entry()), [NOT_COOKED]: { status: 500, body: {} } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Nicht gekocht" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });
});

describe("something else was cooked", () => {
  it("corrects the meal to another recipe, taking its base from the recipe", async () => {
    const calls = server({
      ...base,
      [LOG]: logOf(entry()),
      [RECIPES]: recipes,
      [CORRECT]: { status: 200, body: { entry: entry({ source: "corrected", confirmed: true, recipe: risotto }) } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Etwas anderes" }));
    expect(screen.queryByRole("button", { name: "Gekocht" })).not.toBeInTheDocument();
    await userEvent.type(await screen.findByLabelText("Rezept suchen"), "ris");
    expect(screen.queryByRole("button", { name: /Pasta/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Risotto/ }));
    await waitFor(() => expect(calls.find((c) => c.key === CORRECT)?.body).toEqual({ base: "rice", recipeId: 2 }));
  });

  it("corrects the meal to a base only when the dish is not in KitchenOwl", async () => {
    const calls = server({
      ...base,
      [LOG]: logOf(entry()),
      [RECIPES]: recipes,
      [CORRECT]: { status: 200, body: { entry: entry({ recipe: null, base: "bread", confirmed: true }) } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Etwas anderes" }));
    await userEvent.click(screen.getByRole("button", { name: "Nur Basis" }));
    expect(screen.queryByLabelText("Rezept suchen")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Brot" }));
    await waitFor(() => expect(calls.find((c) => c.key === CORRECT)?.body).toEqual({ base: "bread", recipeId: null }));
  });

  it("goes back to the question when cancelled", async () => {
    server({ ...base, [LOG]: logOf(entry()), [RECIPES]: recipes });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Etwas anderes" }));
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.getByRole("button", { name: "Gekocht" })).toBeInTheDocument();
  });

  it("says so when the recipes cannot be loaded", async () => {
    server({ ...base, [LOG]: logOf(entry()), [RECIPES]: { status: 500, body: {} } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Etwas anderes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Die Rezepte konnten nicht geladen werden");
  });
});

describe("the history", () => {
  it("lists the meals with what was cooked, a base-only meal marked as such, and which are still open", async () => {
    server({
      ...base,
      [LOG]: logOf(
        entry({ id: "a", date: "2026-10-31" }),
        entry({ id: "b", date: "2026-10-30", recipe: null, base: "rice", source: "added", confirmed: true }),
      ),
    });
    renderApp();
    const list = await screen.findByRole("list", { name: "Verlauf" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent(/31\.10\.\s*Pasta\s*offen/);
    expect(first?.querySelector(".thumb img")).toHaveAttribute("src", `${api}/recipes/1/photo`);
    expect(second).toHaveTextContent(/30\.10\.\s*🍚\s*Reis \(ohne Rezept\)\s*gekocht/);
    expect(second).toHaveTextContent("🍚"); // a base-only meal has the base's emoji where a recipe has its picture
  });

  it("says so when nothing was eaten yet, and when the history cannot be loaded", async () => {
    server({ ...base, [LOG]: logOf() });
    const view = renderApp();
    expect(await screen.findByText("Noch nichts eingetragen.")).toBeInTheDocument();
    view.unmount();
    server({ ...base, [LOG]: { status: 500, body: {} } });
    renderApp();
    expect(await screen.findByText("Der Verlauf konnte nicht geladen werden.")).toBeInTheDocument();
  });
});

describe("adding a meal", () => {
  const open = async () => {
    await userEvent.click(await screen.findByText("Verlauf und Mahlzeit nachtragen"));
    await userEvent.click(screen.getByRole("button", { name: "Mahlzeit nachtragen" }));
  };

  it("adds a recipe for the chosen day, today first", async () => {
    const calls = server({
      ...base,
      [LOG]: logOf(),
      [RECIPES]: recipes,
      [ADD]: { status: 201, body: { entry: entry({ source: "added", confirmed: true }) } },
    });
    renderApp();
    await open();
    const day = screen.getByLabelText("Tag") as HTMLSelectElement;
    expect([...day.options].map((o) => o.value)).toEqual([
      "2026-11-01",
      "2026-10-31",
      "2026-10-30",
      "2026-10-29",
      "2026-10-28",
      "2026-10-27",
      "2026-10-26",
    ]);
    await userEvent.selectOptions(day, "2026-10-30");
    await userEvent.click(await screen.findByRole("button", { name: /Risotto/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === ADD)?.body).toEqual({ date: "2026-10-30", base: "rice", recipeId: 2 }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Tag")).not.toBeInTheDocument()); // closed after adding
  });

  it("offers the recipes with their thumbnails, and a search that says what it is", async () => {
    server({ ...base, [LOG]: logOf(), [RECIPES]: recipes });
    renderApp();
    await open();
    const search = await screen.findByPlaceholderText("Rezept suchen …");
    expect(search).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Rezept suchen")).toBe(search);
    const pastaRow = await screen.findByRole("button", { name: /Pasta/ });
    expect(pastaRow.querySelector(".thumb img")).toHaveAttribute("src", `${api}/recipes/1/photo`);
  });

  it("offers the bases with the emoji of KitchenOwl's base tags", async () => {
    server({ ...base, [LOG]: logOf(), [RECIPES]: recipes });
    renderApp();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Nur Basis" }));
    const emoji = ["🍝", "🍚", "🥔", "🌾", "🥖", "🍽️"];
    const names = ["Pasta", "Reis", "Kartoffeln", "Getreide", "Brot", "Sonstiges"];
    names.forEach((name, i) => {
      const tile = screen.getByRole("button", { name });
      expect(tile).toHaveTextContent(`${emoji[i]}${name}`);
    });
  });

  it("says that a meal replaces what is logged for that day", async () => {
    server({ ...base, [LOG]: logOf(entry({ id: "a", date: "2026-10-31" })), [RECIPES]: recipes });
    renderApp();
    await open();
    expect(screen.queryByText(/wird ersetzt/)).not.toBeInTheDocument(); // today: nothing logged yet
    await userEvent.selectOptions(screen.getByLabelText("Tag"), "2026-10-31");
    expect(screen.getByText("Was für diesen Tag eingetragen ist, wird ersetzt.")).toBeInTheDocument();
  });

  it("adds a meal by its base only", async () => {
    const calls = server({
      ...base,
      [LOG]: logOf(),
      [RECIPES]: recipes,
      [ADD]: { status: 201, body: { entry: entry({ recipe: null, source: "added", confirmed: true }) } },
    });
    renderApp();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Nur Basis" }));
    await userEvent.click(screen.getByRole("button", { name: "Kartoffeln" }));
    await waitFor(() =>
      expect(calls.find((c) => c.key === ADD)?.body).toEqual({ date: "2026-11-01", base: "potatoes", recipeId: null }),
    );
  });

  it("says why when the meal was refused, and stays open", async () => {
    server({
      ...base,
      [LOG]: logOf(),
      [RECIPES]: recipes,
      [ADD]: { status: 422, body: { error: "date_in_future" } },
    });
    renderApp();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Nur Basis" }));
    await userEvent.click(screen.getByRole("button", { name: "Brot" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Zukunft");
    expect(screen.getByLabelText("Tag")).toBeInTheDocument();
  });

  it("can be cancelled", async () => {
    server({ ...base, [LOG]: logOf(), [RECIPES]: recipes });
    renderApp();
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByLabelText("Tag")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mahlzeit nachtragen" })).toBeInTheDocument();
  });
});

describe("the question the day after, further cases", () => {
  it("does not ask about an unconfirmed meal that did not come from the plan", async () => {
    server({ ...base, [LOG]: logOf(entry({ id: "added", source: "added", confirmed: false })) });
    renderApp();
    await waitFor(() => expect(screen.getByRole("list", { name: "Verlauf" })).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: /Habt ihr das gekocht/ })).not.toBeInTheDocument();
  });

  it("says when the meal is gone, and when it has no recipe to confirm", async () => {
    server({ ...base, [LOG]: logOf(entry()), [CONFIRM]: { status: 404, body: { error: "unknown_entry" } } });
    const view = renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Gekocht" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Diese Mahlzeit gibt es nicht mehr.");
    view.unmount();
    server({ ...base, [LOG]: logOf(entry()), [CONFIRM]: { status: 422, body: { error: "no_recipe" } } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Gekocht" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ohne Rezept lässt sich das nicht bestätigen.");
  });

  it("disables the answers while one runs", async () => {
    server({ ...base, [LOG]: logOf(entry()) });
    const reply = vi.mocked(fetch);
    const original = reply.getMockImplementation()!;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    reply.mockImplementation(async (url, init) => {
      if (`${init?.method ?? "GET"} ${String(url)}` === CONFIRM) await gate;
      return original(url, init);
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Gekocht" }));
    expect(screen.getByRole("button", { name: "Gekocht" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nicht gekocht" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Etwas anderes" })).toBeDisabled();
    release();
  });
});

describe("something else was cooked, further cases", () => {
  it("closes the chooser after the correction went through", async () => {
    server({
      ...base,
      [LOG]: logOf(entry()),
      [RECIPES]: recipes,
      [CORRECT]: { status: 200, body: { entry: entry({ source: "corrected", confirmed: true, recipe: risotto }) } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Etwas anderes" }));
    await userEvent.click(await screen.findByRole("button", { name: /Risotto/ }));
    await waitFor(() => expect(screen.queryByLabelText("Rezept suchen")).not.toBeInTheDocument());
  });

  it("says so as an alert when the correction failed", async () => {
    server({ ...base, [LOG]: logOf(entry()), [RECIPES]: recipes, [CORRECT]: { status: 500, body: {} } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Etwas anderes" }));
    await userEvent.click(await screen.findByRole("button", { name: /Risotto/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("says so when the search finds no recipe", async () => {
    server({ ...base, [LOG]: logOf(entry()), [RECIPES]: recipes });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Etwas anderes" }));
    await userEvent.type(await screen.findByLabelText("Rezept suchen"), "xyz");
    expect(await screen.findByText("Kein Rezept gefunden.")).toBeInTheDocument();
  });
});

describe("the history, further cases", () => {
  it("does not claim nothing was eaten when the history cannot be loaded", async () => {
    server({ ...base, [LOG]: { status: 500, body: {} } });
    renderApp();
    expect(await screen.findByText("Der Verlauf konnte nicht geladen werden.")).toBeInTheDocument();
    expect(screen.queryByText("Noch nichts eingetragen.")).not.toBeInTheDocument();
  });
});

describe("today's date", () => {
  it("is the phone's own calendar day, not the UTC one", () => {
    const tz = process.env.TZ;
    process.env.TZ = "Europe/Berlin";
    try {
      expect(todayPlanDate(new Date(2026, 10, 1, 0, 30))).toBe("2026-11-01");
    } finally {
      process.env.TZ = tz;
    }
  });
});
