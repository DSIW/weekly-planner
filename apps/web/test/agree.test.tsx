import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const RECIPES = `GET ${api}/sessions/s1/recipes`;
const PROPOSE = `POST ${api}/sessions/s1/proposals`;
const ACCEPT = `POST ${api}/sessions/s1/proposals/p1/accept`;
const VETO = `POST ${api}/sessions/s1/proposals/p1/veto`;
const WITHDRAW = `POST ${api}/sessions/s1/proposals/p1/withdraw`;
const REFRESH = `POST ${api}/recipes/refresh`;
const DECK = `GET ${api}/sessions/s1/deck`;
const max = { id: "2", name: "Max" };
const ac = { id: "3", name: "AC" };
const as = (member: typeof max) => ({ [ME]: { status: 200, body: { member } } });

const recipe = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  minutes: 30,
  base: "pasta",
  diet: "vegetarian",
  needsTime: false,
  planAhead: false,
  ...over,
});
const pasta = recipe(1, "Pasta");
const curry = recipe(2, "Curry", { minutes: null, needsTime: true });

const day = (date: string, status = "open", planned?: ReturnType<typeof recipe>) => ({
  date,
  status,
  ...(planned ? { recipe: planned } : {}),
});
const session = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  status: "open",
  startedBy: "2",
  days: [day("2026-11-02"), day("2026-11-03")],
  proposals: [],
  ...over,
});
const proposal = (status = "pending", proposedBy = "2") => ({
  id: "p1",
  date: "2026-11-02",
  recipe: pasta,
  proposedBy,
  status,
});
const list = { status: 200, body: { date: "2026-11-02", recipes: [pasta, curry] } };
const card = (r: ReturnType<typeof recipe>, isNew = false) => ({ ...r, isNew });
const deckOf = (date: string, ...cards: ReturnType<typeof card>[]) => ({ status: 200, body: { date, cards } });
const showList = async () => userEvent.click(await screen.findByRole("button", { name: "Liste" }));

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
});
afterEach(() => vi.unstubAllGlobals());

