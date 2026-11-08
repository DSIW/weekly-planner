import { describe, expect, it } from "vitest";
import { isWebLink, titleFromLink } from "../src/idea-title";
import { hasShare, sharedFrom } from "../src/share-target";

describe("the title guessed from a link", () => {
  it.each([
    ["https://www.lecker.de/zuercher-geschnetzeltes", "Zuercher geschnetzeltes"],
    ["https://example.org/rezepte/kuerbis_gnocchi.html", "Kuerbis gnocchi"],
    ["https://example.org/r/Spa%C3%9Fnudeln-mit-Ei/", "Spaßnudeln mit Ei"],
    ["https://example.org/rezept/12345", "Rezept von example.org"],
    ["https://www.example.org/", "Rezept von example.org"],
    ["https://example.org/a8f3k29d4hs71jd0", "Rezept von example.org"],
    ["https://example.org/%E0%A4%A", "Rezept von example.org"],
  ])("%s → %s", (link, title) => expect(titleFromLink(link)).toBe(title));

  it("recognises web links only", () => {
    expect(isWebLink(" https://example.org/x ")).toBe(true);
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink("https://example.org mit Salbei")).toBe(false);
  });
});

describe("what the share sheet hands over", () => {
  it("takes the url field", () => expect(sharedFrom("?url=https%3A%2F%2Fex.org%2Fr")).toBe("https://ex.org/r"));
  it("finds the link inside the text, where Android browsers put it", () =>
    expect(sharedFrom("?title=Gnocchi&text=Schau%20mal%20https%3A%2F%2Fex.org%2Fg%20toll")).toBe("https://ex.org/g"));
  it("falls back to shared recipe text", () => expect(sharedFrom("?text=200%20g%20Linsen")).toBe("200 g Linsen"));
  it("is nothing for a plain visit", () => {
    expect(sharedFrom("")).toBeNull();
    expect(sharedFrom("?other=1")).toBeNull();
    expect(hasShare("?other=1")).toBe(false);
    expect(hasShare("?text=x")).toBe(true);
  });
});
