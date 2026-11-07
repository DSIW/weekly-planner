import { describe, expect, it } from "vitest";
import { claudePrompt, claudeSearchUrl, MAX_PROMPT_LENGTH } from "../src/claude-search";

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
