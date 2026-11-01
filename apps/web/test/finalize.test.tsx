import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ITEM_ICON_CODEPOINTS } from "../src/item-icon-codepoints";
import { resetItemFont } from "../src/ItemIcon";
import { api, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const PREVIEW = `GET ${api}/sessions/s1/finalize-preview`;
const FINALIZE = `POST ${api}/sessions/s1/finalize`;
const RETRY = `POST ${api}/sessions/s1/export/retry`;
const CLOSE = `POST ${api}/sessions/s1/close`;
/** The shopping list is the third step: it is reached from the plan with "Weiter". */
const toShoppingList = async () =>
  userEvent.click(await screen.findByRole("button", { name: "Weiter zur Einkaufsliste" }));
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
  reminderSent: false,
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
  resetItemFont();
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
    await toShoppingList();
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

  it("shows the ingredients as a grid of tiles with an icon, name and amount; the first letter stands in without the font", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: {
        status: 200,
        body: { ...preview, items: [{ ...preview.items[0], icon: "onion", staple: false }, preview.items[1]] },
      },
    });
    renderApp();
    await toShoppingList();
    const list = await screen.findByRole("list", { name: "Einkaufsliste" });
    const [onion, salt] = within(list).getAllByRole("listitem");
    expect(onion).toHaveTextContent("ZZwiebel3 Stück");
    expect(salt).toHaveTextContent("SSalz");
    expect(within(onion!).getByRole("checkbox", { name: /Zwiebel/ })).toBeChecked();
  });

  it("draws the icon from KitchenOwl's own icon font by the item's key", async () => {
    const loaded: string[] = [];
    vi.stubGlobal(
      "FontFace",
      class {
        constructor(
          readonly family: string,
          source: string,
        ) {
          loaded.push(`${family} ${source}`);
        }
        load() {
          return Promise.resolve(this);
        }
      },
    );
    Object.defineProperty(document, "fonts", { value: { add: vi.fn() }, configurable: true });
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: {
        status: 200,
        body: {
          ...preview,
          items: [
            { ...preview.items[0], icon: "onion" },
            { ...preview.items[1], icon: "no_such_icon" },
          ],
        },
      },
    });
    renderApp();
    await toShoppingList();
    const list = await screen.findByRole("list", { name: "Einkaufsliste" });
    await waitFor(() => expect(list.querySelector('[data-icon="onion"]')).not.toBeNull());
    expect(list.querySelector('[data-icon="onion"]')?.textContent).toBe(
      String.fromCodePoint(ITEM_ICON_CODEPOINTS.onion!),
    );
    expect(loaded).toEqual([`KitchenOwlItems url(${api}/item-icons)`]);
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("SSalz"); // an unknown key falls back
    Reflect.deleteProperty(document, "fonts");
  });

  it("starts with salt, pepper, oil and water left off the list, and a tap puts one back", async () => {
    const calls = server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: {
        status: 200,
        body: { ...preview, items: [preview.items[0], { ...preview.items[1], staple: true }] },
      },
      [FINALIZE]: { status: 200, body: { session: finalized(exportOf({ complete: true })) } },
    });
    renderApp();
    await toShoppingList();
    expect(await screen.findByRole("checkbox", { name: /Salz/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Zwiebel/ })).toBeChecked();
    expect(screen.getByText(/Salz, Pfeffer, Öl und Wasser sind schon abgewählt/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Einkaufsliste füllen" }));
    expect(calls.find((c) => c.key === FINALIZE)?.body).toEqual({ skip: ["Salz"] });
  });

  it("puts a staple back on the list when its tile is tapped", async () => {
    const calls = server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: {
        status: 200,
        body: { ...preview, items: [preview.items[0], { ...preview.items[1], staple: true }] },
      },
      [FINALIZE]: { status: 200, body: { session: finalized(exportOf({ complete: true })) } },
    });
    renderApp();
    await toShoppingList();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Salz/ }));
    expect(screen.getByRole("checkbox", { name: /Salz/ })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Einkaufsliste füllen" }));
    expect(calls.find((c) => c.key === FINALIZE)?.body).toBeUndefined();
  });

  it("goes back to the dishes, and shows the agreed dishes with their pictures above the list", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: { status: 200, body: preview },
    });
    renderApp();
    await toShoppingList();
    const dishes = await screen.findByRole("list", { name: "Gerichte" });
    expect(dishes).toHaveTextContent("Mo");
    expect(dishes).toHaveTextContent("Pasta");
    expect(dishes.querySelector(".thumb img")).toHaveAttribute("src", `${api}/recipes/1/photo`);
    await userEvent.click(screen.getByRole("button", { name: "Zurück zu den Gerichten" }));
    expect(await screen.findByRole("heading", { name: "Planung" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Weiter zur Einkaufsliste" })).toBeEnabled();
  });

  it("sends only what is not in stock: a deselected ingredient stays off the list", async () => {
    const calls = server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: { status: 200, body: preview },
      [FINALIZE]: { status: 200, body: { session: finalized(exportOf({ complete: true })) } },
    });
    renderApp();
    await toShoppingList();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Zwiebel/ }));
    expect(screen.getByRole("checkbox", { name: /Zwiebel/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Einkaufsliste füllen" }));
    expect(calls.find((c) => c.key === FINALIZE)?.body).toEqual({ skip: ["Zwiebel"] });
  });

  it("brings an ingredient back when its tile is tapped again, and sends no body when nothing was left off", async () => {
    const calls = server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: { status: 200, body: preview },
      [FINALIZE]: { status: 200, body: { session: finalized(exportOf({ complete: true })) } },
    });
    renderApp();
    await toShoppingList();
    const onion = await screen.findByRole("checkbox", { name: /Zwiebel/ });
    await userEvent.click(onion);
    await userEvent.click(onion);
    expect(onion).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Einkaufsliste füllen" }));
    expect(calls.find((c) => c.key === FINALIZE)?.body).toBeUndefined();
  });

  it("stops asking to check a line that was deselected", async () => {
    server({
      ...signedIn,
      [CURRENT]: { status: 200, body: { session: session() } },
      [PREVIEW]: { status: 200, body: preview },
    });
    renderApp();
    await toShoppingList();
    await screen.findByText(/Eine Menge konnte nicht gelesen werden/);
    await userEvent.click(screen.getByRole("checkbox", { name: /Salz/ }));
    expect(screen.queryByText(/Eine Menge konnte nicht gelesen werden/)).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Weiter zur Einkaufsliste" })).toBeDisabled();
    expect(screen.getByText("Mindestens ein Tag braucht ein Gericht.")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Weiter zur Einkaufsliste" })).toBeDisabled();
    expect(screen.getByText("Erst müssen alle Vorschläge beantwortet oder zurückgezogen sein.")).toBeInTheDocument();
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
    await toShoppingList();
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
    await toShoppingList();
    await userEvent.click(await screen.findByRole("button", { name: "Einkaufsliste füllen" }));
    expect(await screen.findByRole("heading", { name: "Eintragen in KitchenOwl" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });
});

describe("the steps of planning", () => {
  const now = () => screen.getByRole("list", { name: "Schritte der Planung" }).querySelector('[aria-current="step"]');

  it("name where the household is: days, then dishes, then the shopping list, and the list again once finalized", async () => {
    let current: unknown = null;
    server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [PREVIEW]: { status: 200, body: preview },
    });
    const view = renderApp();
    await screen.findByRole("button", { name: "Planung starten" });
    expect(now()).toHaveTextContent("Tage");
    view.unmount();

    current = session();
    const second = renderApp();
    await toShoppingList().catch(() => undefined);
    await screen.findByRole("button", { name: "Einkaufsliste füllen" });
    expect(now()).toHaveTextContent("Einkaufsliste");
    await userEvent.click(screen.getByRole("button", { name: "Zurück zu den Gerichten" }));
    expect(now()).toHaveTextContent("Gerichte");
    second.unmount();

    current = finalized(exportOf({ failure: "refused" }));
    renderApp();
    await screen.findByRole("heading", { name: "Eintragen in KitchenOwl" });
    expect(now()).toHaveTextContent("Einkaufsliste");
  });

  it("shows the dishes step, not the list, while a vote is open", async () => {
    let current: unknown = session();
    server({
      ...signedIn,
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [PREVIEW]: { status: 200, body: preview },
    });
    const view = renderApp();
    await toShoppingList();
    await screen.findByRole("button", { name: "Einkaufsliste füllen" });
    view.unmount();
    current = session({ proposals: [proposal("pending")] });
    renderApp();
    await screen.findByRole("heading", { name: /Vorschlag für/ });
    expect(now()).toHaveTextContent("Gerichte");
    expect(screen.queryByRole("button", { name: "Einkaufsliste füllen" })).not.toBeInTheDocument();
  });
});

