import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const decl = (selector: string, prop: string): string | null => {
  const rule = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`));
  return rule?.[1]?.match(new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
};

// An action of an expanded idea must never be unreadable: text colour and fill are set together and differ.
describe("the action buttons of an idea", () => {
  it.each([".act", ".act.act-primary", ".act.act-quiet"])("%s sets a text colour that differs from its fill", (sel) => {
    const color = decl(sel, "color");
    const fill = decl(sel, "background");
    expect(color).toBeTruthy();
    expect(fill).toBeTruthy();
    expect(color).not.toBe(fill);
  });

  it("does not borrow the global .button-link (a green pill) for its anchor", () => {
    const source = readFileSync(resolve(process.cwd(), "src/IdeasPanel.tsx"), "utf8");
    expect(source).not.toContain("button-link");
  });
});
