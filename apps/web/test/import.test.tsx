import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetItemFont } from "../src/ItemIcon";
import { api, renderApp, server } from "./helpers";

const DRAFT = `POST ${api}/import/draft`;
const CREATE = `POST ${api}/import/create`;
const LINKS = `GET ${api}/links`;
const MATCH = `POST ${api}/import/match`;
const MATCH_TAGS = `POST ${api}/import/match-tags`;
const base = {
  [`GET ${api}/me`]: { status: 200, body: { member: { id: "2", name: "Max" } } },
  [`GET ${api}/sessions/current`]: { status: 200, body: { session: null } },
  [`GET ${api}/planned-dates`]: { status: 200, body: { dates: [] } },
  [`GET ${api}/meal-log?days=14`]: { status: 200, body: { entries: [] } },
  [`GET ${api}/ideas`]: { status: 200, body: { ideas: [] } },
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
  await userEvent.click(await screen.findByRole("button", { name: "Ideen" }));
};
const paste = async (text: string) => {
  await userEvent.click(await screen.findByRole("textbox", { name: "Neue Idee" }));
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
    // Meal type, base and diet carry the emoji of the household's tags; time and portions are fields, not tags.
    expect(screen.getByRole("combobox", { name: "Art" })).toHaveDisplayValue("🍽️ Hauptgericht");
    expect(screen.getByRole("combobox", { name: "Basis" })).toHaveDisplayValue("Sonstiges");
    expect(screen.getByRole("combobox", { name: "Ernährung" })).toHaveDisplayValue("🌱 Vegan");
    expect(screen.getByRole("spinbutton", { name: "Zeit (Min.)" })).toHaveValue(40);
    expect(screen.getByRole("spinbutton", { name: "Portionen" })).toHaveValue(4);
    const tags = within(screen.getByRole("list", { name: "Tags" })).getAllByRole("listitem");
    expect(tags).toHaveLength(1);
    expect(within(tags[0]!).getByRole("textbox", { name: "Tag 1" })).toHaveValue("🍲 Suppe");
    expect(screen.getByText("Quelle: https://example.org/linsen")).toBeInTheDocument();
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
    await screen.findByRole("textbox", { name: "Neue Idee" });
    expect(screen.queryByRole("button", { name: "Rezept lesen" })).toBeNull();
    await paste("   ");
    expect(screen.queryByRole("button", { name: "Rezept lesen" })).toBeNull();
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

  describe("Claude link", () => {
    const LINK = "https://example.org/linsen";
    const claude = () => screen.queryByRole("link", { name: "In Claude extrahieren" });

    it("shows only for an http(s) link, with the right address and no server call", async () => {
      const calls = server(base);
      await openImport();
      expect(claude()).toBeNull();
      await paste("Linsensuppe: 200 g Linsen kochen.");
      expect(claude()).toBeNull();
      await userEvent.clear(screen.getByRole("textbox", { name: "Neue Idee" }));
      await paste(LINK);
      const link = claude() as HTMLAnchorElement;
      expect(link.href.startsWith("https://claude.ai/new?q=")).toBe(true);
      expect(decodeURIComponent(link.href.split("?q=")[1] ?? "")).toContain(LINK);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(screen.getByText("Antwort kopieren und hier als Text einfügen.")).toBeInTheDocument();
      const before = calls.length;
      link.addEventListener("click", (e) => e.preventDefault());
      await userEvent.click(link);
      expect(calls.length).toBe(before);
      expect(calls.some((c) => c.key === DRAFT)).toBe(false);
    });

    it("is offered prominently in the error when the link could not be read", async () => {
      server({ ...base, [DRAFT]: { status: 422, body: { error: "empty" } } });
      await openImport();
      await paste(LINK);
      await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
      const alert = await screen.findByRole("alert");
      expect(within(alert).getByRole("link", { name: "In Claude extrahieren" })).toHaveAttribute("target", "_blank");
      expect(screen.getAllByRole("link", { name: "In Claude extrahieren" })).toHaveLength(1);
    });

    it("is not in the error of a pasted text", async () => {
      server({ ...base, [DRAFT]: { status: 422, body: { error: "not_a_recipe" } } });
      await openImport();
      await paste("Irgendein Text");
      await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
      await screen.findByRole("alert");
      expect(claude()).toBeNull();
    });
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
    await userEvent.click(await screen.findByRole("button", { name: "Zurück zu den Ideen" }));
    expect(screen.getByRole("textbox", { name: "Neue Idee" })).toHaveValue("");
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

describe("the rest of the review", () => {
  const read = async (routes: Parameters<typeof server>[0], shown: object = draft) => {
    const calls = server({ ...base, [DRAFT]: { status: 200, body: { draft: shown } }, ...routes });
    await openImport();
    await paste("Text");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    await screen.findByRole("heading", { name: "Rezept prüfen" });
    return calls;
  };
  const created = (calls: { key: string; body?: unknown }[]) =>
    (
      (calls.find((c) => c.key === CREATE) ?? { body: { draft: {} } }).body as {
        draft: typeof draft & { imageToken?: string };
      }
    ).draft;
  const create = async (calls: { key: string }[]) => {
    await userEvent.click(screen.getByRole("button", { name: "In KitchenOwl anlegen" }));
    await waitFor(() => expect(calls.some((c) => c.key === CREATE)).toBe(true));
  };
  const answer = { [CREATE]: { status: 201, body: { recipeId: 1, draft, photoAttached: true } } };

  it("lets a member change time and portions, and take them away", async () => {
    const calls = await read(answer);
    const time = screen.getByRole("spinbutton", { name: "Zeit (Min.)" });
    await userEvent.clear(time);
    await userEvent.type(time, "25");
    await userEvent.clear(screen.getByRole("spinbutton", { name: "Portionen" }));
    await create(calls);
    const sent = created(calls);
    expect(sent.totalMinutes).toBe(25);
    expect(sent).not.toHaveProperty("yields");
  });

  it("lets a member change the kind of dish, the base and the diet", async () => {
    const calls = await read(answer);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Art" }), "side");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Basis" }), "rice");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Ernährung" }), "meat");
    await create(calls);
    expect(created(calls)).toMatchObject({ mealType: "side", base: "rice", diet: "meat" });
  });

  it("renames a tag to the household's spelling, with its emoji", async () => {
    const calls = await read({
      ...answer,
      [MATCH_TAGS]: { status: 200, body: { tags: [{ written: "scharf", name: "🌶️ Scharf", isKnown: true }] } },
    });
    const tag = screen.getByRole("textbox", { name: "Tag 1" });
    await userEvent.clear(tag);
    await userEvent.type(tag, "scharf");
    await userEvent.tab();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Tag 1" })).toHaveValue("🌶️ Scharf"));
    expect(calls.find((c) => c.key === MATCH_TAGS)?.body).toEqual({ names: ["scharf"] });
    await create(calls);
    expect(created(calls).tags).toEqual(["🌶️ Scharf"]);
  });

  const SUGGEST = `POST ${api}/import/suggest`;

  it("offers the household's tags while typing, and adds the one picked, with its emoji", async () => {
    const calls = await read({
      ...answer,
      [SUGGEST]: { status: 200, body: { names: [{ name: "🌶️ Scharf" }, { name: "🔥 Scharfgebraten" }] } },
      [MATCH_TAGS]: { status: 200, body: { tags: [{ written: "🌶️ Scharf", name: "🌶️ Scharf", isKnown: true }] } },
    });
    const field = screen.getByRole("combobox", { name: "Neuer Tag" });
    await userEvent.type(field, "scha");
    await screen.findByRole("option", { name: "🌶️ Scharf" });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "🌶️ Scharf",
      "🔥 Scharfgebraten",
      "„scha“ als neuen Tag hinzufügen",
    ]);
    expect(calls.find((c) => c.key === SUGGEST)?.body).toEqual({ kind: "tag", query: "scha" });
    await userEvent.click(options[0]!);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Tag 2" })).toHaveValue("🌶️ Scharf"));
    expect(field).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await create(calls);
    expect(created(calls).tags).toEqual(["🍲 Suppe", "🌶️ Scharf"]);
  });

  it("picks a suggestion with the arrow keys and Enter, and takes the typed text when none is chosen", async () => {
    const calls = await read({
      ...answer,
      [SUGGEST]: { status: 200, body: { names: [{ name: "🌶️ Scharf" }] } },
      [MATCH_TAGS]: { status: 200, body: { tags: [{ written: "x", name: "🌶️ Scharf", isKnown: true }] } },
    });
    const field = screen.getByRole("combobox", { name: "Neuer Tag" });
    await userEvent.type(field, "scha");
    await screen.findByRole("option", { name: "🌶️ Scharf" });
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Tag 2" })).toHaveValue("🌶️ Scharf"));
    await userEvent.type(field, "Grillen");
    await screen.findByRole("option", { name: "„Grillen“ als neuen Tag hinzufügen" });
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(calls.filter((c) => c.key === MATCH_TAGS)).toHaveLength(2));
    expect(calls.filter((c) => c.key === MATCH_TAGS)[1]?.body).toEqual({ names: ["Grillen"] });
  });

  it("does not add a tag twice", async () => {
    const calls = await read({
      ...answer,
      [SUGGEST]: { status: 200, body: { names: [{ name: "🍲 Suppe" }] } },
      [MATCH_TAGS]: { status: 200, body: { tags: [{ written: "x", name: "🍲 Suppe", isKnown: true }] } },
    });
    await userEvent.type(screen.getByRole("combobox", { name: "Neuer Tag" }), "suppe");
    await userEvent.click(await screen.findByRole("option", { name: "🍲 Suppe" }));
    await waitFor(() => expect(calls.some((c) => c.key === MATCH_TAGS)).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("textbox", { name: "Tag 2" })).not.toBeInTheDocument();
  });

  it("removes a tag, also by emptying its field", async () => {
    const calls = await read(answer, { ...draft, tags: ["🍲 Suppe", "🌶️ Scharf", "Grillen"] });
    await userEvent.click(screen.getByRole("button", { name: "🌶️ Scharf entfernen" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Tag 2" }));
    await userEvent.tab();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Tag 3" })).not.toBeInTheDocument());
    await create(calls);
    expect(created(calls).tags).toEqual(["🍲 Suppe"]);
  });

  it("offers no more tags once there are twelve", async () => {
    await read(answer, { ...draft, tags: Array.from({ length: 12 }, (_, i) => `Tag ${i}`) });
    expect(screen.queryByRole("combobox", { name: "Neuer Tag" })).not.toBeInTheDocument();
  });

  const TOKEN = "0123456789abcdef0123456789abcdef";

  it("shows the title picture from the planner, and creates the recipe without it when removed", async () => {
    const calls = await read(answer, { ...draft, imageToken: TOKEN });
    expect(screen.getByRole("img", { name: "Titelbild" })).toHaveAttribute("src", `${api}/import/image/${TOKEN}`);
    await userEvent.click(screen.getByRole("button", { name: "Bild entfernen" }));
    expect(screen.queryByRole("img", { name: "Titelbild" })).not.toBeInTheDocument();
    await create(calls);
    expect(created(calls)).not.toHaveProperty("imageToken");
  });

  it("sends the picture's token along, and says when the picture did not make it", async () => {
    const calls = await read(
      {
        [CREATE]: { status: 201, body: { recipeId: 1, draft: { ...draft, imageToken: TOKEN }, photoAttached: false } },
      },
      { ...draft, imageToken: TOKEN },
    );
    await create(calls);
    expect(created(calls).imageToken).toBe(TOKEN);
    expect(await screen.findByText("Das Titelbild konnte nicht übernommen werden.")).toBeInTheDocument();
  });

  it("does not mention a picture there never was", async () => {
    const calls = await read({ [CREATE]: { status: 201, body: { recipeId: 1, draft, photoAttached: false } } });
    await create(calls);
    await screen.findByText(/ist jetzt in KitchenOwl/);
    expect(screen.queryByText(/Titelbild/)).not.toBeInTheDocument();
  });

  it("lets go of a picture the browser cannot load", async () => {
    await read(answer, { ...draft, imageToken: TOKEN });
    const img = screen.getByRole("img", { name: "Titelbild" });
    img.dispatchEvent(new Event("error"));
    await waitFor(() => expect(screen.queryByRole("img", { name: "Titelbild" })).not.toBeInTheDocument());
  });
});

describe("replacing an ingredient in the review", () => {
  const SUGGEST = `POST ${api}/import/suggest`;
  const open = async (routes: Parameters<typeof server>[0]) => {
    const calls = server({
      ...base,
      [DRAFT]: { status: 200, body: { draft } },
      [CREATE]: { status: 201, body: { recipeId: 1, draft } },
      ...routes,
    });
    await openImport();
    await paste("Text");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    await screen.findByRole("heading", { name: "Rezept prüfen" });
    return calls;
  };
  const found = { [SUGGEST]: { status: 200, body: { names: [{ name: "Petersilie", icon: "parsley" }] } } };

  it("opens a dialog, finds one of the household's items by typing, and swaps it in, keeping the amount", async () => {
    const calls = await open(found);
    await userEvent.click(screen.getByRole("button", { name: "Petersilie ersetzen" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("„Petersilie“ ersetzen");
    const field = within(dialog).getByRole("combobox", { name: "Neue Zutat" });
    expect(field).toHaveFocus();
    await userEvent.type(field, "peter");
    const option = await within(dialog).findByRole("option", { name: "Petersilie" });
    expect(calls.find((c) => c.key === SUGGEST)?.body).toEqual({ kind: "item", query: "peter" });
    await userEvent.click(option);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const tile = within(screen.getByRole("list", { name: "Zutaten" })).getAllByRole("listitem")[1]!;
    expect(within(tile).getByRole("textbox", { name: "Zutat 2" })).toHaveValue("Petersilie");
    expect(tile).not.toHaveTextContent("neu");
    expect(tile).toHaveTextContent("optional");
  });

  it("takes a name the household does not have as a new item, after looking it up once more", async () => {
    const calls = await open({
      [SUGGEST]: { status: 200, body: { names: [] } },
      [MATCH]: { status: 200, body: { items: [{ written: "Bärlauch", name: "Bärlauch", isNewItem: true }] } },
    });
    await userEvent.click(screen.getByRole("button", { name: "Linsen ersetzen" }));
    await userEvent.type(screen.getByRole("combobox", { name: "Neue Zutat" }), "Bärlauch");
    await userEvent.click(await screen.findByRole("option", { name: "„Bärlauch“ als neue Zutat verwenden" }));
    const tile = within(screen.getByRole("list", { name: "Zutaten" })).getAllByRole("listitem")[0]!;
    expect(within(tile).getByRole("textbox", { name: "Zutat 1" })).toHaveValue("Bärlauch");
    expect(within(tile).getByRole("textbox", { name: "Menge 1" })).toHaveValue("200 g");
    expect(tile).toHaveTextContent("neu");
    await waitFor(() => expect(calls.some((c) => c.key === MATCH)).toBe(true));
  });

  it("closes without a change by the button, Escape or a tap outside", async () => {
    await open(found);
    for (const close of [
      () => userEvent.click(screen.getByRole("button", { name: "Abbrechen" })),
      () => userEvent.keyboard("{Escape}"),
      () => userEvent.click(document.querySelector(".modal-backdrop")!),
    ]) {
      await userEvent.click(screen.getByRole("button", { name: "Petersilie ersetzen" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      await close();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
    expect(screen.getByRole("textbox", { name: "Zutat 2" })).toHaveValue("Petersilie");
  });
});

describe("recipes the household already has", () => {
  const RELATED = `POST ${api}/import/related`;
  const open = async (routes: Parameters<typeof server>[0]) => {
    const calls = server({
      ...base,
      [DRAFT]: { status: 200, body: { draft } },
      [CREATE]: { status: 201, body: { recipeId: 1, draft } },
      [LINKS]: {
        status: 200,
        body: { links: { recipe: "https://ko.test/household/2/recipes/details/{id}", list: "x" } },
      },
      ...routes,
    });
    await openImport();
    await paste("Text");
    await userEvent.click(screen.getByRole("button", { name: "Rezept lesen" }));
    await screen.findByRole("heading", { name: "Rezept prüfen" });
    return calls;
  };

  it("tells which look alike and why, with links, and leaves the decision to the member", async () => {
    const calls = await open({
      [RELATED]: {
        status: 200,
        body: {
          related: [
            { id: 7, name: "Rote Linsensuppe", reasons: ["similar_name", "shared_ingredients"], sharedIngredients: 5 },
          ],
        },
      },
    });
    const box = await screen.findByRole("region", { name: "Ähnliche Rezepte" });
    expect(box).toHaveTextContent("Ähnliche Rezepte in KitchenOwl");
    expect(box).toHaveTextContent("ähnlicher Name, 5 gleiche Zutaten");
    expect(box).toHaveTextContent("Du entscheidest, ob du es trotzdem anlegen möchtest.");
    expect(within(box).getByRole("link", { name: "Rote Linsensuppe" })).toHaveAttribute(
      "href",
      "https://ko.test/household/2/recipes/details/7",
    );
    expect(calls.find((c) => c.key === RELATED)?.body).toEqual({
      name: "Linsensuppe",
      ingredients: ["Linsen", "Petersilie"],
      source: "https://example.org/linsen",
    });
    // Nothing is blocked: the recipe can still be created.
    expect(screen.getByRole("button", { name: "In KitchenOwl anlegen" })).toBeEnabled();
  });

  it("says plainly that the recipe is already there when it came from the same link", async () => {
    await open({
      [RELATED]: {
        status: 200,
        body: { related: [{ id: 7, name: "Linsensuppe", reasons: ["same_source"], sharedIngredients: 0 }] },
      },
    });
    const box = await screen.findByRole("region", { name: "Ähnliche Rezepte" });
    expect(box).toHaveTextContent("Dieses Rezept gibt es schon");
    expect(box).toHaveTextContent("gleiche Quelle");
  });

  it("says nothing when nothing looks alike, or when the check did not work", async () => {
    await open({ [RELATED]: { status: 200, body: { related: [] } } });
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByRole("region", { name: "Ähnliche Rezepte" })).not.toBeInTheDocument();
  });

  it("looks again, a moment after the name was changed", async () => {
    const calls = await open({ [RELATED]: { status: 200, body: { related: [] } } });
    await waitFor(() => expect(calls.filter((c) => c.key === RELATED)).toHaveLength(1));
    const name = screen.getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Gemüsepfanne");
    await waitFor(() => expect(calls.filter((c) => c.key === RELATED)).toHaveLength(2));
    expect(calls.filter((c) => c.key === RELATED)[1]?.body).toMatchObject({ name: "Gemüsepfanne" });
  });
});
