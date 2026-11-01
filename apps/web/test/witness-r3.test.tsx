import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetItemFont } from "../src/ItemIcon";
import { api, dayRows, findDayRows, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const START = `POST ${api}/sessions`;
const PLANNED = `GET ${api}/planned-dates`;
const PREVIEW = `GET ${api}/sessions/s1/finalize-preview`;
const FINALIZE = `POST ${api}/sessions/s1/finalize`;
const DECK = `GET ${api}/sessions/s1/deck`;
const RECIPES = `GET ${api}/sessions/s1/recipes`;
const PASS = `POST ${api}/sessions/s1/passes`;
const PROPOSE = `POST ${api}/sessions/s1/proposals`;
const WITHDRAW = `POST ${api}/sessions/s1/proposals/p1/withdraw`;
const LEFTOVERS = `POST ${api}/sessions/s1/days/2026-11-03/leftovers`;
const LOG = `GET ${api}/meal-log?days=14`;
const ALL_RECIPES = `GET ${api}/recipes`;
const max = { id: "2", name: "Max" };
const signedIn = { [ME]: { status: 200, body: { member: max } } };

const pasta = {
  id: 1,
  name: "Pasta",
  minutes: 30,
  base: "pasta",
  diet: "vegetarian",
  needsTime: false,
  planAhead: false,
};
const curry = { ...pasta, id: 2, name: "Curry" };
const session = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  status: "open",
  startedBy: "2",
  days: [
    { date: "2026-11-02", status: "open" },
    { date: "2026-11-03", status: "open" },
  ],
  proposals: [],
  ...over,
});
const withPlanned = (over: Record<string, unknown> = {}) =>
  session({
    days: [
      { date: "2026-11-02", status: "planned", recipe: pasta },
      { date: "2026-11-03", status: "open" },
    ],
    ...over,
  });
const pending = { id: "p1", date: "2026-11-03", recipe: curry, proposedBy: "2", status: "pending" };
const preview = { status: 200, body: { dinners: [], items: [] } };
const failedExport = {
  complete: false,
  failure: "refused",
  days: [{ date: "2026-11-02", recipeName: "Pasta", status: "pending" }],
  list: { status: "pending", items: [] },
};
const finalized = (days: unknown[]) => session({ status: "finalized", days, export: failedExport });

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
const changed = () => {
  for (const s of FakeEventSource.instances) s.emit("changed");
};

/** From the moment it is switched on, every read takes a long while, so only a command's own answer can show. */
const slowReads = () => {
  const answer = globalThis.fetch;
  const state = { slow: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (state.slow && !init?.method) await new Promise((resolve) => setTimeout(resolve, 3000));
      return answer(url, init);
    }),
  );
  return state;
};

/** Holds back the reply to one request until released. */
const hold = (key: string) => {
  const answer = globalThis.fetch;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (`${init?.method ?? "GET"} ${url}` === key) await gate;
      return answer(url, init);
    }),
  );
  return () => release();
};

const step = () => screen.getByRole("list", { name: "Schritte der Planung" }).querySelector('[aria-current="step"]');

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  resetItemFont();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 1, 12));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the shopping-list step (witness r3)", () => {
  it("ends while the member is on it once a vote starts on the other phone", async () => {
    let current: unknown = withPlanned();
    server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [PREVIEW]: preview,
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Weiter zur Einkaufsliste" }));
    await screen.findByRole("button", { name: "Einkaufsliste füllen" });
    current = withPlanned({ proposals: [{ ...pending, proposedBy: "3" }] });
    changed();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Einkaufsliste füllen" })).not.toBeInTheDocument());
    expect(step()).toHaveTextContent("Gerichte");
  });

  it("starts a new plan on the dishes step, even when the last plan was left on the shopping list", async () => {
    let current: unknown = withPlanned();
    server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [PREVIEW]: preview,
      [START]: () => {
        current = session();
        return { status: 201, body: { session: current } };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Weiter zur Einkaufsliste" }));
    await screen.findByRole("button", { name: "Einkaufsliste füllen" });
    current = null; // the other phone closed the plan
    changed();
    await userEvent.click(await screen.findByRole("button", { name: /^Mo.*2\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: /^Di.*3\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: "Planung starten" }));
    await findDayRows();
    current = withPlanned(); // a dish gets agreed in the new plan
    changed();
    await waitFor(() => expect(dayRows()[0]).toHaveTextContent("Pasta"));
    expect(screen.queryByRole("button", { name: "Einkaufsliste füllen" })).not.toBeInTheDocument();
    expect(step()).toHaveTextContent("Gerichte");
  });

  it("is not offered on a finalized plan", async () => {
    server({
      ...signedIn,
      [CURRENT]: {
        status: 200,
        body: { session: finalized([{ date: "2026-11-02", status: "planned", recipe: pasta }]) },
      },
    });
    renderApp();
    await screen.findByRole("heading", { name: "Abgeschlossene Planung" });
    expect(screen.queryByRole("button", { name: "Weiter zur Einkaufsliste" })).not.toBeInTheDocument();
  });

  it("cannot be reached while a change to the plan is on its way", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: withPlanned() } },
      [DECK]: { status: 200, body: { date: "2026-11-03", cards: [] } },
      [LEFTOVERS]: { status: 200, body: { session: withPlanned() } },
    });
    const release = hold(LEFTOVERS);
    renderApp();
    const rows = await findDayRows();
    expect(screen.getByRole("button", { name: "Weiter zur Einkaufsliste" })).toBeEnabled();
    await userEvent.click(within(rows[1]!).getByRole("button", { name: "Reste" }));
    expect(screen.getByRole("button", { name: "Weiter zur Einkaufsliste" })).toBeDisabled();
    release();
  });
});

