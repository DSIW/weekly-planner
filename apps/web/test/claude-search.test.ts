import { describe, expect, it } from "vitest";
import {
  claudeExtractPrompt,
  claudeExtractUrl,
  claudePrompt,
  claudeSearchUrl,
  MAX_PROMPT_LENGTH,
} from "../src/claude-search";

const idea = (over: Partial<{ title: string; note: string | null; inspirationLink: string | null }> = {}) => ({
  title: "Kürbisgnocchi",
  note: null,
  inspirationLink: null,
  ...over,
});

describe("claudePrompt", () => {
  it("uses title, note and inspiration link", () => {
    const p = claudePrompt(idea({ note: "ohne Sahne", inspirationLink: "https://x.example/a" }));
    expect(p).toContain("für: Kürbisgnocchi.");
    expect(p).toContain("Hinweis: ohne Sahne.");
    expect(p).toContain("Inspiration: https://x.example/a.");
    expect(p).toContain("3 gute");
  });

  it("leaves out empty parts", () => {
    const p = claudePrompt(idea({ note: "  ", inspirationLink: "" }));
    expect(p).not.toContain("Hinweis");
    expect(p).not.toContain("Inspiration");
  });

  it("drops an inspiration that is not an http(s) link", () => {
    expect(claudePrompt(idea({ inspirationLink: "javascript:alert(1)" }))).not.toContain("Inspiration");
    expect(claudePrompt(idea({ inspirationLink: "meine Oma" }))).not.toContain("Inspiration");
  });

  it("caps the whole prompt and keeps the link and the request", () => {
    const p = claudePrompt(idea({ note: "x".repeat(5000), inspirationLink: "https://x.example/a" }));
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
    expect(p).toContain("Inspiration: https://x.example/a.");
    expect(p).toContain("zwei Sätze");
    expect(claudePrompt(idea({ title: "t".repeat(5000) })).length).toBeLessThanOrEqual(MAX_PROMPT_LENGTH);
  });
});

describe("claudeSearchUrl", () => {
  it("encodes the prompt", () => {
    const url = claudeSearchUrl(idea({ title: "Käse & Spätzle #1" }));
    expect(url.startsWith("https://claude.ai/new?q=")).toBe(true);
    expect(url).not.toMatch(/[ &#]/);
    const q = new URL(url).searchParams.get("q");
    expect(q).toBe(claudePrompt(idea({ title: "Käse & Spätzle #1" })));
  });
});

describe("claudeExtractPrompt and claudeExtractUrl", () => {
  const page = "https://www.lecker.de/zuercher-geschnetzeltes?a=1&b=ä";

  it("includes the address, the layout and the way out", () => {
    const p = claudeExtractPrompt(` ${page} `) ?? "";
    expect(p).toContain(`: ${page}`);
    expect(p).toContain(`Quelle: ${page}`);
    for (const part of ["Portionen: N", "Zeit: N Minuten", "Zutaten:", "- 200 g Mehl", "Zubereitung:", "1. "])
      expect(p).toContain(part);
    expect(p).toContain("erfinde kein Rezept");
  });

  it("needs an http(s) link", () => {
    for (const bad of [
      "",
      "Linsensuppe",
      "javascript:alert(1)",
      "ftp://x.example/a",
      "https://a b",
      "text https://x.example",
    ]) {
      expect(claudeExtractPrompt(bad)).toBeNull();
      expect(claudeExtractUrl(bad)).toBeNull();
    }
  });

  it("encodes the prompt into the claude.ai address", () => {
    const url = claudeExtractUrl(page) ?? "";
    expect(url.startsWith("https://claude.ai/new?q=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://claude.ai/new?q=".length))).toBe(claudeExtractPrompt(page));
    expect(url).not.toContain(" ");
  });
});
