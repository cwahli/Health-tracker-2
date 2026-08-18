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
    const extraQuarantines: any[] = [];
    const sanitizedActions = normalized.actions.map((a: any) => {
      if (!a || typeof a !== 'object') return a;
      
      let typeVal = a.type || a.Type || a.action || a.Action || 'pick_existing';
      if (!['pick_existing', 'merge_duplicates', 'normalize_basis', 'quarantine'].includes(typeVal)) {
        typeVal = 'pick_existing';
      }

      const reasonVal = a.reason || a.Reason || a.reasonText || a.ReasonText || 'Curated action';
      const queryVal = a.query || a.Query || '';
      const fdcIdVal = a.fdcId || a.FdcId || a.fdc_id || a.chosenFdcId || a.chosen_fdc_id || '0';
      const chosenFdcIdVal = a.chosenFdcId || a.chosen_fdc_id || a.fdcId || a.FdcId || null;
      const confVal = (a.confidence || a.Confidence || 'high').toLowerCase();

      if (a.quarantine) {
        const qList = Array.isArray(a.quarantine) ? a.quarantine : [a.quarantine];
        for (const qId of qList) {
          if (qId != null && qId !== '') {
            extraQuarantines.push({
              type: 'quarantine',
              fdcId: String(qId),
              reason: `Quarantined by curator for query "${queryVal}": ${reasonVal}`
            });
          }
        }
      }

      const baseObj: any = {
        ...a,
        type: typeVal,
        reason: reasonVal,
        query: queryVal,
        fdcId: fdcIdVal,
        chosenFdcId: chosenFdcIdVal,
        confidence: ['high', 'medium', 'low'].includes(confVal) ? confVal : 'high'
      };

      if (typeVal === 'merge_duplicates') {
        baseObj.winnerFdcId = a.winnerFdcId || a.winner_fdc_id || fdcIdVal || '0';
        baseObj.loserFdcIds = Array.isArray(a.loserFdcIds) ? a.loserFdcIds : (a.loserFdcId ? [a.loserFdcId] : []);
      }

      if (typeVal === 'quarantine') {
        baseObj.fdcId = fdcIdVal || '0';
      }

      return baseObj;
    });

    return {
      ...normalized,
      actions: [...sanitizedActions, ...extraQuarantines]
    };
  }
  return normalized;
}, FoodCuratorActionSchemaRaw);

export const foodResolverCuratorInstruction = `You are the Master Curator of the AI Studio Food Database.
Your mandate is to resolve identity conflicts, deduplicate rows, and normalize data bases.

1. PARAMETRIC USDA MEMORY & ZERO-CANDIDATE GAP RESOLUTION: For standard generic USDA clinical foods (e.g. raw avocado, hard-boiled egg, grilled chicken breast, flour tortilla, falafel, feta cheese, raw onion, raw red pepper):
  a. Output 'parametricFoodName' and supply the standard 6-digit FDC ID in 'parametricFdcId' if you are confident in the canonical USDA record.
  b. If uncertain of the exact 6-digit FDC ID, set 'parametricFdcId' to null, but supply a clean 2-3 word canonical search string in 'parametricFoodName' (e.g., "plain whole milk yogurt" or "granola with mixed nuts"). All standard USDA items are 100g by definition — NEVER emit 'normalize_basis' for USDA or generic commodity items. Do NOT use inverted comma syntax (avoid "Yogurt, plain" or "Cereals, granola").
2. STRICT CASE ISOLATION (ANTI-REUSE RULE): You must resolve each case in the batch independently. Do NOT copy, repeat, or reuse the same 'parametricFdcId' across different food queries unless the queries refer to the exact same ingredient. Repeating FDC IDs across unrelated cases is a severe database defect.
3. CANDIDATE EVALUATION: When parametric ID is not known, select the best candidate ('chosenFdcId') from the provided candidates list.
4. CONFIDENCE & ALIASES: Provide a 'confidence' ('high' | 'medium' | 'low') and list new normalized search aliases in 'aliasesToCreate'. High-confidence aliases are saved permanently. Do NOT create aliases for already canonical names.
5. DUPLICATE MERGING & QUARANTINE: Merge duplicate candidate rows ('merge_duplicates') by picking 1 winner and listing loser IDs. Quarantine impossible or severely mismatched candidates ('quarantine').
6. CATALOG ROUTING & ANTI-COMBINE: Set 'catalogType' to 'commodity' or 'brand'. NEVER combine multiple distinct foods (e.g. 'croissant and pain au raisin') into a single item — decompose conjoined foods into their basic canonical food components for composite meal modeling.
7. CRITICAL JSON SYNTAX RULE: Every property key MUST be strictly lowercase and double-quoted in valid JSON format (e.g. "type", "query", "chosenFdcId", "confidence", "reason"). Output a single JSON object {"actions": [...]}.`;
