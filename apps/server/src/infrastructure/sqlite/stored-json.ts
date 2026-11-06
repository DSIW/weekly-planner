import type { FinalizeExport, PassedSuggestion, Proposal, Recipe } from "@weekly-planner/domain";
import { BASES, DIETS, MEAL_TYPES } from "@weekly-planner/domain";
import { z } from "zod";

/**
 * Reading the JSON columns back (recipe copies, proposals, passes, the export). A row written by an older or a newer
 * version, or edited by hand, must fail here with the row named, not later in a rule with `undefined is not iterable`.
 *
 * Objects are "loose": a field the schema does not know is kept, so that a field the domain gains and this file
 * forgets is not silently dropped the next time the aggregate is saved. A field that is required here but missing in
 * old rows must be made optional or defaulted here, never edited in the database.
 */

export class StoredDataError extends Error {
  constructor(what: string, detail: string) {
    super(`stored data is unreadable (${what}): ${detail}`);
    this.name = "StoredDataError";
  }
}

const ingredient = z.looseObject({
  id: z.number().int().optional(),
  name: z.string(),
  description: z.string(),
  optional: z.boolean(),
  category: z.string().optional(),
  icon: z.string().optional(),
});

const recipe = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  mealType: z.enum(MEAL_TYPES),
  base: z.enum(BASES),
  diet: z.enum(DIETS),
  totalTimeMinutes: z.number().nullable(),
  isProven: z.boolean(),
  wantsToTry: z.boolean(),
  yields: z.number(),
  // Absent on recipes copied into a session before tags and ingredients were kept.
  tags: z.array(z.string()).optional(),
  ingredients: z.array(ingredient).optional(),
});

const planDateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const proposal = z.looseObject({
  id: z.string(),
  date: planDateText,
  recipe,
  proposedBy: z.string(),
  status: z.enum(["pending", "accepted", "vetoed", "withdrawn"]),
  decidedBy: z.string().optional(),
});

const passedSuggestion = z.looseObject({ recipeId: z.number().int(), passedBy: z.string() });

const stepStatus = z.enum(["pending", "sending", "done"]);

const listItem = z.looseObject({
  id: z.number().int().optional(),
  name: z.string(),
  category: z.string().optional(),
  icon: z.string().optional(),
  description: z.string(),
  needsReview: z.boolean(),
  recipes: z.array(z.string()),
});

const finalizeExport = z.looseObject({
  sessionId: z.string(),
  days: z.array(
    z.looseObject({
      date: planDateText,
      recipeId: z.number().int(),
      recipeName: z.string(),
      portions: z.number(),
      status: stepStatus,
    }),
  ),
  list: z.looseObject({ items: z.array(listItem), status: stepStatus }),
  failure: z.enum(["refused", "unconfirmed"]).nullable(),
});

function read<T>(schema: z.ZodType, text: string, what: string): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new StoredDataError(what, error instanceof Error ? error.message : String(error));
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new StoredDataError(what, `${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}`);
  }
  // The schemas above are the stored shape; the domain types add brands and `readonly`, which JSON cannot carry.
  return parsed.data as T;
}

/** `what` names the row for the error message, e.g. "plan_day 2026-11-03 of session 4f1…". */
export const readRecipe = (text: string, what: string): Recipe => read<Recipe>(recipe, text, what);
export const readProposals = (text: string, what: string): Proposal[] =>
  read<Proposal[]>(z.array(proposal), text, what);
export const readPasses = (text: string, what: string): PassedSuggestion[] =>
  read<PassedSuggestion[]>(z.array(passedSuggestion), text, what);
export const readExport = (text: string, what: string): FinalizeExport =>
  read<FinalizeExport>(finalizeExport, text, what);

/** Just the name and id of a stored recipe copy: all the taken-dates list shows. */
export const readRecipeSummary = (text: string, what: string): { id?: number; name: string } =>
  read(z.looseObject({ id: z.number().int().optional(), name: z.string() }), text, what);
