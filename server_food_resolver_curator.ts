import { FoodCuratorActionSchema, foodResolverCuratorInstruction } from './agents/foodResolverInstructions.js';
import { supabaseAdmin } from './supabaseAdmin.js';
import { extractBalancedJson, checkCategoryAndStateCompatibility } from './server_pure_helpers.js';
import { lookupCanonicalBaseFood, CANONICAL_BASE_FOODS } from './server_food_db.js';

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
  const stopWords = new Set(['and', 'with', 'the', 'for', 'raw', 'fresh', 'prepared', 'cooked', 'canned', 'drained', 'solids', 'liquids', 'heavy', 'syrup', 'style', 'mixed', 'low', 'fat', 'free', 'sweet', 'spicy', 'hot', 'cold', 'large', 'small', 'medium', 'light', 'dark', 'green', 'red', 'yellow', 'blue', 'white', 'black', 'assorted', 'various', 'plain', 'regular', 'premium', 'extra', 'leaves', 'leaf', 'cut', 'pieces', 'chunks', 'slices', 'sliced', 'chopped', 'diced', 'minced', 'ground', 'whole', 'half', 'quarter', 'puree', 'paste', 'extract', 'powder', 'dried', 'dehydrated', 'roasted', 'baked', 'fried', 'boiled', 'steamed', 'grilled', 'smoked', 'cured', 'pickled', 'fermented', 'marinated', 'seasoned', 'unsalted', 'salted', 'sweetened', 'unsweetened', 'flavored', 'unflavored', 'artificial', 'natural', 'organic', 'conventional', 'gmo', 'non-gmo', 'gluten-free', 'vegan', 'vegetarian', 'kosher', 'halal', 'dairy-free', 'nut-free', 'soy-free', 'egg-free', 'wheat-free', 'sugar-free', 'fat-free', 'cholesterol-free', 'sodium-free', 'calorie-free']);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !stopWords.has(t));
  const tokensA = norm(queryA);
  const tokensB = norm(queryB);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  
  let matches = 0;
  const setB = new Set(tokensB);
  for (const a of tokensA) {
    if (setB.has(a)) {
      matches++;
    } else {
      for (const b of tokensB) {
        if ((a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4))) {
          matches++;
          break;
        }
      }
    }
  }
  return matches >= 1 && matches >= (Math.min(tokensA.length, tokensB.length) / 2);
}