describe("the reminder on the board", () => {
  const withReminder = (over: Record<string, unknown> = {}) => ({
    ...signedIn,
    [CURRENT]: { status: 200, body: { session: session({ reminderSent: true, ...over }) } },
    [PREVIEW]: { status: 200, body: preview },
  });

  it("repeats the reminder for phones that did not get a notification, while the plan is open", async () => {
    server(withReminder());
    renderApp();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Erinnerung: Ihr habt Tage geplant, aber die Einkaufsliste ist noch nicht gefüllt.",
    );
  });

  it("is not there before the reminder went out", async () => {
    server(withReminder({ reminderSent: false }));
    renderApp();
    await screen.findByRole("button", { name: "Weiter zur Einkaufsliste" });
    expect(screen.queryByText(/Erinnerung/)).not.toBeInTheDocument();
  });

  it("is not there once nothing is planned any more", async () => {
    server(
      withReminder({
        days: [
          { date: "2026-11-02", status: "open" },
          { date: "2026-11-03", status: "open" },
        ],
      }),
    );
    renderApp();
    await screen.findByRole("heading", { name: "Planung" });
    expect(screen.queryByText(/Erinnerung/)).not.toBeInTheDocument();
  });

  it("is gone once the plan is finalized", async () => {
    server({
      ...signedIn,
      [CURRENT]: {
        status: 200,
        body: { session: { ...finalized(exportOf({ failure: "refused" })), reminderSent: true } },
      },
    });
    renderApp();
    await screen.findByText(/Planer/);
    expect(screen.queryByText(/Erinnerung/)).not.toBeInTheDocument();
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

  it("also asks before resending when the list was still being sent and nothing reported a failure (the server stopped)", async () => {
    const crashed = exportOf({
      list: { status: "sending", items: preview.items },
      days: [{ date: "2026-11-02", recipeName: "Pasta", status: "done" }],
    });
    server({ ...signedIn, [CURRENT]: { status: 200, body: { session: finalized(crashed) } } });
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent("unklar, ob der Schritt angekommen ist");
    expect(screen.getByRole("button", { name: "Trotzdem erneut senden" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Neu wählen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Doch kochen" })).not.toBeInTheDocument();
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
    await toShoppingList();
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
    await toShoppingList();
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
    await toShoppingList();
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