describe("a command's answer shows at once (witness r3)", () => {
  it("shows a started plan before the reload is in", async () => {
    let current: unknown = null;
    server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [START]: () => ({ status: 201, body: { session: session() } }),
    });
    const reads = slowReads();
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: /^Mo.*2\.11\./ }));
    await userEvent.click(screen.getByRole("button", { name: /^Di.*3\.11\./ }));
    reads.slow = true;
    current = session();
    await userEvent.click(screen.getByRole("button", { name: "Planung starten" }));
    expect(await screen.findByRole("list", { name: "Tage der Planung" })).toBeInTheDocument();
  });

  it("shows a proposal waiting before the reload is in", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [DECK]: { status: 200, body: { date: "2026-11-02", cards: [{ ...pasta, isNew: false }] } },
      [PROPOSE]: {
        status: 201,
        body: { session: session({ proposals: [{ ...pending, date: "2026-11-02", recipe: pasta }] }) },
      },
    });
    const reads = slowReads();
    renderApp();
    const propose = await screen.findByRole("button", { name: "Vorschlagen" });
    reads.slow = true;
    await userEvent.click(propose);
    await waitFor(() => expect(dayRows()[0]).toHaveTextContent("wartet auf Antwort"));
  });

  it("shows a withdrawn proposal gone before the reload is in", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session({ proposals: [pending] }) } },
      [DECK]: { status: 200, body: { date: "2026-11-02", cards: [] } },
      [WITHDRAW]: { status: 200, body: { session: session({ proposals: [{ ...pending, status: "withdrawn" }] }) } },
    });
    const reads = slowReads();
    renderApp();
    const back = await screen.findByRole("button", { name: "Zurückziehen" });
    reads.slow = true;
    await userEvent.click(back);
    await waitFor(() => expect(dayRows()[1]).not.toHaveTextContent("wartet auf Antwort"));
    expect(screen.queryByRole("button", { name: "Zurückziehen" })).not.toBeInTheDocument();
  });

  it("does not show an answer that is no longer an open plan; the reload decides", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [DECK]: { status: 200, body: { date: "2026-11-02", cards: [] } },
      [LEFTOVERS]: { status: 200, body: { session: session({ status: "finalized" }) } },
    });
    const reads = slowReads();
    renderApp();
    const rows = await findDayRows();
    reads.slow = true;
    await userEvent.click(within(rows[1]!).getByRole("button", { name: "Reste" }));
    await waitFor(() => expect(within(dayRows()[1]!).getByRole("button", { name: "Reste" })).toBeEnabled());
    expect(screen.queryByRole("heading", { name: "Abgeschlossene Planung" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Planung" })).toBeInTheDocument();
  });
});

