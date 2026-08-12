import { z } from 'zod';

const coercedId = z.union([z.string(), z.number()]).transform((v) => String(v));

// The LLM sometimes emits an "action" key instead of the "type" discriminator the
// schema expects (e.g. { "action": "quarantine", ... } instead of { "type": "quarantine", ... }).
// Normalize that here, before validation, so a harmless naming choice by the model doesn't
// blow up the whole batch and force every gap through the blind first-candidate fallback.
const FoodCuratorActionSchemaRaw = z.object({
  actions: z.array(z.discriminatedUnion('type', [
    z.object({
      type: z.literal('pick_existing'),
      query: z.string(),
      chosenFdcId: coercedId,
      aliasesToCreate: z.array(z.string()).optional(),
      reason: z.string()
    }),
    z.object({
      type: z.literal('merge_duplicates'),
      winnerFdcId: coercedId,
      loserFdcIds: z.array(coercedId),
      reason: z.string()
    }),
    z.object({
      type: z.literal('normalize_basis'),
      fdcId: coercedId,
      fromBasis: z.string(),
      toBasis: z.string(),
      conversionFactor: z.number(),
      reason: z.string()
    }),
    z.object({
      type: z.literal('quarantine'),
      fdcId: coercedId,
      reason: z.string()
    })
  ]))
}).passthrough();

export const FoodCuratorActionSchema = z.preprocess((raw: any) => {
  // The LLM sometimes returns a bare top-level array (e.g. `[ {...}, {...} ]`) instead of
  // the expected `{ "actions": [...] }` wrapper object. Normalize that shape here too —
  // previously this caused Zod's "expected array, received undefined" on the `actions`
  // path, which discarded every curator decision (including correct ones) and forced the
  // whole batch through the blind "no curation happened" fallback.
  const normalized = Array.isArray(raw) ? { actions: raw } : raw;
  if (normalized && Array.isArray(normalized.actions)) {
    return {
      ...normalized,
      actions: normalized.actions.map((a: any) => (a && a.type == null && a.action != null) ? { ...a, type: a.action } : a)
    };
  }
  return normalized;
}, FoodCuratorActionSchemaRaw);

export const foodResolverCuratorInstruction = `You are the Master Curator of the AI Studio Food Database.
Your mandate is to resolve identity conflicts, deduplicate rows, and normalize data bases.

1. You curate the internal nutrition database and resolve identity conflicts.
2. Prefer reuse + alias over new rows; merge near-duplicates ('merge_duplicates').
3. Route brand products vs generic commodities correctly.
4. All stored densities are per 100g; interpret country serving formats; propose basis interpretation ('normalize_basis'), server will recompute.
5. Quarantine impossible values (extreme kcal, absurd weights) using 'quarantine'.
6. Choose only from provided candidates ('pick_existing'); NEVER invent IDs.
7. Output strict JSON actions; one line reason each. The output MUST be a single JSON object of the exact shape {"actions": [ ... ]} — a top-level array is NOT valid, always wrap your action list in an "actions" key. Every action object MUST use the key "type" (not "action") for its action kind, e.g. {"type": "quarantine", "fdcId": "170775", "reason": "..."}. All ID fields (chosenFdcId, winnerFdcId, loserFdcIds, fdcId) MUST be strings, e.g. "170775", not bare numbers.
8. Success = next identical query needs no Resolver because you added robust aliases.

When presented with multiple matches for a query, pick the best one and add aliases so future searches hit instantly.
If you see identical items with different IDs, merge them (pick one winner, list others as losers).
`;
