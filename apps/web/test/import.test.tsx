import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetItemFont } from "../src/ItemIcon";
import { api, renderApp, server } from "./helpers";

const DRAFT = `POST ${api}/import/draft`;
const CREATE = `POST ${api}/import/create`;
const LINKS = `GET ${api}/links`;
const MATCH = `POST ${api}/import/match`;
const base = {
  [`GET ${api}/me`]: { status: 200, body: { member: { id: "2", name: "Max" } } },
  [`GET ${api}/sessions/current`]: { status: 200, body: { session: null } },
  [`GET ${api}/planned-dates`]: { status: 200, body: { dates: [] } },
  [`GET ${api}/meal-log?days=14`]: { status: 200, body: { entries: [] } },
};
const draft = {
  name: "Linsensuppe",
  subtitle: "Wärmt von innen",
  steps: ["Linsen waschen.", "Kochen."],
  ingredients: [
    { name: "Linsen", amount: "200 g", optional: false, isNewItem: false, icon: "onion" },
    { name: "Petersilie", amount: "", optional: true, isNewItem: true },
  ],
  mealType: "main",
  base: "other",
  diet: "vegan",
  tags: ["🍲 Suppe"],
  totalMinutes: 40,
  yields: 4,
  source: "https://example.org/linsen",
};

beforeEach(() => {
  vi.stubGlobal("EventSource", undefined);
  resetItemFont();
});
afterEach(() => vi.unstubAllGlobals());

const openImport = async () => {
  renderApp();
  await userEvent.click(await screen.findByRole("button", { name: "Import" }));
};
const paste = async (text: string) => {
  await userEvent.click(screen.getByRole("textbox", { name: /Link oder Rezepttext/ }));
  await userEvent.paste(text);
};