describe("choosing while the next cards or recipes load (witness r3)", () => {
  it("takes no decision on the deck until the cards of the next day are in", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [DECK]: {
        status: 200,
        body: {
          date: "2026-11-02",
          cards: [
            { ...pasta, isNew: false },
            { ...curry, isNew: false },
          ],
        },
      },
      [PASS]: { status: 200, body: { session: session() } },
    });
    const reads = slowReads();
    renderApp();
    const skip = await screen.findByRole("button", { name: "Überspringen" });
    reads.slow = true;
    await userEvent.click(skip);
    // The pass is answered at once; the deck's reload still runs, so its buttons stay off.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByRole("button", { name: "Überspringen" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Vorschlagen" })).toBeDisabled();
  });

  it("takes no pick from the list until the recipes of the next day are in", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [DECK]: { status: 200, body: { date: "2026-11-02", cards: [] } },
      [RECIPES]: { status: 200, body: { date: "2026-11-02", recipes: [pasta, curry] } },
      [PROPOSE]: {
        status: 201,
        body: { session: session({ proposals: [{ ...pending, date: "2026-11-02", recipe: pasta }] }) },
      },
    });
    const reads = slowReads();
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Liste" }));
    const pick = await screen.findByRole("button", { name: /Pasta/ });
    reads.slow = true;
    await userEvent.click(pick);
    await waitFor(() => expect(dayRows()[0]).toHaveTextContent("wartet auf Antwort"));
    expect(screen.getByRole("button", { name: /Curry/ })).toBeDisabled();
  });
});

describe("the rows of the plan (witness r3)", () => {
  it("names a dish that was removed in KitchenOwl", async () => {
    server({
      ...signedIn,
      [CURRENT]: {
        status: 200,
        body: {
          session: withPlanned({
            days: [
              { date: "2026-11-02", status: "planned", recipe: pasta, removedInPlanner: true },
              { date: "2026-11-03", status: "planned", recipe: curry },
            ],
          }),
        },
      },
    });
    renderApp();
    const rows = await findDayRows();
    expect(rows[0]).toHaveTextContent("in KitchenOwl entfernt");
    expect(rows[1]).not.toHaveTextContent("in KitchenOwl entfernt");
  });

  it("marks the next free day as next, not the day whose proposal waits", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session({ proposals: [{ ...pending, date: "2026-11-02" }] }) } },
      [DECK]: { status: 200, body: { date: "2026-11-03", cards: [] } },
    });
    renderApp();
    const rows = await findDayRows();
    expect(rows[0]).toHaveTextContent("wartet auf Antwort");
    expect(rows[1]).toHaveTextContent("Als Nächstes dran");
  });

  it("offers nothing to change on a finalized plan: no way back from leftovers, no next day", async () => {
    server({
      ...signedIn,
      [CURRENT]: {
        status: 200,
        body: {
          session: finalized([
            { date: "2026-11-02", status: "planned", recipe: pasta },
            { date: "2026-11-03", status: "leftovers" },
            { date: "2026-11-04", status: "open" },
          ]),
        },
      },
    });
    renderApp();
    await screen.findByRole("heading", { name: "Abgeschlossene Planung" });
    const rows = dayRows();
    expect(rows[1]).toHaveTextContent("Reste");
    expect(screen.queryByRole("button", { name: "Doch kochen" })).not.toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("noch offen");
    expect(rows[2]).not.toHaveTextContent("Als Nächstes dran");
  });

  it("shows the placeholder when a dish's thumbnail cannot be loaded", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session({ proposals: [pending] }) } },
      [DECK]: { status: 200, body: { date: "2026-11-02", cards: [] } },
    });
    renderApp();
    const row = (await findDayRows())[1]!;
    fireEvent.error(row.querySelector(".thumb img")!);
    await waitFor(() => expect(row.querySelector(".thumb img")).toBeNull());
    expect(row.querySelector(".thumb")).toHaveTextContent("🍽️");
  });
});

