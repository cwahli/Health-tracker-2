import { FoodCuratorActionSchema, foodResolverCuratorInstruction } from './agents/foodResolverInstructions.js';
import { supabaseAdmin } from './supabaseAdmin.js';
import { extractBalancedJson } from './server_pure_helpers.js';
import { lookupCanonicalBaseFood } from './server_food_db.js';

export function calculateTokenOverlap(strA: string, strB: string): number {
  if (!strA || !strB) return 0;
  const stopWords = new Set(['and', 'with', 'the', 'for', 'raw', 'fresh', 'prepared', 'cooked']);
  const tokensA = strA.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !stopWords.has(t));
  const tokensB = new Set(strB.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !stopWords.has(t)));
  if (tokensA.length === 0 || tokensB.size === 0) return 0;
  let matches = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) matches++;
  }
  return matches / tokensA.length;
}

export function hasCoreTokenOverlap(queryA: string, queryB: string): boolean {
  if (!queryA || !queryB) return false;
  const stopWords = new Set(['and', 'with', 'the', 'for', 'raw', 'fresh', 'prepared', 'cooked', 'canned', 'drained', 'solids', 'liquids', 'heavy', 'syrup', 'style']);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !stopWords.has(t));
  const tokensA = norm(queryA);
  const tokensB = norm(queryB);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  
  const setB = new Set(tokensB);
  for (const a of tokensA) {
    if (setB.has(a)) return true;
    for (const b of tokensB) {
      if (a.startsWith(b) || b.startsWith(a) || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4))) {
        return true;
      }
    }
  }
  return false;
}