export function calculateFuzzyTokenSimilarity(query: string, target: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const qTokens = norm(query);
  const tTokens = norm(target);
  if (qTokens.length === 0 || tTokens.length === 0) return 0;

  let matches = 0;
  for (const t of tTokens) {
    if (qTokens.some(q => q === t || q + 's' === t || t + 's' === q || (q.length > 3 && t.startsWith(q)) || (t.length > 3 && q.startsWith(t)))) {
      matches++;
    }
  }
  return matches / tTokens.length;
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
  fetchNutrientsFn?: (fdcId: string) => Promise<Record<string, number> | null>,
  searchUSDAFn?: (query: string) => Promise<any[]>
): Promise<Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number>; quarantinedIds?: string[] }>> {
  
  if (!gaps || gaps.length === 0) return [];

  const MAX_GAPS = 8;
  const allGapsCapped = gaps.map(g => ({
    ...g,
    candidates: g.candidates.slice(0, 4) // Cap candidate pool to top 4 per gap query
  }));
  // Chunked dispatch: process every gap item in batches of MAX_GAPS rather than silently
  // truncating the tail of the list (this previously caused items like "Cinnamon pastry roll"
  // to never reach the curator at all when the batch exceeded 8 items). Results, aliases,
  // merges and quarantines are accumulated across all chunks below.
  const gapChunks: (typeof allGapsCapped)[] = [];
  for (let i = 0; i < allGapsCapped.length; i += MAX_GAPS) {
    gapChunks.push(allGapsCapped.slice(i, i + MAX_GAPS));
  }

  const allResults: Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number>; quarantinedIds?: string[] }> = [];

  for (const activeGaps of gapChunks) {

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
    // Fallback: use top category-compatible candidate if available for this chunk, then
    // continue with the remaining chunks instead of aborting the whole batch.
    allResults.push(...activeGaps.map(g => {
      const validCand = g.candidates.find(c => checkCategoryAndStateCompatibility(g.query, c.name).compatible);
      return {
        query: g.query,
        chosenFdcId: validCand ? validCand.id : null
      };
    }));
    continue;
  }

  const results: Array<{ query: string; chosenFdcId: string | null; formTags?: string[]; dishCore?: Record<string, number>; nutrientsPer100g?: Record<string, number>; quarantinedIds?: string[] }> = [];

  const quarantinedFdcIds = new Set<string>();
  jsonResult.actions.forEach((a: any) => {
    if (a.type === 'quarantine' && a.fdcId) {
      quarantinedFdcIds.add(String(a.fdcId));
    }
  });

  const currentQuarantineList = Array.from(quarantinedFdcIds);
  const globalAliasesToUpsert = new Map<string, string>(); // alias_key -> target_food_id
  
  for (const gap of activeGaps) {
    const gapQueryClean = gap.query.toLowerCase().trim();
    // Pass 1: exact query match only. This MUST run across the whole actions array before any
    // fuzzy matching is attempted, otherwise Array.find() can bind a gap to the wrong case
    // (e.g. "crispy fried chicken" incorrectly binding to the "grilled chicken breast" action
    // because they share the single token "chicken" and the old single-pass fuzzy check fired
    // before the correct exact-match case later in the array was ever reached).
    let action = jsonResult.actions.find((a: any) => {
      if (a.type !== 'pick_existing' && a.type !== 'normalize_basis') return false;
      const actQueryClean = a.query ? a.query.toLowerCase().trim() : '';
      return actQueryClean !== '' && actQueryClean === gapQueryClean;
    });
    // Pass 2: fuzzy fallback, only if no exact match exists anywhere in the batch. Requires BOTH
    // a meaningful overlap ratio AND core-token agreement so a single shared generic word (e.g.
    // "chicken") can no longer bind two unrelated cases together.
    if (!action) {
      action = jsonResult.actions.find((a: any) => {
        if (a.type !== 'pick_existing' && a.type !== 'normalize_basis') return false;
        const actQueryClean = a.query ? a.query.toLowerCase().trim() : '';
        if (actQueryClean && calculateTokenOverlap(actQueryClean, gapQueryClean) >= 0.6 && hasCoreTokenOverlap(actQueryClean, gapQueryClean)) return true;
        if (!actQueryClean && a.chosenFdcId && gap.candidates.some(c => String(c.id) === String(a.chosenFdcId))) return true;
        return false;
      });
    }
    
    if (action && (action.type === 'pick_existing' || action.type === 'normalize_basis')) {
      let finalChosenId: string | null = null;

      // 1. High-confidence curator parametric matches take precedence over the local static
      // dictionary. The curator already reasons over the full query context (e.g. "breaded and
      // fried" vs "grilled"), while the local dictionary is a coarse keyword-substring lookup
      // that can silently overwrite a correct, more specific curator pick.
      if (action.confidence === 'high' && action.parametricFdcId) {
        const paramIdStr = String(action.parametricFdcId);
        const paramName = action.parametricFoodName || gap.query;
        const overlap = calculateTokenOverlap(gap.query, paramName);
        const coreMatch = hasCoreTokenOverlap(gap.query, paramName);

        if (overlap >= 0.30 || coreMatch) {
          addDebugLog(`[ParametricVerification] PASSED (high-confidence, priority) for "${gap.query}" -> FDC ${paramIdStr} ("${paramName}", overlap: ${(overlap * 100).toFixed(0)}%, coreMatch: ${coreMatch})`);
          finalChosenId = paramIdStr;
        } else {
          addDebugLog(`[ParametricVerification] REJECTED for "${gap.query}" -> FDC ${paramIdStr} ("${paramName}", overlap: ${(overlap * 100).toFixed(0)}% < 30%). Falling back to local dictionary/candidate.`);
        }
      }

      // 2. Local deterministic dictionary (Safe Canonical Mapping) — only consulted when the
      // curator did not supply a verified high-confidence parametric match above.
      if (!finalChosenId) {
        const localMatch = lookupCanonicalBaseFood(action.parametricFoodName || gap.query);
        if (localMatch && localMatch.fdcId) {
          addDebugLog(`[LocalDictionaryMatch] Resolved locally for "${gap.query}" -> FDC ${localMatch.fdcId} ("${action.parametricFoodName || gap.query}")`);
          finalChosenId = String(localMatch.fdcId);
        }
      }

      // 2b. Medium/low-confidence parametric FDC ID with Semantic Verification Gate (only if
      // neither the priority high-confidence check nor the local dictionary resolved it).
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

      // 3b. Option 3 Backend Fallback: Search USDA API if FDC ID is null but parametricFoodName is populated
      if (!finalChosenId && action.parametricFoodName && searchUSDAFn) {
        addDebugLog(`[Backend Fallback Search] Searching USDA for parametricFoodName: "${action.parametricFoodName}" (Original query: "${gap.query}")...`);
        try {
          const searchHits = await searchUSDAFn(action.parametricFoodName);
          if (searchHits && searchHits.length > 0) {
            const firstHit = searchHits.find(h => checkCategoryAndStateCompatibility(gap.query, h.description || '').compatible);
            if (firstHit) {
              const hitIdStr = String(firstHit.fdcId);
              const hitDescription = firstHit.description || "";
              const overlap = calculateTokenOverlap(action.parametricFoodName, hitDescription);
              
              if (overlap >= 0.25 || hasCoreTokenOverlap(action.parametricFoodName, hitDescription)) {
                addDebugLog(`[Backend Fallback Search] MATCH FOUND: "${action.parametricFoodName}" -> FDC ${hitIdStr} ("${hitDescription}", overlap: ${(overlap * 100).toFixed(0)}%)`);
                finalChosenId = hitIdStr;
              } else {
                addDebugLog(`[Backend Fallback Search] Weak match discarded: FDC ${hitIdStr} ("${hitDescription}") has low overlap with "${action.parametricFoodName}".`);
              }
            } else {
              addDebugLog(`[Backend Fallback Search] No category-compatible USDA hits found for "${action.parametricFoodName}".`);
            }
          } else {
            addDebugLog(`[Backend Fallback Search] No USDA hits found for "${action.parametricFoodName}".`);
          }
        } catch (err) {
          addDebugLog(`[Backend Fallback Search] Error during fallback search: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 3c. Filter out quarantined or category-incompatible candidate choices
      if (finalChosenId) {
        if (quarantinedFdcIds.has(finalChosenId)) {
          addDebugLog(`[CuratorAction] REJECTED candidate ${finalChosenId} for "${gap.query}" because it was explicitly quarantined.`);
          finalChosenId = null;
        } else {
          const candObj = gap.candidates.find(c => String(c.id) === String(finalChosenId));
          const candName = candObj ? candObj.name : (action.parametricFoodName || gap.query);
          const compat = checkCategoryAndStateCompatibility(gap.query, candName);
          if (!compat.compatible) {
            addDebugLog(`[CuratorAction] REJECTED candidate ${finalChosenId} ("${candName}") for "${gap.query}": ${compat.reason}`);
            finalChosenId = null;
          }
        }
      }

      // 3d. Final fallback to category-compatible candidate in gap pool
      if (!finalChosenId && gap.candidates.length > 0) {
        const validCand = gap.candidates.find(c => !quarantinedFdcIds.has(String(c.id)) && checkCategoryAndStateCompatibility(gap.query, c.name).compatible);
        if (validCand) {
          finalChosenId = String(validCand.id);
          addDebugLog(`[CuratorAction] Category-compatible candidate fallback for "${gap.query}" -> FDC ${finalChosenId} ("${validCand.name}")`);
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
        results.push({ query: gap.query, chosenFdcId: finalChosenId, nutrientsPer100g, quarantinedIds: currentQuarantineList });
        
        // 4. Persist aliases for the curated query and listed aliases to build a self-learning database
        const aliasesSet = new Set<string>();
        if (action.aliasesToCreate) {
          action.aliasesToCreate.forEach(a => aliasesSet.add(a.toLowerCase().trim()));
        }
        aliasesSet.add(gap.query.toLowerCase().trim());
        if (action.parametricFoodName) {
          aliasesSet.add(action.parametricFoodName.toLowerCase().trim());
        }

        for (const alias of aliasesSet) {
           const cleanAlias = alias.toLowerCase().trim();
           if (!globalAliasesToUpsert.has(cleanAlias)) {
             globalAliasesToUpsert.set(cleanAlias, finalChosenId);
           }
        }
      } else {
        addDebugLog(`[CuratorAction] No verified candidate found for "${gap.query}".`);
        results.push({ query: gap.query, chosenFdcId: null, quarantinedIds: currentQuarantineList });
      }
    } else {
      addDebugLog(`[CuratorAction] No pick_existing action found for "${gap.query}". Skipping.`);
      results.push({ query: gap.query, chosenFdcId: null, quarantinedIds: currentQuarantineList });
    }
  }

  if (globalAliasesToUpsert.size > 0) {
    for (const [cleanAlias, targetId] of globalAliasesToUpsert.entries()) {
       addDebugLog(`[AliasWrite] Creating alias "${cleanAlias}" -> ${targetId}`);
       try {
         await supabaseAdmin.from('food_aliases').upsert({
           alias_key: cleanAlias,
           target_food_id: targetId,
           hit_count: 1
         }, { onConflict: 'alias_key' });
       } catch (e) {
         console.error('[AliasWrite] Error persisting alias:', e);
       }
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


  allResults.push(...results);
  } // end for (const activeGaps of gapChunks)

  return allResults;
}