describe("the shopping list panel (witness r3)", () => {
  const onList = async (items: unknown[]) => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: withPlanned() } },
      [PREVIEW]: { status: 200, body: { dinners: [], items } },
      [FINALIZE]: { status: 200, body: { session: withPlanned() } },
    });
  };
  const toList = async () => userEvent.click(await screen.findByRole("button", { name: "Weiter zur Einkaufsliste" }));
  const onion = { name: "Zwiebel", description: "3 Stück", needsReview: false, recipes: ["Pasta"] };

  it("does not claim staples were left off when there are none", async () => {
    await onList([onion]);
    renderApp();
    await toList();
    await screen.findByRole("checkbox", { name: /Zwiebel/ });
    expect(screen.queryByText(/Salz, Pfeffer, Öl und Wasser/)).not.toBeInTheDocument();
  });

  it("cannot be sent while the list is still loading", async () => {
    await onList([onion]);
    const release = hold(PREVIEW);
    renderApp();
    await toList();
    expect(await screen.findByRole("button", { name: "Einkaufsliste füllen" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Einkaufsliste füllen" })).toBeEnabled());
  });

  it("cannot go back while the list is being sent", async () => {
    await onList([onion]);
    const release = hold(FINALIZE);
    renderApp();
    await toList();
    await screen.findByRole("checkbox", { name: /Zwiebel/ });
    await userEvent.click(screen.getByRole("button", { name: "Einkaufsliste füllen" }));
    expect(screen.getByRole("button", { name: "Zurück zu den Gerichten" })).toBeDisabled();
    release();
  });

  it("stands in an item's first letter, as a capital and without leading blanks", async () => {
    await onList([{ ...onion, name: " zwiebel" }]);
    renderApp();
    await toList();
    const list = await screen.findByRole("list", { name: "Einkaufsliste" });
    expect(list.querySelector(".item-icon")?.textContent).toBe("Z");
  });

  it("stands in the first letter when the icon font cannot be loaded", async () => {
    vi.stubGlobal(
      "FontFace",
      class {
        load() {
          return Promise.reject(new Error("no font"));
        }
      },
    );
    await onList([{ ...onion, icon: "onion" }]);
    renderApp();
    await toList();
    const list = await screen.findByRole("list", { name: "Einkaufsliste" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(list.querySelector("[data-icon]")).toBeNull();
    expect(list.querySelector(".item-icon")?.textContent).toBe("Z");
  });

  it("adds the loaded icon font to the page", async () => {
    const add = vi.fn();
    class Font {
      load() {
        return Promise.resolve(this);
      }
    }
    vi.stubGlobal("FontFace", Font);
    Object.defineProperty(document, "fonts", { value: { add }, configurable: true });
    await onList([{ ...onion, icon: "onion" }]);
    renderApp();
    await toList();
    const list = await screen.findByRole("list", { name: "Einkaufsliste" });
    await waitFor(() => expect(list.querySelector('[data-icon="onion"]')).not.toBeNull());
    expect(add).toHaveBeenCalledWith(expect.any(Font));
    Reflect.deleteProperty(document, "fonts");
  });
});

describe("dates that already hold a dinner (witness r3)", () => {
  it("say why they are grey, and name the dinner or that one is planned", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: null } },
      [PLANNED]: { status: 200, body: { dates: [{ date: "2026-11-03", recipeName: "" }] } },
    });
    renderApp();
    const taken = await screen.findByRole("button", { name: /3\.11\./ });
    await waitFor(() => expect(taken).toBeDisabled());
    expect(taken).toHaveTextContent("schon geplant");
    expect(screen.queryByRole("list", { name: "Schon geplant" })).not.toBeInTheDocument(); // no recipe to show
  });

  it("are listed with the recipe's picture on the first screen", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: null } },
      [PLANNED]: {
        status: 200,
        body: {
          dates: [
            { date: "2026-11-03", recipeName: "Pasta", recipeId: 7 },
            { date: "2026-11-04", recipeName: "Risotto" },
          ],
        },
      },
    });
    renderApp();
    const list = await screen.findByRole("list", { name: "Schon geplant" });
    const [first] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("Pasta");
    expect(first?.querySelector(".thumb img")).toHaveAttribute("src", `${api}/recipes/7/photo`);
  });

  it("are not explained when there are none", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: null } },
      [PLANNED]: { status: 200, body: { dates: [] } },
    });
    renderApp();
    await screen.findByRole("button", { name: "Planung starten" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("list", { name: "Schon geplant" })).not.toBeInTheDocument();
  });
});

describe("adding a meal by its base (witness r3)", () => {
  it("says that only the base counts for a meal that is not in KitchenOwl", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: null } },
      [LOG]: { status: 200, body: { entries: [] } },
      [ALL_RECIPES]: { status: 200, body: { recipes: [pasta] } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Verlauf" }));
    await userEvent.click(screen.getByRole("button", { name: "Mahlzeit nachtragen" }));
    await userEvent.click(screen.getByRole("button", { name: "Nur Basis" }));
    expect(
      screen.getByText("Für ein Essen, das nicht in KitchenOwl steht: nur die Beilage zählt."),
    ).toBeInTheDocument();
  });
});