function repairUnquotedJsonKeys(jsonStr: string): string {
  if (!jsonStr) return jsonStr;
  let s = jsonStr.trim();
  // Strip markdown code block wrappers if present
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  // Wrap unquoted property keys in double quotes (e.g. Reason: "..." -> "Reason": "...")
  s = s.replace(/(?:^|[{,\s])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, (match, key) => {
    if (match.includes('"')) return match;
    return match.replace(key, `"${key}"`);
  });
  // Clean trailing commas before closing braces/brackets
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

export async function executeFoodResolverCurator(
  gaps: Array<{ query: string; candidates: Array<{ id: string; name: string; source: string }> }>,
  addDebugLog: (msg: string) => void,
  callLLMFn: (prompt: string, sysInst: string) => Promise<string>,
  fetchNutrientsFn?: (fdcId: string) => Promise<Record<string, number> | null>
): Promise<Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number> }>> {
  
  if (!gaps || gaps.length === 0) return [];
  
  const MAX_GAPS = 8;
  const activeGaps = gaps.slice(0, MAX_GAPS).map(g => ({
    ...g,
    candidates: g.candidates.slice(0, 4) // Cap candidate pool to top 4 per gap query
  }));

  const casesText = activeGaps.map((g, i) => {
    const candsStr = g.candidates.length > 0
      ? g.candidates.map(c => ` - ID: ${c.id} | Name: ${c.name} | Source: ${c.source}`).join('\n')
      : ' - (No candidate matches found in database search API)';
    return `CASE ${i + 1}:\nQuery: "${g.query}"\nCandidates:\n${candsStr}\n`;
  }).join('\n---\n');

  const prompt = `Please curate the following database matches.\n\n${casesText}\n\nOutput a strict JSON object of the shape {"actions": [...]} matching the FoodCuratorActionSchema — do NOT output a bare array. Include 'pick_existing', 'merge_duplicates', 'normalize_basis', or 'quarantine' actions as appropriate for each case.`;

  let jsonResult;
  try {
    addDebugLog(`[CuratorCase] Calling LLM Curator with ${activeGaps.length} cases`);
    const llmOutput = await callLLMFn(prompt, foodResolverCuratorInstruction);
    const parsed = extractBalancedJson(llmOutput);
    if (!parsed) throw new Error("Failed to parse JSON from Curator LLM");
    const repairedJson = repairUnquotedJsonKeys(parsed);
    jsonResult = FoodCuratorActionSchema.parse(JSON.parse(repairedJson));
  } catch (error) {
    addDebugLog(`[CuratorAction] Failed to execute curator: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
    // Fallback: Return top candidate if available
    return activeGaps.map(g => ({
      query: g.query,
      chosenFdcId: g.candidates.length > 0 ? g.candidates[0].id : null
    }));
  }

  const results: Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number> }> = [];

  for (const gap of activeGaps) {
    const gapQueryClean = gap.query.toLowerCase().trim();
    const action = jsonResult.actions.find((a: any) => {
      if (a.type !== 'pick_existing' && a.type !== 'normalize_basis') return false;
      const actQueryClean = a.query ? a.query.toLowerCase().trim() : '';
      if (actQueryClean && actQueryClean === gapQueryClean) return true;
      if (actQueryClean && (calculateTokenOverlap(actQueryClean, gapQueryClean) >= 0.3 || hasCoreTokenOverlap(actQueryClean, gapQueryClean))) return true;
      if (a.chosenFdcId && gap.candidates.some(c => String(c.id) === String(a.chosenFdcId))) return true;
      if (a.parametricFdcId && /^\d{5,8}$/.test(String(a.parametricFdcId))) return true;
      return false;
    });
    
    if (action && (action.type === 'pick_existing' || action.type === 'normalize_basis')) {
      let finalChosenId: string | null = null;
      
      // 1. Try to resolve via local deterministic dictionary first (Safe Canonical Mapping)
      const localMatch = lookupCanonicalBaseFood(action.parametricFoodName || gap.query);
      if (localMatch && localMatch.fdcId) {
        addDebugLog(`[LocalDictionaryMatch] Resolved locally for "${gap.query}" -> FDC ${localMatch.fdcId} ("${action.parametricFoodName || gap.query}")`);
        finalChosenId = String(localMatch.fdcId);
      }
      
      // 2. Check Parametric FDC ID with Semantic Verification Gate
      if (!finalChosenId && action.parametricFdcId) {
        const paramIdStr = String(action.parametricFdcId);
        const paramName = action.parametricFoodName || gap.query;
        const overlap = calculateTokenOverlap(gap.query, paramName);
        const coreMatch = hasCoreTokenOverlap(gap.query, paramName);
        
        if (overlap >= 0.30 || coreMatch) {
          addDebugLog(`[ParametricVerification] PASSED for "${gap.query}" -> FDC ${paramIdStr} ("${paramName}", overlap: ${(overlap * 100).toFixed(0)}%, coreMatch: ${coreMatch})`);
          finalChosenId = paramIdStr;
        } else {
          addDebugLog(`[ParametricVerification] REJECTED for "${gap.query}" -> FDC ${paramIdStr} ("${paramName}", overlap: ${(overlap * 100).toFixed(0)}% < 30%). Falling back to candidate.`);
        }
      }
      
      // 3. Fall back to chosen candidate if parametric omitted/rejected
      if (!finalChosenId && action.chosenFdcId) {
        const chosenCandidate = gap.candidates.find(c => String(c.id) === String(action.chosenFdcId));
        if (chosenCandidate) {
          finalChosenId = String(action.chosenFdcId);
        } else if ((!gap.candidates || gap.candidates.length === 0) && /^\d{5,8}$/.test(String(action.chosenFdcId))) {
          const paramName = action.parametricFoodName || gap.query;
          const overlap = calculateTokenOverlap(gap.query, paramName);
          const coreMatch = hasCoreTokenOverlap(gap.query, paramName);
          if (overlap >= 0.30 || coreMatch) {
            finalChosenId = String(action.chosenFdcId);
            addDebugLog(`[CuratorAction] Zero-candidate fallback: Accepted parametric FDC ID ${finalChosenId} from chosenFdcId for "${gap.query}".`);
          } else {
            addDebugLog(`[CuratorAction] Zero-candidate fallback REJECTED: FDC ${action.chosenFdcId} ("${paramName}") has low overlap with query "${gap.query}".`);
          }
        } else {
          addDebugLog(`[CuratorAction] LLM candidate ID ${action.chosenFdcId} not in candidate list for "${gap.query}". LLM hallucinated ID — Forging ignored.`);
        }
      }
      
      if (finalChosenId) {
        addDebugLog(`[CuratorAction] pick_existing for "${gap.query}" -> ${finalChosenId} (Reason: ${action.reason})`);
        let nutrientsPer100g: Record<string, number> | undefined = undefined;
        if (fetchNutrientsFn) {
          try {
            const nut = await fetchNutrientsFn(finalChosenId);
            if (nut) nutrientsPer100g = nut;
          } catch (e) {
            console.error(`[CuratorAction] Failed to fetch nutrients for ${finalChosenId}:`, e);
          }
        }
        results.push({ query: gap.query, chosenFdcId: finalChosenId, nutrientsPer100g });
        
        // 3. Persist aliases only on HIGH confidence
        if (action.confidence === 'high' && action.aliasesToCreate && action.aliasesToCreate.length > 0) {
          for (const alias of action.aliasesToCreate) {
             const cleanAlias = alias.toLowerCase().trim();
             addDebugLog(`[AliasWrite] Creating alias "${cleanAlias}" -> ${finalChosenId}`);
             try {
               await supabaseAdmin.from('food_aliases').upsert({
                 alias_key: cleanAlias,
                 target_food_id: finalChosenId,
                 hit_count: 1
               }, { onConflict: 'alias_key' });
             } catch (e) {
               console.error('[AliasWrite] Error persisting alias:', e);
             }
          }
        }
      } else {
        addDebugLog(`[CuratorAction] No verified candidate found for "${gap.query}".`);
        results.push({ query: gap.query, chosenFdcId: null });
      }
    } else {
      addDebugLog(`[CuratorAction] No pick_existing action found for "${gap.query}". Skipping.`);
      results.push({ query: gap.query, chosenFdcId: null });
    }
  }
  
  // 4. Soft-Merge Pointer Pattern for Duplicate Merges
  const merges = jsonResult.actions.filter((a: any) => a.type === 'merge_duplicates');
  for (const merge of merges) {
    if (merge.confidence === 'high') {
      addDebugLog(`[CuratorAction] Executing merge_duplicates -> winner ${merge.winnerFdcId}, losers [${merge.loserFdcIds.join(', ')}]. Reason: ${merge.reason}`);
      for (const loser of merge.loserFdcIds) {
        try {
          // Soft-merge: Update status and set canonical_target_id pointer
          await supabaseAdmin.from('food_items')
            .update({ status: 'merged_loser', canonical_target_id: String(merge.winnerFdcId) })
            .eq('food_id', String(loser));
            
          // Add single-hop redirection alias
          await supabaseAdmin.from('food_aliases').upsert({
            alias_key: `legacy_merge_${loser}`,
            target_food_id: String(merge.winnerFdcId),
            hit_count: 1
          }, { onConflict: 'alias_key' });
        } catch (e) {
          console.error('[MergeDuplicates] Error soft-merging loser:', e);
        }
      }
    }
  }
  
  const normalizations = jsonResult.actions.filter((a: any) => a.type === 'normalize_basis');
  for (const norm of normalizations) {
    if (!norm.fdcId || !norm.toBasis) continue;
    addDebugLog(`[CuratorAction] normalize_basis for ${norm.fdcId} from ${norm.fromBasis} to ${norm.toBasis} (factor: ${norm.conversionFactor}). Reason: ${norm.reason}`);
    try {
      await supabaseAdmin.from('food_items')
        .update({ basis_type: norm.toBasis })
        .eq('food_id', String(norm.fdcId));
    } catch (e) {
      console.error('[NormalizeBasis] Error updating basis:', e);
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