describe("choosing a dinner for the next open day", () => {
  it("lists the eligible recipes for that day, flags a missing time, and filters by the search", async () => {
    server({ ...as(max), [CURRENT]: { status: 200, body: { session: session() } }, [RECIPES]: list });
    renderApp();
    await showList();
    expect(await screen.findByRole("heading", { name: /Abendessen am .*2\.11\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pasta.*30 min/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Curry.*Zeit fehlt/ })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Rezept suchen"), "cur");
    expect(screen.queryByRole("button", { name: /Pasta/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Curry/ })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Rezept suchen"));
    await userEvent.type(screen.getByLabelText("Rezept suchen"), "xyz");
    expect(screen.getByText("Kein Rezept gefunden.")).toBeInTheDocument();
  });

  it("shows long recipes in hours with a 'plan ahead' badge, in the order the server gives", async () => {
    const biga = recipe(3, "Pizza Biga", { minutes: 1285, planAhead: true });
    server({
      ...as(max),
      [CURRENT]: { status: 200, body: { session: session({ days: [day("2026-11-07"), day("2026-11-08")] }) } },
      [RECIPES]: { status: 200, body: { date: "2026-11-07", recipes: [pasta, biga] } },
    });
    renderApp();
    await showList();
    const bigaButton = await screen.findByRole("button", { name: /Pizza Biga/ });
    expect(bigaButton).toHaveTextContent("21,4 h");
    expect(bigaButton).toHaveTextContent("Vorlauf nötig");
    expect(screen.getByRole("button", { name: /Pasta/ })).not.toHaveTextContent("Vorlauf");
    const order = screen.getAllByRole("button", { name: /Pasta|Pizza Biga/ }).map((b) => b.textContent);
    expect(order[0]).toContain("Pasta");
    expect(order[1]).toContain("Pizza Biga");
  });

  it("proposes the picked recipe for that day and then waits for the other member", async () => {
    let current = session();
    const calls = server({
      ...as(max),
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [RECIPES]: list,
      [PROPOSE]: () => {
        current = session({ proposals: [proposal()] });
        return { status: 201, body: { session: current } };
      },
    });
    renderApp();
    await showList();
    await userEvent.click(await screen.findByRole("button", { name: /Pasta/ }));
    expect(await screen.findByText(/Warte auf die Antwort/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === PROPOSE)?.body).toEqual({ date: "2026-11-02", recipeId: 1 });
    expect(screen.queryByRole("button", { name: "Passt" })).not.toBeInTheDocument();
  });

  it("shows the proposal as a card with the recipe's picture and tags, for the one who decides and the one who waits", async () => {
    const withTags = { ...pasta, tags: ["🍝 Pasta", "🥬 Vegetarisch"] };
    for (const [member, role] of [
      [ac, "article"],
      [max, null],
    ] as const) {
      server({
        ...as(member),
        [CURRENT]: { status: 200, body: { session: session({ proposals: [{ ...proposal(), recipe: withTags }] }) } },
      });
      const view = renderApp();
      const name = await screen.findByRole("heading", { name: "Pasta" });
      const card = role ? screen.getByRole(role, { name: "Pasta" }) : name.closest(".proposal-card")!;
      expect(card.querySelector("img")).toHaveAttribute("src", `${api}/recipes/1/photo`);
      expect(within(card as HTMLElement).getByRole("status", { name: "Bild wird geladen" })).toBeInTheDocument();
      expect([...card.querySelectorAll(".badge")].map((b) => b.textContent)).toEqual(["🍝 Pasta", "🥬 Vegetarisch"]);
      view.unmount();
    }
  });

  it("lets the proposer take the proposal back without waiting for the answer", async () => {
    let current = session({ proposals: [proposal()] });
    const calls = server({
      ...as(max), // the proposal in these fixtures was made by Max
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [DECK]: { status: 200, body: { date: "2026-11-02", cards: [] } },
      [WITHDRAW]: () => {
        current = session({ proposals: [proposal("withdrawn")] });
        return { status: 200, body: { session: current } };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Zurückziehen" }));
    await waitFor(() => expect(calls.some((c) => c.key === WITHDRAW)).toBe(true));
    expect(await screen.findByText(/Keine Vorschläge mehr/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zurückziehen" })).not.toBeInTheDocument();
  });

  it("does not offer to take back a proposal that is not yours", async () => {
    server({
      ...as(ac),
      [CURRENT]: { status: 200, body: { session: session({ proposals: [proposal()] }) } },
    });
    renderApp();
    await screen.findByRole("button", { name: "Passt" });
    expect(screen.queryByRole("button", { name: "Zurückziehen" })).not.toBeInTheDocument();
  });

  it("tells the proposer when taking back failed", async () => {
    server({
      ...as(max),
      [CURRENT]: { status: 200, body: { session: session({ proposals: [proposal()] }) } },
      [WITHDRAW]: { status: 409, body: { error: "proposal_not_pending" } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Zurückziehen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Darüber ist schon entschieden.");
  });

  it("explains that the other member was faster and shows their proposal to decide on", async () => {
    let current = session();
    server({
      ...as(max),
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [RECIPES]: list,
      [PROPOSE]: () => {
        current = session({ proposals: [proposal("pending", "3")] });
        return { status: 409, body: { error: "proposal_already_pending" } };
      },
    });
    renderApp();
    await showList();
    await userEvent.click(await screen.findByRole("button", { name: /Curry/ }));
    expect(await screen.findByRole("button", { name: "Passt" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pasta" })).toBeInTheDocument();
  });

  it("refreshes the recipes from KitchenOwl and shows what is new", async () => {
    let recipes = [pasta];
    const calls = server({
      ...as(max),
      [CURRENT]: { status: 200, body: { session: session() } },
      [RECIPES]: () => ({ status: 200, body: { date: "2026-11-02", recipes } }),
      [REFRESH]: () => {
        recipes = [pasta, curry];
        return { status: 204 };
      },
    });
    renderApp();
    await showList();
    await screen.findByRole("button", { name: /Pasta/ });
    expect(screen.queryByRole("button", { name: /Curry/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rezepte neu laden" }));
    expect(await screen.findByRole("button", { name: /Curry/ })).toBeInTheDocument();
    expect(calls.some((c) => c.key === REFRESH)).toBe(true);
  });
});

describe("deciding on the other member's proposal", () => {
  const pendingFromAc = { status: 200, body: { session: session({ proposals: [proposal("pending", "3")] }) } };

  it("shows the proposal with Passt and Nein, and accepting plans the day", async () => {
    let current = pendingFromAc.body.session;
    const calls = server({
      ...as(max),
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [ACCEPT]: () => {
        current = session({
          days: [day("2026-11-02", "planned", pasta), day("2026-11-03")],
          proposals: [proposal("accepted", "3")],
        });
        return { status: 200, body: { session: current } };
      },
      [DECK]: deckOf("2026-11-03", card(curry)),
    });
    renderApp();
    expect(await screen.findByRole("heading", { name: /Vorschlag für .*2\.11\./ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Passt" }));
    expect(await screen.findByRole("heading", { name: /Abendessen am .*3\.11\./ })).toBeInTheDocument();
    const days = screen.getAllByRole("listitem");
    expect(days[0]).toHaveTextContent(/2\.11\..*Pasta/);
    expect(calls.some((c) => c.key === ACCEPT)).toBe(true);
  });

  it("accepts on a swipe to the right and vetoes on a swipe to the left, and says what each does", async () => {
    const calls = server({
      ...as(max),
      [CURRENT]: pendingFromAc,
      [ACCEPT]: pendingFromAc,
      [VETO]: pendingFromAc,
    });
    renderApp();
    const el = await screen.findByRole("article", { name: "Pasta" });
    const at = (type: string, x: number) => fireEvent(el, new MouseEvent(type, { clientX: x, bubbles: true }));
    at("pointerdown", 200);
    at("pointermove", 320);
    expect(el.querySelector(".stamp-right")).toHaveTextContent("Passt");
    at("pointerup", 320);
    await waitFor(() => expect(calls.some((c) => c.key === ACCEPT)).toBe(true));
    await waitFor(() => expect(el.querySelector(".stamp")).toBeNull()); // nothing changed: the card is back
    at("pointerdown", 200);
    at("pointermove", 80);
    expect(el.querySelector(".stamp-left")).toHaveTextContent("Nein");
    at("pointerup", 80);
    await waitFor(() => expect(calls.some((c) => c.key === VETO)).toBe(true));
  });

  it("does not let the proposer swipe on their own proposal", async () => {
    const calls = server({
      ...as(max),
      [CURRENT]: { status: 200, body: { session: session({ proposals: [proposal("pending", "2")] }) } },
    });
    renderApp();
    const el = await screen.findByRole("heading", { name: "Pasta" });
    fireEvent(el, new MouseEvent("pointerdown", { clientX: 200, bubbles: true }));
    fireEvent(el, new MouseEvent("pointermove", { clientX: 400, bubbles: true }));
    fireEvent(el, new MouseEvent("pointerup", { clientX: 400, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls.some((c) => c.key === ACCEPT || c.key === VETO)).toBe(false);
    expect(document.querySelector(".stamp")).toBeNull();
  });

  it("shows the plan-ahead hint on a proposal too, so the member who decides knows", async () => {
    const biga = recipe(3, "Pizza Biga", { minutes: 1285, planAhead: true });
    server({
      ...as(max),
      [CURRENT]: {
        status: 200,
        body: { session: session({ proposals: [{ ...proposal("pending", "3"), recipe: biga }] }) },
      },
    });
    renderApp();
    expect(await screen.findByText(/21,4 h/)).toBeInTheDocument();
    expect(screen.getByText(/Vorlauf nötig/)).toBeInTheDocument();
  });

  it("vetoing sends the veto and offers the day again", async () => {
    let current = pendingFromAc.body.session;
    const calls = server({
      ...as(max),
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [VETO]: () => {
        current = session({ proposals: [proposal("vetoed", "3")] });
        return { status: 200, body: { session: current } };
      },
      [DECK]: deckOf("2026-11-02", card(curry)),
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Nein" }));
    expect(await screen.findByRole("heading", { name: /Abendessen am .*2\.11\./ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pasta" })).not.toBeInTheDocument();
    expect(calls.some((c) => c.key === VETO)).toBe(true);
  });

  it("follows live: the other phone's proposal appears without a reload, and its decision too", async () => {
    let current: unknown = session();
    server({
      ...as(ac),
      [CURRENT]: () => ({ status: 200, body: { session: current } }),
      [DECK]: deckOf("2026-11-02", card(pasta)),
    });
    renderApp();
    await screen.findByRole("heading", { name: /Abendessen am/ });
    current = session({ proposals: [proposal("pending", "2")] }); // Max proposed on the other phone
    FakeEventSource.instances[0]!.emit("changed");
    expect(await screen.findByRole("button", { name: "Passt" })).toBeInTheDocument();
    current = session({ proposals: [proposal("vetoed", "2")] });
    FakeEventSource.instances[0]!.emit("changed");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Passt" })).not.toBeInTheDocument());
  });

  it("says when the proposal was already decided", async () => {
    server({
      ...as(max),
      [CURRENT]: pendingFromAc,
      [ACCEPT]: { status: 409, body: { error: "proposal_not_pending" } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Passt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Darüber ist schon entschieden.");
  });
});

describe("when every day is planned", () => {
  it("says so instead of offering recipes", async () => {
    server({
      ...as(max),
      [CURRENT]: {
        status: 200,
        body: {
          session: session({ days: [day("2026-11-02", "planned", pasta), day("2026-11-03", "planned", curry)] }),
        },
      },
    });
    renderApp();
    expect(await screen.findByText("Alle Tage sind geplant.")).toBeInTheDocument();
    expect(within(screen.getAllByRole("listitem")[1]!).getByText("Curry")).toBeInTheDocument();
  });
});

// Every action says so when it fails (see planning.test.tsx for the earlier ones).
describe("failed actions in the agreeing flow are visible", () => {
  it("proposing", async () => {
    server({
      ...as(max),
      [CURRENT]: { status: 200, body: { session: session() } },
      [RECIPES]: list,
      [PROPOSE]: { status: 500, body: {} },
    });
    renderApp();
    await showList();
    await userEvent.click(await screen.findByRole("button", { name: /Pasta/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("accepting", async () => {
    server({
      ...as(max),
      [CURRENT]: { status: 200, body: { session: session({ proposals: [proposal("pending", "3")] }) } },
      [ACCEPT]: { status: 500, body: {} },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Passt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("vetoing", async () => {
    server({
      ...as(max),
      [CURRENT]: { status: 200, body: { session: session({ proposals: [proposal("pending", "3")] }) } },
      [VETO]: { status: 500, body: {} },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Nein" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("reloading the recipes", async () => {
    server({
      ...as(max),
      [CURRENT]: { status: 200, body: { session: session() } },
      [RECIPES]: list,
      [REFRESH]: { status: 502, body: {} },
    });
    renderApp();
    await showList();
    await userEvent.click(await screen.findByRole("button", { name: "Rezepte neu laden" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("loading the recipes", async () => {
    server({
      ...as(max),
      [CURRENT]: { status: 200, body: { session: session() } },
      [RECIPES]: { status: 500, body: {} },
    });
    renderApp();
    await showList();
    expect(await screen.findByText(/Rezepte konnten nicht geladen werden/)).toBeInTheDocument();
  });
});
