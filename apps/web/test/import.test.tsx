import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, renderApp, server } from "./helpers";

const DRAFT = `POST ${api}/import/draft`;
const CREATE = `POST ${api}/import/create`;
const LINKS = `GET ${api}/links`;
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
    { name: "Linsen", amount: "200 g", optional: false, isNewItem: false },
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

beforeEach(() => vi.stubGlobal("EventSource", undefined));
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
    const ingredients = within(screen.getByRole("list", { name: "Zutaten" })).getAllByRole("listitem");
    expect(ingredients[0]).toHaveTextContent("Linsen200 g");
    expect(ingredients[0]).not.toHaveTextContent("neu");
    expect(ingredients[1]).toHaveTextContent("Petersilieohne Mengeneuoptional");
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
