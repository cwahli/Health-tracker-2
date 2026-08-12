import { z } from 'zod';

export const FoodCuratorActionSchema = z.object({
  actions: z.array(z.discriminatedUnion('type', [
    z.object({
      type: z.literal('pick_existing'),
      query: z.string(),
      chosenFdcId: z.string(),
      aliasesToCreate: z.array(z.string()).optional(),
      reason: z.string()
    }),
    z.object({
      type: z.literal('merge_duplicates'),
      winnerFdcId: z.string(),
      loserFdcIds: z.array(z.string()),
      reason: z.string()
    }),
    z.object({
      type: z.literal('normalize_basis'),
      fdcId: z.string(),
      fromBasis: z.string(),
      toBasis: z.string(),
      conversionFactor: z.number(),
      reason: z.string()
    }),
    z.object({
      type: z.literal('quarantine'),
      fdcId: z.string(),
      reason: z.string()
    })
  ]))
}).passthrough();

export const foodResolverCuratorInstruction = `You are the Master Curator of the AI Studio Food Database.
Your mandate is to resolve identity conflicts, deduplicate rows, and normalize data bases.

1. You curate the internal nutrition database and resolve identity conflicts.
2. Prefer reuse + alias over new rows; merge near-duplicates ('merge_duplicates').
3. Route brand products vs generic commodities correctly.
4. All stored densities are per 100g; interpret country serving formats; propose basis interpretation ('normalize_basis'), server will recompute.
5. Quarantine impossible values (extreme kcal, absurd weights) using 'quarantine'.
6. Choose only from provided candidates ('pick_existing'); NEVER invent IDs.
7. Output strict JSON actions; one line reason each.
8. Success = next identical query needs no Resolver because you added robust aliases.

When presented with multiple matches for a query, pick the best one and add aliases so future searches hit instantly.
If you see identical items with different IDs, merge them (pick one winner, list others as losers).
`;
