import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  htmlToText,
  isoMinutes,
  pageToSourceText,
  recipeFromStructuredData,
} from "../../../src/infrastructure/import/page-text.js";

const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const recipe = {
  "@type": "Recipe",
  name: "Linsensuppe &amp; mehr",
  description: "<p>Wärmt.</p>",
  recipeYield: ["4", "4 Portionen"],
  totalTime: "PT1H15M",
  recipeIngredient: ["200 g Linsen", " 1 Zwiebel ", ""],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Linsen waschen." },
    { "@type": "HowToSection", name: "Suppe", itemListElement: [{ "@type": "HowToStep", text: "Kochen." }] },
    "Abschmecken.",
  ],
};

describe("decodeEntities", () => {
  it("decodes named, decimal and hex references, and leaves unknown ones", () => {
    expect(decodeEntities("K&auml;se &amp; Brot &#228; &#xE4; &unknown;")).toBe("Käse & Brot ä ä &unknown;");
    expect(decodeEntities("a&#0;b&#99999999;c")).toBe("a b c");
  });
});

describe("htmlToText", () => {
  it("keeps the readable text, one line per block, without scripts, menus or comments", () => {
    const html = `<html><head><title>T</title><style>p{}</style></head><body><nav>Menü</nav><!-- hi -->
      <script>alert("x")</script><h1>Suppe</h1><p>Erst  kochen.</p><ul><li>Linsen</li><li>Wasser</li></ul>
      <footer>Impressum</footer><form><input></form></body></html>`;
    expect(htmlToText(html)).toBe("Suppe\nErst kochen.\nLinsen\nWasser");
  });

  it("cannot be tricked by unclosed or oddly cased blocks into showing a script", () => {
    expect(htmlToText("<SCRIPT >secret</SCRIPT >visible")).toBe("visible");
  });
});

describe("isoMinutes", () => {
  it("reads durations, and gives null for anything else", () => {
    expect(isoMinutes("PT30M")).toBe(30);
    expect(isoMinutes("PT1H30M")).toBe(90);
    expect(isoMinutes("P1DT2H")).toBe(1560);
    for (const bad of ["", "PT", "30 Minuten", "P", null, 30]) expect(isoMinutes(bad)).toBeNull();
  });
});

describe("recipeFromStructuredData", () => {
  it("writes a Recipe's data out as plain lines, steps from every shape", () => {
    expect(recipeFromStructuredData(ld(recipe))).toBe(
      [
        "Strukturierte Rezeptdaten der Seite:",
        "Name: Linsensuppe & mehr",
        "Beschreibung: Wärmt.",
        "Portionen: 4",
        "Gesamtzeit: 75 Minuten",
        "Zutaten:",
        "- 200 g Linsen",
        "- 1 Zwiebel",
        "Zubereitung:",
        "1. Linsen waschen.",
        "2. Kochen.",
        "3. Abschmecken.",
      ].join("\n"),
    );
  });

  it("finds the Recipe in a graph or a list, and with several types", () => {
    expect(recipeFromStructuredData(ld({ "@graph": [{ "@type": "WebSite" }, recipe] }))).toContain("Linsen");
    expect(
      recipeFromStructuredData(ld([{ "@type": "Person" }, { ...recipe, "@type": ["Recipe", "Thing"] }])),
    ).toContain("Linsen");
  });

  it("splits a single string of steps into lines", () => {
    const text = recipeFromStructuredData(ld({ ...recipe, recipeInstructions: "Erst.\nDann." }));
    expect(text).toContain("1. Erst.\n2. Dann.");
  });

  it("ignores a recipe without ingredients or steps, broken JSON and other data", () => {
    expect(recipeFromStructuredData(ld({ ...recipe, recipeIngredient: [] }))).toBeNull();
    expect(recipeFromStructuredData(ld({ ...recipe, recipeInstructions: [] }))).toBeNull();
    expect(recipeFromStructuredData('<script type="application/ld+json">{nope</script>')).toBeNull();
    expect(recipeFromStructuredData(ld({ "@type": "Article" }))).toBeNull();
    expect(recipeFromStructuredData("<p>plain</p>")).toBeNull();
  });

  it("gives up on data nested deeper than any real page", () => {
    let deep: unknown = recipe;
    for (let i = 0; i < 10; i++) deep = { "@graph": [deep] };
    expect(recipeFromStructuredData(ld(deep))).toBeNull();
  });
});

describe("pageToSourceText", () => {
  it("prefers the structured recipe, else the page text", () => {
    expect(pageToSourceText(`<p>Nav</p>${ld(recipe)}`)).toContain("Strukturierte Rezeptdaten");
    expect(pageToSourceText("<p>Nur Text</p>")).toBe("Nur Text");
  });
});
