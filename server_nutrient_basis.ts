export type NutrientBasisType = 'per_100g' | 'per_serving' | 'per_dish' | 'per_pack' | 'total';

export function parseNutrientNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  if (typeof v === 'string') {
    const cleaned = v.trim().replace(/,/g, '');
    const match = cleaned.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (match) {
      const num = parseFloat(match[1]);
      return isNaN(num) ? null : num;
    }
  }
  return null;
}

export function inferBasisFromServingText(
  servingSizeRaw: string | null | undefined,
  estimatedWeightGrams?: number | null,
  assumeDishNotPackage: boolean = false
): { basisType: NutrientBasisType; servingGrams: number | null } {
  if (!servingSizeRaw) {
    // NUTRITION BASIS FIX (Aug 2026): only default to per_100g for packaged goods.
    // Restaurant/chain dish registrations pass assumeDishNotPackage=true because
    // an unlabeled number there is virtually always the whole-dish total, never a per-100g rate.
    if (assumeDishNotPackage) {
      const fallbackGrams = estimatedWeightGrams && estimatedWeightGrams > 0 ? estimatedWeightGrams : null;
      return { basisType: 'per_dish', servingGrams: fallbackGrams };
    }
    return { basisType: 'per_100g', servingGrams: 100 };
  }

  const rawLower = servingSizeRaw.toLowerCase().trim();

  if (rawLower.includes('100g') || rawLower.includes('100 ml') || rawLower.includes('100ml') || rawLower.includes('per 100g')) {
    return { basisType: 'per_100g', servingGrams: 100 };
  }

  const gramMatch = rawLower.match(/\b(\d+(?:\.\d+)?)\s*(?:g|ml)\b/i);
  if (gramMatch) {
    const g = parseFloat(gramMatch[1]);
    if (g === 100) {
      return { basisType: 'per_100g', servingGrams: 100 };
    }
    return { basisType: 'per_serving', servingGrams: g };
  }

  if (/\b(pack|dish|bowl|portion|container|pot|slice|pie|item|serving|bar|can|bottle)\b/i.test(rawLower)) {
    const fallbackGrams = estimatedWeightGrams && estimatedWeightGrams > 0 ? estimatedWeightGrams : null;
    return { basisType: 'per_dish', servingGrams: fallbackGrams };
  }

  return { basisType: 'per_100g', servingGrams: 100 };
}

export function scaleNutrientsToWeight(
  meta: {
    basisType: NutrientBasisType;
    servingGrams: number | null;
    nutrients: Record<string, number | null | undefined>;
  },
  consumedWeightGrams: number
): Record<string, number> {
  const scaled: Record<string, number> = {};
  if (!meta || !meta.nutrients) return scaled;

  let factor = 1;
  if (meta.basisType === 'per_100g' || meta.servingGrams === 100) {
    factor = consumedWeightGrams / 100;
  } else if (meta.servingGrams && meta.servingGrams > 0) {
    factor = consumedWeightGrams / meta.servingGrams;
  }

  for (const [key, val] of Object.entries(meta.nutrients)) {
    const num = parseNutrientNumber(val);
    if (num !== null) {
      if (key === 'calories' || key === 'sodium' || key === 'potassium') {
        scaled[key] = Math.round(num * factor);
      } else {
        scaled[key] = Math.round((num * factor) * 100) / 100;
      }
    }
  }

  return scaled;
}

export function toPer100g(meta: {
  basisType: NutrientBasisType;
  servingGrams: number | null;
  nutrients: Record<string, number | null | undefined>;
}): Record<string, number> {
  const res: Record<string, number> = {};
  if (!meta || !meta.nutrients) return res;

  if (meta.basisType === 'per_100g' || meta.servingGrams === 100) {
    for (const [key, val] of Object.entries(meta.nutrients)) {
      const num = parseNutrientNumber(val);
      if (num !== null) res[key] = num;
    }
    return res;
  }

  const servingGrams = meta.servingGrams;
  if (!servingGrams || servingGrams <= 0) {
    for (const [key, val] of Object.entries(meta.nutrients)) {
      const num = parseNutrientNumber(val);
      if (num !== null) res[key] = num;
    }
    return res;
  }

  const factor = 100 / servingGrams;
  for (const [key, val] of Object.entries(meta.nutrients)) {
    const num = parseNutrientNumber(val);
    if (num !== null) {
      if (key === 'calories' || key === 'sodium' || key === 'potassium') {
        res[key] = Math.round(num * factor);
      } else {
        res[key] = Math.round((num * factor) * 100) / 100;
      }
    }
  }

  return res;
}
