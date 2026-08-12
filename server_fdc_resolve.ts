import { calculateGenericTokenCoverage, evaluateGenericModifierInversionPenalty, evaluateUniversalCategoryDisparity } from './server_matching_engine.js';
import { supabaseAdmin } from './supabaseAdmin.js';

export function scoreCandidate(query: string, candidate: any): number {
  const qTokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const cName = (candidate.description || candidate.product_name || candidate.name || "").toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const cTokens = cName.split(/\s+/).filter(Boolean);
  
  const tokenCov = calculateGenericTokenCoverage(qTokens, cTokens);
  let score = tokenCov.ratio * 100;
  
  // Exact match bonus
  if (query.toLowerCase() === (candidate.description || "").toLowerCase()) {
    score += 30;
  } else if (tokenCov.allMatched) {
    score += 15;
  }
  
  // Penalties
  const invPenalty = evaluateGenericModifierInversionPenalty(query, candidate.description || "");
  score -= invPenalty;
  
  const catPenalty = evaluateUniversalCategoryDisparity(query, candidate.description || "");
  score -= catPenalty;
  
  return score;
}

export function rankAndClassifyCandidates(query: string, candidates: any[], threshold: number = 70) {
  if (!candidates || candidates.length === 0) return { resolveClass: 'MISS', survivors: [], bestMatch: null };

  const scored = candidates.map(c => ({ candidate: c, score: scoreCandidate(query, c) }));
  scored.sort((a, b) => b.score - a.score);
  
  const survivors = scored.filter(s => s.score >= threshold);
  
  let resolveClass = 'MISS';
  if (survivors.length === 1) resolveClass = 'HIT_UNIQUE';
  else if (survivors.length >= 2) resolveClass = 'MULTI_MATCH';
  
  return { 
    resolveClass, 
    survivors, 
    bestMatch: survivors.length > 0 ? survivors[0].candidate : null 
  };
}

export async function writeAliasIfHitUnique(resolveClass: string, query: string, bestMatch: any) {
  if (resolveClass === 'HIT_UNIQUE' && bestMatch) {
    const fdcId = bestMatch.fdcId || bestMatch.id;
    if (fdcId) {
      try {
        console.log(`[ResolveClass] HIT_UNIQUE for "${query}". Auto-aliasing to ${fdcId}.`);
        await supabaseAdmin.from('food_aliases').upsert({
          alias_name: query.toLowerCase().trim(),
          target_food_id: String(fdcId),
          hit_count: 1
        }, { onConflict: 'alias_name' });
      } catch (err) {
        console.warn(`[ResolveClass] Failed to write auto-alias for ${query}:`, err);
      }
    }
  }
}
