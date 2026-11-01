// Amounts for the shopping list: scaling one ingredient to the household's portions and adding the same ingredient up
// across recipes. This is the one place that parses free text ("400 g, geschält"), so it is kept strict: whatever it
// cannot read is passed on unchanged and flagged for a person to look at.
import type { Ingredient } from "../catalog/recipe.js";

interface ScaledAmount {
  /** What goes on the list: amount and unit without any note, or the original text when it could not be read. */
  readonly text: string;
  /** Null when there is no amount (empty description) or it could not be read. */
  readonly quantity: number | null;
  readonly unit: string;
  readonly needsReview: boolean;
}

const VULGAR: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

const round = (n: number): number => Math.round(n * 100) / 100;

/** 1.5 -> "1.5", 2 -> "2": at most two decimals, a point as KitchenOwl's own descriptions use. */
const formatNumber = (n: number): string => String(round(n));

const parseNumber = (raw: string): number | null => {
  const vulgar = VULGAR[raw];
  if (vulgar !== undefined) return vulgar;
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(raw);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(raw);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const plain = /^\d+(?:[.,]\d+)?$/.exec(raw);
  return plain ? Number(raw.replace(",", ".")) : null;
};

const LEADING_NUMBER = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔])\s*(.*)$/u;

/**
 * Reads a leading amount and unit, drops the note after a comma or bracket, and multiplies by `factor`
 * (household portions divided by the recipe's yields).
 */
export function scaleDescription(description: string, factor: number): ScaledAmount {
  const text = description.trim();
  if (text === "") return { text: "", quantity: null, unit: "", needsReview: false };
  const unreadable: ScaledAmount = { text, quantity: null, unit: "", needsReview: true };
  const m = LEADING_NUMBER.exec(text);
  if (!m || !Number.isFinite(factor) || factor <= 0) return unreadable;
  const quantity = parseNumber((m[1] as string).trim());
  if (quantity === null || quantity <= 0) return unreadable;
  const rest = (m[2] as string).split(/[,;(]/)[0]?.trim() ?? "";
  // A range ("2-3 Stück") or a number glued to more text is not one amount.
  if (/^[-–]/.test(rest) || /^\d/.test(rest)) return unreadable;
  const scaled = round(quantity * factor);
  // A unit of several words ("große Zwiebeln") is probably a note, not a unit: keep it, but ask for a look.
  const needsReview = /\s/.test(rest) || /^\(/.test((m[2] as string).trim());
  return {
    text: rest === "" ? formatNumber(scaled) : `${formatNumber(scaled)} ${rest}`,
    quantity: scaled,
    unit: rest,
    needsReview,
  };
}

/** What one recipe contributes to the list. */
interface ConsolidationInput {
  readonly recipeName: string;
  /** Portions the recipe's amounts are written for. */
  readonly yields: number;
  readonly ingredients: readonly Ingredient[];
}

export interface ListItem {
  readonly id?: number;
  readonly name: string;
  /** The source's category of the ingredient, when it names one. */
  readonly category?: string;
  /** All amounts of this ingredient, one per unit: "800 g, 2 EL". Empty when no recipe gave an amount. */
  readonly description: string;
  /** At least one amount could not be read, or looks like a note: a person should check the line. */
  readonly needsReview: boolean;
  /** The recipes that need it, in plan order. */
  readonly recipes: readonly string[];
}

/** Units KitchenOwl adds up across spellings: everything in grams or millilitres. */
const MASS: Record<string, number> = { mg: 0.001, g: 1, gr: 1, gram: 1, gramm: 1, kg: 1000 };
const VOLUME: Record<string, number> = { ml: 1, l: 1000, liter: 1000, litre: 1000 };

/** The unit family and the factor into its base unit; other units stay as written. */
function family(unit: string): { key: string; factor: number } {
  const u = unit.toLowerCase();
  if (u in MASS) return { key: "\u0000mass", factor: MASS[u] as number };
  if (u in VOLUME) return { key: "\u0000volume", factor: VOLUME[u] as number };
  return { key: unit, factor: 1 };
}

const render = (key: string, total: number): string => {
  if (key === "\u0000mass") return total >= 1000 ? `${formatNumber(total / 1000)} kg` : `${formatNumber(total)} g`;
  if (key === "\u0000volume") return total >= 1000 ? `${formatNumber(total / 1000)} l` : `${formatNumber(total)} ml`;
  return key === "" ? formatNumber(total) : `${formatNumber(total)} ${key}`;
};

/**
 * Adds the same ingredient up across the recipes of the plan, the way KitchenOwl would on its own list: grams and
 * kilograms, millilitres and litres add up; any other unit adds up only when its text is identical; different units
 * stay side by side. Optional ingredients are left out. Amounts are scaled to `portions` first.
 */
export function consolidateIngredients(inputs: readonly ConsolidationInput[], portions: number): ListItem[] {
  interface Group {
    id?: number;
    category?: string;
    name: string;
    sums: Map<string, number>;
    notes: string[];
    review: boolean;
    recipes: string[];
  }
  const groups = new Map<string, Group>();
  for (const input of inputs) {
    const factor = input.yields > 0 ? portions / input.yields : Number.NaN;
    for (const ingredient of input.ingredients) {
      if (ingredient.optional) continue;
      const name = ingredient.name.trim();
      if (name === "") continue;
      const key = name.toLowerCase();
      let g = groups.get(key);
      if (!g) {
        g = { name, sums: new Map(), notes: [], review: false, recipes: [] };
        if (ingredient.id !== undefined) g.id = ingredient.id;
        groups.set(key, g);
      }
      if (g.category === undefined && ingredient.category) g.category = ingredient.category;
      if (!g.recipes.includes(input.recipeName)) g.recipes.push(input.recipeName);
      const amount = scaleDescription(ingredient.description, factor);
      if (amount.needsReview) g.review = true;
      if (amount.quantity === null) {
        if (amount.text !== "" && !g.notes.includes(amount.text)) g.notes.push(amount.text);
        continue;
      }
      const fam = family(amount.unit);
      g.sums.set(fam.key, (g.sums.get(fam.key) ?? 0) + amount.quantity * fam.factor);
    }
  }
  return [...groups.values()].map((g) => ({
    ...(g.id !== undefined ? { id: g.id } : {}),
    name: g.name,
    ...(g.category !== undefined ? { category: g.category } : {}),
    description: [...[...g.sums].map(([key, total]) => render(key, total)), ...g.notes].join(", "),
    needsReview: g.review,
    recipes: g.recipes,
  }));
}

/** The list without the ingredients the members already have, named as the list shows them (case does not matter). */
export function leaveOut(items: readonly ListItem[], names: readonly string[]): ListItem[] {
  const skipped = new Set(names.map((n) => n.trim().toLowerCase()));
  return items.filter((i) => !skipped.has(i.name.toLowerCase()));
}
