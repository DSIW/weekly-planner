import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, renderApp, server } from "./helpers";

const ME = `GET ${api}/me`;
const CURRENT = `GET ${api}/sessions/current`;
const DECK = `GET ${api}/sessions/s1/deck`;
const PASS = `POST ${api}/sessions/s1/passes`;
const PROPOSE = `POST ${api}/sessions/s1/proposals`;
const RECIPES = `GET ${api}/sessions/s1/recipes`;
const max = { id: "2", name: "Max" };
const signedIn = { [ME]: { status: 200, body: { member: max } } };

const card = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  minutes: 30,
  base: "pasta",
  diet: "vegetarian",
  needsTime: false,
  planAhead: false,
  isNew: false,
  ...over,
});
const session = {
  id: "s1",
  status: "open",
  startedBy: "2",
  days: [
    { date: "2026-11-02", status: "open" },
    { date: "2026-11-03", status: "open" },
  ],
  proposals: [],
};
const current = { [CURRENT]: { status: 200, body: { session } } };
const deckOf = (...cards: ReturnType<typeof card>[]) => ({ status: 200, body: { date: "2026-11-02", cards } });

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

/** Drags a card sideways the way a finger does: down, move, up. */
const drag = (el: HTMLElement, by: number) => {
  const at = (type: string, x: number) => fireEvent(el, new MouseEvent(type, { clientX: x, bubbles: true }));
  at("pointerdown", 200);
  at("pointermove", 200 + by / 2);
  at("pointermove", 200 + by);
  at("pointerup", 200 + by);
};

