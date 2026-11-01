/** What a language model reads of a web page: the recipe's structured data when the page has it, else the plain text. */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  deg: "°",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return NAMED[body] ?? whole;
  });
}

const DROPPED = [
  "script",
  "style",
  "noscript",
  "svg",
  "template",
  "iframe",
  "head",
  "nav",
  "footer",
  "aside",
  "form",
  "button",
];

/** The readable text of an HTML page: no scripts, menus or markup, one line per block. */
export function htmlToText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ");
  for (const tag of DROPPED) s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, "gi"), " ");
  s = s
    .replace(/<\/?(?:p|div|li|ul|ol|br|h[1-6]|tr|section|article|table|dd|dt)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(s)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** "PT1H30M" is 90 minutes; anything else is unknown. */
export function isoMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?$/i.exec(value.trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

const asText = (v: unknown): string => {
  if (typeof v === "string")
    return decodeEntities(v)
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (typeof v === "number") return String(v);
  return "";
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isRecipeNode(v: unknown): v is Record<string, unknown> {
  if (!isObject(v)) return false;
  const type = v["@type"];
  return type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"));
}

function findRecipe(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6) return null;
  if (isRecipeNode(node)) return node;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findRecipe(n, depth + 1);
      if (found) return found;
    }
  } else if (isObject(node)) {
    const found = findRecipe(node["@graph"], depth + 1);
    if (found) return found;
  }
  return null;
}

function instructionLines(v: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof v === "string")
    return asText(v) === ""
      ? []
      : v
          .split(/\n+/)
          .map(asText)
          .filter((l) => l !== "");
  if (Array.isArray(v)) return v.flatMap((x) => instructionLines(x, depth + 1));
  if (isObject(v)) {
    if (Array.isArray(v.itemListElement)) return instructionLines(v.itemListElement, depth + 1);
    const text = asText(v.text) || asText(v.name);
    return text === "" ? [] : [text];
  }
  return [];
}

const scripts = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

/** The page's `schema.org/Recipe` data, written out as plain lines; null when the page has none. */
export function recipeFromStructuredData(html: string): string | null {
  for (const match of html.matchAll(scripts)) {
    let json: unknown;
    try {
      json = JSON.parse((match[1] ?? "").replace(/^\s*<!--|-->\s*$/g, ""));
    } catch {
      continue;
    }
    const recipe = findRecipe(json);
    if (!recipe) continue;
    const ingredients = (Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : [])
      .map(asText)
      .filter((l) => l !== "");
    const steps = instructionLines(recipe.recipeInstructions);
    if (ingredients.length === 0 || steps.length === 0) continue;
    const total = isoMinutes(recipe.totalTime);
    const yields = Array.isArray(recipe.recipeYield) ? asText(recipe.recipeYield[0]) : asText(recipe.recipeYield);
    const lines = [
      "Strukturierte Rezeptdaten der Seite:",
      `Name: ${asText(recipe.name)}`,
      ...(asText(recipe.description) ? [`Beschreibung: ${asText(recipe.description)}`] : []),
      ...(yields ? [`Portionen: ${yields}`] : []),
      ...(total ? [`Gesamtzeit: ${total} Minuten`] : []),
      "Zutaten:",
      ...ingredients.map((i) => `- ${i}`),
      "Zubereitung:",
      ...steps.map((s, i) => `${i + 1}. ${s}`),
    ];
    return lines.join("\n");
  }
  return null;
}

/** What the model reads: structured recipe data if there is any (smaller and cleaner), else the page's text. */
export function pageToSourceText(html: string): string {
  return recipeFromStructuredData(html) ?? htmlToText(html);
}
