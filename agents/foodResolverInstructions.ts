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
      chosenFdcId: coercedId.optional().nullable(),
      parametricFdcId: coercedId.optional().nullable(),
      parametricFoodName: z.string().optional().nullable(),
      catalogType: z.enum(['commodity', 'brand']).optional(),
      confidence: z.enum(['high', 'medium', 'low']).optional().default('high'),
      aliasesToCreate: z.array(z.string()).optional(),
      reason: z.string()
    }).passthrough(),
    z.object({
      type: z.literal('merge_duplicates'),
      winnerFdcId: coercedId,
      loserFdcIds: z.array(coercedId),
      confidence: z.enum(['high', 'medium', 'low']).optional().default('high'),
      reason: z.string()
    }).passthrough(),
    z.object({
      type: z.literal('normalize_basis'),
      fdcId: coercedId.optional().nullable(),
      fromBasis: z.string().optional().nullable(),
      toBasis: z.string().optional().nullable(),
      conversionFactor: z.number().optional().nullable(),
      query: z.string().optional().nullable(),
      parametricFdcId: coercedId.optional().nullable(),
      parametricFoodName: z.string().optional().nullable(),
      catalogType: z.enum(['commodity', 'brand']).optional(),
      confidence: z.enum(['high', 'medium', 'low']).optional().default('high'),
      aliasesToCreate: z.array(z.string()).optional(),
      reason: z.string().optional().default('')
    }).passthrough(),
    z.object({
      type: z.literal('quarantine'),
      fdcId: coercedId,
      reason: z.string()
    }).passthrough()
  ]))
}).passthrough();

export const FoodCuratorActionSchema = z.preprocess((raw: any) => {
  const normalized = Array.isArray(raw) ? { actions: raw } : raw;
  if (normalized && typeof normalized === 'object' && Array.isArray(normalized.actions)) {
    return {
      ...normalized,
      actions: normalized.actions.map((a: any) => {
        if (!a || typeof a !== 'object') return a;
        const typeVal = a.type || a.Type || a.action || a.Action || 'pick_existing';
        const reasonVal = a.reason || a.Reason || a.reasonText || a.ReasonText || '';
        const queryVal = a.query || a.Query || '';
        const fdcIdVal = a.fdcId || a.FdcId || a.fdc_id || a.chosenFdcId || a.chosen_fdc_id || '';
        const chosenFdcIdVal = a.chosenFdcId || a.chosen_fdc_id || a.fdcId || a.FdcId || '';
        const confVal = (a.confidence || a.Confidence || 'high').toLowerCase();
        return {
          ...a,
          type: typeVal,
          reason: reasonVal,
          query: queryVal,
          fdcId: fdcIdVal,
          chosenFdcId: chosenFdcIdVal,
          confidence: ['high', 'medium', 'low'].includes(confVal) ? confVal : 'high'
        };
      })
    };
  }
  return normalized;
}, FoodCuratorActionSchemaRaw);

export const foodResolverCuratorInstruction = `You are the Master Curator of the AI Studio Food Database.
Your mandate is to resolve identity conflicts, deduplicate rows, and normalize data bases.

1. PARAMETRIC USDA MEMORY & ZERO-CANDIDATE GAP RESOLUTION: For standard generic USDA clinical foods (e.g. raw avocado, hard-boiled egg, grilled chicken breast, flour tortilla, falafel, feta cheese, raw onion, raw red pepper), populate 'parametricFoodName' using a highly descriptive standard clinical name (e.g. "Avocados, raw, all commercial varieties" or "Egg, whole, cooked, hard-boiled"). If you are 100% confident in the exact 6-digit USDA database FDC ID, supply it in 'parametricFdcId'; otherwise, set 'parametricFdcId' to null. Do NOT guess or hallucinate 6-digit FDC IDs. All standard USDA items are 100g by definition — NEVER emit 'normalize_basis' for USDA or generic commodity items.
2. STRICT CASE ISOLATION (ANTI-REUSE RULE): You must resolve each case in the batch independently. Do NOT copy, repeat, or reuse the same 'parametricFdcId' across different food queries unless the queries refer to the exact same ingredient. Repeating FDC IDs across unrelated cases is a severe database defect.
3. CANDIDATE EVALUATION: When parametric ID is not known, select the best candidate ('chosenFdcId') from the provided candidates list.
4. CONFIDENCE & ALIASES: Provide a 'confidence' ('high' | 'medium' | 'low') and list new normalized search aliases in 'aliasesToCreate'. High-confidence aliases are saved permanently.
5. DUPLICATE MERGING & QUARANTINE: Merge duplicate candidate rows ('merge_duplicates') by picking 1 winner and listing loser IDs. Quarantine impossible or severely mismatched candidates ('quarantine').
6. CATALOG ROUTING: Set 'catalogType' to 'commodity' for generic items or 'brand' for restaurant/packaged items.
7. CRITICAL JSON SYNTAX RULE: Every property key MUST be strictly lowercase and double-quoted in valid JSON format (e.g. "type", "query", "chosenFdcId", "confidence", "reason"). Output a single JSON object {"actions": [...]}.
`;