describe("recipe import", () => {
  it("reads a link, shows the draft for review, and creates it on confirmation", async () => {
    const calls = server({
      ...base,
      [DRAFT]: { status: 200, body: { draft } },
      [CREATE]: { status: 201, body: { recipeId: 173, draft } },
      [LINKS]: {
        status: 200,
        body: { links: { recipe: "https://ko.test/household/2/recipes/details/{id}", list: "x" } },
      },
    });
    await openImport();
    await paste("https://example.org/linsen");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));

    await screen.findByRole("heading", { name: "Rezept prüfen" });
    expect(calls.find((c) => c.key === DRAFT)?.body).toEqual({ address: "https://example.org/linsen" });
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Linsensuppe");
    const tiles = within(screen.getByRole("list", { name: "Zutaten" })).getAllByRole("listitem");
    expect(tiles).toHaveLength(2);
    expect(within(tiles[0]!).getByRole("textbox", { name: "Zutat 1" })).toHaveValue("Linsen");
    expect(within(tiles[0]!).getByRole("textbox", { name: "Menge 1" })).toHaveValue("200 g");
    expect(tiles[0]).not.toHaveTextContent("neu");
    expect(within(tiles[1]!).getByRole("textbox", { name: "Zutat 2" })).toHaveValue("Petersilie");
    expect(tiles[1]).toHaveTextContent("neu");
    expect(tiles[1]).toHaveTextContent("optional");
    expect(within(screen.getByRole("list", { name: "Schritte" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("list", { name: "Eigenschaften" })).toHaveTextContent(
      "HauptgerichtSonstigesVegan40 Min.4 Portionen🍲 Suppe",
    );
    expect(calls.some((c) => c.key === CREATE)).toBe(false); // nothing is created before the member says yes

    await userEvent.click(screen.getByRole("button", { name: "In KitchenOwl anlegen" }));
    expect(await screen.findByText(/„Linsensuppe“ ist jetzt in KitchenOwl/)).toBeInTheDocument();
    expect(calls.find((c) => c.key === CREATE)?.body).toEqual({ draft });
    expect(await screen.findByRole("link", { name: "In KitchenOwl öffnen" })).toHaveAttribute(
      "href",
      "https://ko.test/household/2/recipes/details/173",
    );
  });

  it("sends pasted text as text, not as a link", async () => {
    const calls = server({ ...base, [DRAFT]: { status: 200, body: { draft } } });
    await openImport();
    await paste("Linsensuppe: 200 g Linsen kochen.");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    await screen.findByRole("heading", { name: "Rezept prüfen" });
    expect(calls.find((c) => c.key === DRAFT)?.body).toEqual({ text: "Linsensuppe: 200 g Linsen kochen." });
  });

  it("needs something to read before the button works", async () => {
    server(base);
    await openImport();
    expect(screen.getByRole("button", { name: "Rezept lesen" })).toBeDisabled();
    await paste("   ");
    expect(screen.getByRole("button", { name: "Rezept lesen" })).toBeDisabled();
  });

  it.each([
    ["address_not_public", "Diese Adresse darf nicht gelesen werden."],
    ["unreachable", "Die Seite war nicht erreichbar."],
    ["not_a_recipe", "Darin wurde kein Rezept gefunden."],
    ["not_configured", "Der Import ist auf dem Server noch nicht eingerichtet."],
    ["rate_limited", "Zu viele Versuche. Bitte in einer Stunde noch einmal."],
    ["something_new", "Das hat nicht geklappt. Bitte später noch einmal versuchen."],
  ])("says what went wrong: %s", async (error, message) => {
    server({ ...base, [DRAFT]: { status: 422, body: { error } } });
    await openImport();
    await paste("https://example.org/x");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Rezept lesen" })).toBeEnabled();
  });

  it("lets a member take an ingredient out, rename the recipe or throw the draft away", async () => {
    const calls = server({
      ...base,
      [DRAFT]: { status: 200, body: { draft } },
      [CREATE]: { status: 201, body: { recipeId: 1, draft } },
    });
    await openImport();
    await paste("Text");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    await screen.findByRole("heading", { name: "Rezept prüfen" });
    await userEvent.click(screen.getByRole("button", { name: "Petersilie entfernen" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    expect(screen.getByRole("button", { name: "In KitchenOwl anlegen" })).toBeDisabled();
    await userEvent.type(name, "Meine Suppe");
    await userEvent.click(screen.getByRole("button", { name: "In KitchenOwl anlegen" }));
    await waitFor(() => expect(calls.some((c) => c.key === CREATE)).toBe(true));
    expect(calls.find((c) => c.key === CREATE)?.body).toEqual({
      draft: { ...draft, name: "Meine Suppe", ingredients: [draft.ingredients[0]] },
    });
  });

  it("says why creating failed, keeps the draft, and can throw it away", async () => {
    server({
      ...base,
      [DRAFT]: { status: 200, body: { draft } },
      [CREATE]: { status: 502, body: { error: "kitchenowl_unavailable" } },
    });
    await openImport();
    await paste("Text");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    await userEvent.click(await screen.findByRole("button", { name: "In KitchenOwl anlegen" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("KitchenOwl ist gerade nicht erreichbar.");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Linsensuppe");
    await userEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    expect(screen.getByRole("button", { name: "Rezept lesen" })).toBeInTheDocument();
  });

  it("starts over after a recipe was created", async () => {
    server({
      ...base,
      [DRAFT]: { status: 200, body: { draft } },
      [CREATE]: { status: 201, body: { recipeId: 1, draft } },
    });
    await openImport();
    await paste("Text");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    await userEvent.click(await screen.findByRole("button", { name: "In KitchenOwl anlegen" }));
    await userEvent.click(await screen.findByRole("button", { name: "Noch ein Rezept importieren" }));
    expect(screen.getByRole("textbox", { name: /Link oder Rezepttext/ })).toHaveValue("");
  });
});

describe("renaming an ingredient in the review", () => {
  const read = async (routes: Parameters<typeof server>[0]) => {
    const calls = server({ ...base, [DRAFT]: { status: 200, body: { draft } }, ...routes });
    await openImport();
    await paste("Text");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    await screen.findByRole("heading", { name: "Rezept prüfen" });
    return calls;
  };

  it("looks the new name up: one of the household's items takes its name and icon and loses the 'neu' mark", async () => {
    const calls = await read({
      [MATCH]: {
        status: 200,
        body: { items: [{ written: "Petersilie frisch", name: "Petersilie", isNewItem: false, icon: "parsley" }] },
      },
    });
    const name = screen.getByRole("textbox", { name: "Zutat 2" });
    expect(screen.getAllByText("neu")).toHaveLength(1);
    await userEvent.clear(name);
    await userEvent.type(name, "Petersilie frisch");
    await userEvent.tab();
    await waitFor(() => expect(screen.queryByText("neu")).not.toBeInTheDocument());
    expect(calls.find((c) => c.key === MATCH)?.body).toEqual({ names: ["Petersilie frisch"] });
    expect(screen.getByRole("textbox", { name: "Zutat 2" })).toHaveValue("Petersilie");
  });

  it("keeps a name that matches nothing as a new item, and sends the typed name and amount on", async () => {
    const calls = await read({
      [MATCH]: { status: 200, body: { items: [{ written: "Safran", name: "Safran", isNewItem: true }] } },
      [CREATE]: { status: 201, body: { recipeId: 1, draft } },
    });
    const name = screen.getByRole("textbox", { name: "Zutat 2" });
    await userEvent.clear(name);
    await userEvent.type(name, "Safran");
    await userEvent.tab();
    const amount = screen.getByRole("textbox", { name: "Menge 2" });
    await userEvent.type(amount, "1 Prise");
    await waitFor(() => expect(calls.some((c) => c.key === MATCH)).toBe(true));
    expect(screen.getAllByText("neu")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "In KitchenOwl anlegen" }));
    await waitFor(() => expect(calls.some((c) => c.key === CREATE)).toBe(true));
    const sent = calls.find((c) => c.key === CREATE)?.body as { draft: { ingredients: unknown[] } };
    expect(sent.draft.ingredients[1]).toMatchObject({ name: "Safran", amount: "1 Prise", isNewItem: true });
  });

  it("does not look up an empty name, and ignores an answer for a name that was changed again", async () => {
    const calls = await read({
      [MATCH]: { status: 200, body: { items: [{ written: "Safran", name: "Safran", isNewItem: true }] } },
    });
    const name = screen.getByRole("textbox", { name: "Zutat 2" });
    await userEvent.clear(name);
    await userEvent.tab();
    expect(calls.some((c) => c.key === MATCH)).toBe(false);
  });

  it("draws the icon of a known ingredient from KitchenOwl's icon font", async () => {
    vi.stubGlobal(
      "FontFace",
      class {
        constructor(
          readonly family: string,
          readonly source: string,
        ) {}
        load() {
          return Promise.resolve(this);
        }
      },
    );
    Object.defineProperty(document, "fonts", { value: { add: vi.fn() }, configurable: true });
    await read({});
    const tiles = within(screen.getByRole("list", { name: "Zutaten" })).getAllByRole("listitem");
    await waitFor(() => expect(tiles[0]?.querySelector(".item-icon")).toHaveAttribute("data-icon", "onion"));
    expect(tiles[1]?.querySelector(".item-icon")).toHaveClass("letter"); // a new item has no icon yet
  });
});