describe("the swipe deck", () => {
  it("shows the best card first with what helps to decide: time, base, diet, new badge, picture", async () => {
    server({
      ...signedIn,
      ...current,
      [DECK]: deckOf(card(1, "Kürbisrisotto", { base: "rice", isNew: true }), card(2, "Pasta")),
    });
    renderApp();
    const first = await screen.findByRole("article", { name: "Kürbisrisotto" });
    expect(first).toHaveTextContent("30 min");
    expect(first).toHaveTextContent("Reis");
    expect(first).toHaveTextContent("Vegetarisch");
    expect(first).toHaveTextContent("Neu");
    expect(first.querySelector("img")).toHaveAttribute("src", `${api}/recipes/1/photo`);
    expect(screen.queryByRole("article", { name: "Pasta" })).not.toBeInTheDocument(); // one card at a time
    expect(screen.getByRole("heading", { name: /Abendessen am .*2\.11\./ })).toBeInTheDocument();
  });

  it("shows the new badge only on new recipes", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Bekannt")) });
    renderApp();
    expect(await screen.findByRole("article", { name: "Bekannt" })).not.toHaveTextContent("Neu");
  });

  it("reminds to add a missing time and flags recipes that need a lead time", async () => {
    server({
      ...signedIn,
      ...current,
      [DECK]: deckOf(card(1, "Ohne Zeit", { minutes: null, needsTime: true })),
    });
    renderApp();
    expect(await screen.findByText(/Zeit fehlt: bitte in KitchenOwl eintragen/)).toBeInTheDocument();
  });

  it("flags a card that needs planning ahead", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Biga", { minutes: 1285, planAhead: true })) });
    renderApp();
    expect(await screen.findByRole("article", { name: "Biga" })).toHaveTextContent("21,4 h · Vorlauf nötig");
  });

  it("hides the picture when the recipe has none", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Ohne Bild")) });
    renderApp();
    const article = await screen.findByRole("article", { name: "Ohne Bild" });
    fireEvent.error(article.querySelector("img")!);
    await waitFor(() => expect(article.querySelector("img")).toBeNull());
  });

  it("proposes the card with the button, for the day the deck is for", async () => {
    const calls = server({
      ...signedIn,
      ...current,
      [DECK]: deckOf(card(1, "Pasta")),
      [PROPOSE]: { status: 201, body: { session } },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Vorschlagen" }));
    await waitFor(() => expect(calls.some((c) => c.key === PROPOSE)).toBe(true));
    expect(calls.find((c) => c.key === PROPOSE)?.body).toEqual({ date: "2026-11-02", recipeId: 1 });
  });

  it("passes with the button and shows the next card once the deck is refetched", async () => {
    let cards = [card(1, "Pasta"), card(2, "Curry")];
    const calls = server({
      ...signedIn,
      ...current,
      [DECK]: () => deckOf(...cards),
      [PASS]: () => {
        cards = cards.slice(1);
        return { status: 200, body: { session } };
      },
    });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Überspringen" }));
    expect(await screen.findByRole("article", { name: "Curry" })).toBeInTheDocument();
    expect(calls.find((c) => c.key === PASS)?.body).toEqual({ recipeId: 1 });
  });

  it("proposes on a swipe to the right and passes on a swipe to the left", async () => {
    const calls = server({
      ...signedIn,
      ...current,
      [DECK]: deckOf(card(1, "Pasta")),
      [PROPOSE]: { status: 201, body: { session } },
      [PASS]: { status: 200, body: { session } },
    });
    renderApp();
    const first = await screen.findByRole("article", { name: "Pasta" });
    drag(first, 160);
    await waitFor(() => expect(calls.some((c) => c.key === PROPOSE)).toBe(true));
    await waitFor(() => expect(first.querySelector(".stamp")).toBeNull()); // the card came back: nothing removed it
    drag(await screen.findByRole("article", { name: "Pasta" }), -160);
    await waitFor(() => expect(calls.some((c) => c.key === PASS)).toBe(true));
  });

  it("shows what the swipe would do while the card is dragged, and nothing at rest", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Pasta")) });
    renderApp();
    const el = await screen.findByRole("article", { name: "Pasta" });
    expect(el.querySelector(".stamp")).toBeNull();
    const at = (type: string, x: number) => fireEvent(el, new MouseEvent(type, { clientX: x, bubbles: true }));
    at("pointerdown", 200);
    at("pointermove", 300);
    expect(el.querySelector(".stamp-right")).toHaveTextContent("Vorschlagen");
    expect(el).toHaveClass("will-right");
    at("pointermove", 100);
    expect(el.querySelector(".stamp-left")).toHaveTextContent("Überspringen");
    expect(el).toHaveClass("will-left");
    at("pointermove", 150);
    expect(el).not.toHaveClass("will-left"); // not far enough yet to count
    at("pointerup", 150);
    expect(el.querySelector(".stamp")).toBeNull();
  });

  it("does nothing for a short drag", async () => {
    const calls = server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Pasta")) });
    renderApp();
    drag(await screen.findByRole("article", { name: "Pasta" }), 40);
    drag(screen.getByRole("article", { name: "Pasta" }), -40);
    await new Promise((resolve) => setTimeout(resolve, 100)); // a decision would send its request asynchronously
    expect(calls.some((c) => c.key === PROPOSE || c.key === PASS)).toBe(false);
  });

  it("says so when the deck is used up and points to the list", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf() });
    renderApp();
    expect(await screen.findByText(/Keine Vorschläge mehr/)).toBeInTheDocument();
  });

  it("switches to the searchable list and back", async () => {
    server({
      ...signedIn,
      ...current,
      [DECK]: deckOf(card(1, "Pasta")),
      [RECIPES]: { status: 200, body: { date: "2026-11-02", recipes: [card(1, "Pasta"), card(2, "Curry")] } },
    });
    renderApp();
    await screen.findByRole("article", { name: "Pasta" });
    await userEvent.click(screen.getByRole("button", { name: "Liste" }));
    expect(await screen.findByLabelText("Rezept suchen")).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Karten" }));
    expect(await screen.findByRole("article", { name: "Pasta" })).toBeInTheDocument();
  });

  it("follows the other member live: a dish they passed disappears from the deck", async () => {
    let cards = [card(1, "Pasta"), card(2, "Curry")];
    server({ ...signedIn, ...current, [DECK]: () => deckOf(...cards) });
    renderApp();
    await screen.findByRole("article", { name: "Pasta" });
    cards = [card(2, "Curry")]; // the other phone passed Pasta
    FakeEventSource.instances[0]!.emit("changed");
    expect(await screen.findByRole("article", { name: "Curry" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Pasta" })).not.toBeInTheDocument();
  });
});

describe("the card stack, pictures and tags", () => {
  it("shows a spinner while the picture loads and no spinner once it did", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Pasta")) });
    renderApp();
    const article = await screen.findByRole("article", { name: "Pasta" });
    expect(within(article).getByRole("status", { name: "Bild wird geladen" })).toBeInTheDocument();
    fireEvent.load(article.querySelector("img")!);
    await waitFor(() => expect(within(article).queryByRole("status")).not.toBeInTheDocument());
    expect(article.querySelector(".photo")).toHaveAttribute("data-state", "loaded");
  });

  it("shows a placeholder instead of a picture when the recipe has none, and no spinner", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Ohne Bild")) });
    renderApp();
    const article = await screen.findByRole("article", { name: "Ohne Bild" });
    fireEvent.error(article.querySelector("img")!);
    await waitFor(() => expect(article.querySelector(".photo-placeholder")).toHaveTextContent("🍽️"));
    expect(within(article).queryByRole("status")).not.toBeInTheDocument();
  });

  it("starts the next recipe with a spinner, never with the picture of the one before", async () => {
    let cards = [card(1, "Pasta"), card(2, "Curry")];
    server({
      ...signedIn,
      ...current,
      [DECK]: () => deckOf(...cards),
      [PASS]: () => {
        cards = cards.slice(1);
        return { status: 200, body: { session } };
      },
    });
    renderApp();
    const first = await screen.findByRole("article", { name: "Pasta" });
    fireEvent.load(first.querySelector("img")!);
    await userEvent.click(screen.getByRole("button", { name: "Überspringen" }));
    const next = await screen.findByRole("article", { name: "Curry" });
    expect(next.querySelector("img")).toHaveAttribute("src", `${api}/recipes/2/photo`);
    expect(next.querySelector(".photo")).toHaveAttribute("data-state", "loading");
    expect(within(next).getByRole("status")).toBeInTheDocument();
  });

  it("lets the next two cards wait visibly behind the top one, already loading their pictures", async () => {
    server({
      ...signedIn,
      ...current,
      [DECK]: deckOf(card(1, "Pasta"), card(2, "Curry"), card(3, "Risotto"), card(4, "Suppe")),
    });
    renderApp();
    await screen.findByRole("article", { name: "Pasta" });
    const behind = [...document.querySelectorAll(".deck-card.behind")];
    expect(behind.map((b) => b.querySelector("h3")?.textContent)).toEqual(["Curry", "Risotto"]);
    expect(behind.every((b) => b.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(behind[0]).toHaveClass("behind-1");
    expect(behind[1]).toHaveClass("behind-2");
    expect(behind[0]?.querySelector("img")).toHaveAttribute("src", `${api}/recipes/2/photo`);
    expect(screen.queryByRole("article", { name: "Curry" })).not.toBeInTheDocument(); // only the top one is a card
  });

  it("shows no card behind the last one", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Pasta")) });
    renderApp();
    await screen.findByRole("article", { name: "Pasta" });
    expect(document.querySelector(".deck-card.behind")).toBeNull();
  });

  it("shows KitchenOwl's tags with their emoji instead of the derived base and diet", async () => {
    server({
      ...signedIn,
      ...current,
      [DECK]: deckOf(card(1, "Pasta", { tags: ["🍝 Pasta", "🥬 Vegetarisch", "🧄 Knoblauch"] })),
    });
    renderApp();
    const article = await screen.findByRole("article", { name: "Pasta" });
    expect([...article.querySelectorAll(".badge")].map((b) => b.textContent)).toEqual([
      "🍝 Pasta",
      "🥬 Vegetarisch",
      "🧄 Knoblauch",
    ]);
  });

  it("flies a decided card off, and brings it back when the action failed", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Pasta")), [PROPOSE]: { status: 500, body: {} } });
    renderApp();
    const article = await screen.findByRole("article", { name: "Pasta" });
    drag(article, 160);
    expect(article.style.transform).toContain("translateX(700px)");
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
    await waitFor(() => expect(article.style.transform).toContain("translateX(0px)"));
  });

  it("does not take a second drag while the decided card is leaving", async () => {
    const calls = server({
      ...signedIn,
      ...current,
      [DECK]: deckOf(card(1, "Pasta")),
      [PROPOSE]: { status: 201, body: { session } },
      [PASS]: { status: 200, body: { session } },
    });
    renderApp();
    const article = await screen.findByRole("article", { name: "Pasta" });
    drag(article, 160);
    drag(article, -160);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((c) => c.key === PROPOSE || c.key === PASS).map((c) => c.key)).toEqual([PROPOSE]);
  });
});

describe("failed actions on the deck are visible", () => {
  it("passing", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Pasta")), [PASS]: { status: 500, body: {} } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Überspringen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("proposing", async () => {
    server({ ...signedIn, ...current, [DECK]: deckOf(card(1, "Pasta")), [PROPOSE]: { status: 500, body: {} } });
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Vorschlagen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nicht geklappt");
  });

  it("loading the deck", async () => {
    server({ ...signedIn, ...current, [DECK]: { status: 500, body: {} } });
    renderApp();
    expect(await screen.findByText(/Karten konnten nicht geladen werden/)).toBeInTheDocument();
  });
});
