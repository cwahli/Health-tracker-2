import { FoodCuratorActionSchema, foodResolverCuratorInstruction } from './agents/foodResolverInstructions.js';
import { supabaseAdmin } from './supabaseAdmin.js';
import { extractBalancedJson } from './server_pure_helpers.js';

export async function executeFoodResolverCurator(
  gaps: Array<{ query: string; candidates: Array<{ id: string; name: string; source: string }> }>,
  addDebugLog: (msg: string) => void,
  callLLMFn: (prompt: string, sysInst: string) => Promise<string>
): Promise<Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number> }>> {
  
  if (!gaps || gaps.length === 0) return [];
  
  const MAX_GAPS = 8;
  const activeGaps = gaps.slice(0, MAX_GAPS);

  const casesText = activeGaps.map((g, i) => {
    return `CASE ${i + 1}:\nQuery: "${g.query}"\nCandidates:\n${g.candidates.map(c => ` - ID: ${c.id} | Name: ${c.name} | Source: ${c.source}`).join('\n')}\n`;
  }).join('\n---\n');

  const prompt = `Please curate the following database matches.\n\n${casesText}\n\nOutput a strict JSON matching the FoodCuratorActionSchema. Include 'pick_existing', 'merge_duplicates', 'normalize_basis', or 'quarantine' actions as appropriate for each case. Ensure 'chosenFdcId' in 'pick_existing' exactly matches one of the candidate IDs.`;

  let jsonResult;
  try {
    addDebugLog(`[CuratorCase] Calling LLM Curator with ${activeGaps.length} cases`);
    const llmOutput = await callLLMFn(prompt, foodResolverCuratorInstruction);
    const parsed = extractBalancedJson(llmOutput);
    if (!parsed) throw new Error("Failed to parse JSON from Curator LLM");
    jsonResult = FoodCuratorActionSchema.parse(JSON.parse(parsed));
  } catch (error) {
    addDebugLog(`[CuratorAction] Failed to execute curator: ${error}`);
    // Fallback: Just return the first candidate for each gap if LLM fails
    return activeGaps.map(g => ({
      query: g.query,
      chosenFdcId: g.candidates.length > 0 ? g.candidates[0].id : null
    }));
  }

  const results: Array<{ query: string; chosenFdcId: string | null }> = [];

  for (const gap of activeGaps) {
    const action = jsonResult.actions.find((a: any) => a.type === 'pick_existing' && (a.query.toLowerCase() === gap.query.toLowerCase()));
    
    if (action && action.type === 'pick_existing') {
      const chosenCandidate = gap.candidates.find(c => c.id === action.chosenFdcId);
      if (chosenCandidate) {
        addDebugLog(`[CuratorAction] pick_existing for "${gap.query}" -> ${action.chosenFdcId} (Reason: ${action.reason})`);
        results.push({ query: gap.query, chosenFdcId: action.chosenFdcId });
        
        if (action.aliasesToCreate && action.aliasesToCreate.length > 0) {
          for (const alias of action.aliasesToCreate) {
             const cleanAlias = alias.toLowerCase().trim();
             addDebugLog(`[AliasWrite] Creating alias "${cleanAlias}" -> ${action.chosenFdcId}`);
             try {
               await supabaseAdmin.from('food_aliases').upsert({
                 alias_key: cleanAlias,
                 target_food_id: String(action.chosenFdcId),
                 hit_count: 1
               }, { onConflict: 'alias_key' });
             } catch (e) {
               console.error(e);
             }
          }
        }
      } else {
        addDebugLog(`[CuratorAction] LLM hallucinated ID ${action.chosenFdcId} for "${gap.query}". Forging ignored.`);
        results.push({ query: gap.query, chosenFdcId: null });
      }
    } else {
      addDebugLog(`[CuratorAction] No pick_existing action found for "${gap.query}". Skipping.`);
      results.push({ query: gap.query, chosenFdcId: null });
    }
  }
  
  const merges = jsonResult.actions.filter((a: any) => a.type === 'merge_duplicates');
  for (const merge of merges) {
    addDebugLog(`[CuratorAction] Executing merge_duplicates -> winner ${merge.winnerFdcId}, losers [${merge.loserFdcIds.join(', ')}]. Reason: ${merge.reason}`);
    for (const loser of merge.loserFdcIds) {
      try {
        await supabaseAdmin.from('food_aliases').upsert({
          alias_key: `legacy_merge_${loser}`,
          target_food_id: String(merge.winnerFdcId),
          hit_count: 1
        }, { onConflict: 'alias_key' });
      } catch (e) {
        console.error(e);
      }
    }
  }
  
  
  const normalizations = jsonResult.actions.filter((a: any) => a.type === 'normalize_basis');
  for (const norm of normalizations) {
    addDebugLog(`[CuratorAction] normalize_basis for ${norm.fdcId} from ${norm.fromBasis} to ${norm.toBasis} (LLM factor: ${norm.conversionFactor}). Reason: ${norm.reason}`);
    try {
      await supabaseAdmin.from('food_items')
        .update({ basis_type: norm.toBasis }) // server recalculation would happen elsewhere, or we just update the metadata
        .eq('food_id', norm.fdcId);
    } catch (e) {
      console.error(e);
    }
  }

  const quarantines = jsonResult.actions.filter((a: any) => a.type === 'quarantine');
  for (const q of quarantines) {
     addDebugLog(`[CatalogQuarantine] Quarantined ${q.fdcId}. Reason: ${q.reason}`);
     try {
       await supabaseAdmin.from('food_items')
         .update({ status: 'quarantined' })
         .eq('food_id', q.fdcId);
     } catch (e) {
       console.error(e);
     }
  }


  return results;
}
