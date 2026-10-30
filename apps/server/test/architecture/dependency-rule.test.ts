import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The onion rule: source code dependencies only point inwards.
 *
 *   domain  <-  application  <-  infrastructure | interface  <-  main (composition root, entry points)
 *
 * This test reads the import statements of every source file and fails when a layer reaches outwards.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DOMAIN = "@weekly-planner/domain";
const APPLICATION = "@weekly-planner/application";

type Layer = "domain" | "application" | "infrastructure" | "interface" | "main";

const layerOf = (file: string): Layer | undefined => {
  const rel = relative(root, file).split(sep).join("/");
  if (rel.startsWith("packages/domain/src/")) return "domain";
  if (rel.startsWith("packages/application/src/")) return "application";
  if (rel.startsWith("apps/server/src/infrastructure/")) return "infrastructure";
  if (rel.startsWith("apps/server/src/interface/")) return "interface";
  if (rel.startsWith("apps/server/src/main/")) return "main";
  return undefined;
};

export function importsOf(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g)) {
    specs.push((m[1] ?? m[2] ?? m[3])!);
  }
  return specs;
}

/** Returns a description of each rule the file's imports break. */
export function violations(file: string, source: string): string[] {
  const layer = layerOf(file);
  if (!layer) return [];
  const out: string[] = [];
  for (const spec of importsOf(source)) {
    if (spec.startsWith(".")) {
      const target = layerOf(resolve(dirname(file), spec) + ".ts") ?? layerOf(join(resolve(dirname(file), spec), "index.ts"));
      // Only the composition root (main) may reach into other layers of the server.
      if (target && target !== layer && layer !== "main") out.push(`${layer} imports the ${target} layer through "${spec}"`);
      continue;
    }
    if (layer === "domain") out.push(`domain must import nothing but itself, found "${spec}"`);
    if (layer === "application" && spec !== DOMAIN) out.push(`application may import only the domain, found "${spec}"`);
    if ((layer === "infrastructure" || layer === "interface") && spec.startsWith("@weekly-planner/") && spec !== DOMAIN && spec !== APPLICATION) {
      out.push(`${layer} imports unknown workspace package "${spec}"`);
    }
  }
  return out;
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules") return [];
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });

describe("dependency rule", () => {
  const files = ["packages/domain/src", "packages/application/src", "apps/server/src"].flatMap((d) => walk(join(root, d)));

  it("covers every layer", () => {
    const seen = new Set(files.map(layerOf));
    expect([...seen].sort()).toEqual(["application", "domain", "infrastructure", "interface", "main"]);
  });

  it("is respected by all source files", () => {
    const found = files.flatMap((f) => violations(f, readFileSync(f, "utf8")).map((v) => `${relative(root, f)}: ${v}`));
    expect(found).toEqual([]);
  });

  it("keeps the domain package free of dependencies and the application package on the domain only", () => {
    const deps = (p: string): string[] => Object.keys(JSON.parse(readFileSync(join(root, p, "package.json"), "utf8")).dependencies ?? {});
    expect(deps("packages/domain")).toEqual([]);
    expect(deps("packages/application")).toEqual([DOMAIN]);
  });

  describe("the checker itself", () => {
    const f = (p: string) => join(root, p);
    it("flags a domain file that imports a library", () => {
      expect(violations(f("packages/domain/src/x.ts"), `import { z } from "zod";`)).not.toEqual([]);
    });
    it("flags an application file that imports infrastructure code", () => {
      expect(violations(f("packages/application/src/x.ts"), `import { c } from "../../../apps/server/src/infrastructure/kitchenowl/client.js";`)).not.toEqual([]);
      expect(violations(f("packages/application/src/x.ts"), `import fs from "node:fs";`)).not.toEqual([]);
    });
    it("flags an interface file that reaches into infrastructure", () => {
      expect(violations(f("apps/server/src/interface/x.ts"), `import { c } from "../infrastructure/kitchenowl/client.js";`)).not.toEqual([]);
    });
    it("allows the composition root to wire all layers", () => {
      expect(violations(f("apps/server/src/main/x.ts"), `import { c } from "../infrastructure/kitchenowl/client.js";`)).toEqual([]);
    });
    it("allows inward imports", () => {
      expect(violations(f("apps/server/src/infrastructure/x.ts"), `import type { RecipeCatalog } from "@weekly-planner/application";`)).toEqual([]);
      expect(violations(f("packages/application/src/x.ts"), `import type { Recipe } from "@weekly-planner/domain";`)).toEqual([]);
      expect(violations(f("packages/domain/src/x.ts"), `import type { A } from "./catalog/recipe.js";`)).toEqual([]);
    });
  });
});
