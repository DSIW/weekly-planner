import { z } from "zod";

/** The parts of a KitchenOwl recipe the planner reads. Unknown fields are ignored. */
const rawRecipeSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().default(""),
  time: z.number().nullish(),
  prep_time: z.number().nullish(),
  cook_time: z.number().nullish(),
  yields: z.number().nullish(),
  photo: z.string().nullish(),
  tags: z.array(z.object({ name: z.string() })).default([]),
  items: z
    .array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        description: z.string().default(""),
        optional: z.boolean().default(true),
      }),
    )
    .default([]),
});

export type RawRecipe = z.infer<typeof rawRecipeSchema>;
export const rawRecipeListSchema = z.array(rawRecipeSchema);

export const authResponseSchema = z.object({ access_token: z.string().min(1) });

export const userSchema = z.object({ id: z.number().int(), name: z.string(), username: z.string() });

export const householdSchema = z.object({ member: z.array(z.object({ id: z.number().int() })).default([]) });
