import re

with open('server_nutrient_basis.ts', 'r') as f:
    content = f.read()

implausible_gate = """
export function isPlausibleNutrients(nutrients100g: Record<string, number>): { valid: boolean; reason?: string } {
  const calories = nutrients100g.calories || 0;
  if (calories > 950) return { valid: false, reason: `Calories per 100g too high (${calories})` };
  
  const macros = ['protein', 'totalFat', 'fat', 'carbohydrates', 'carbs', 'totalFibre', 'sugar'];
  for (const macro of macros) {
    if (nutrients100g[macro] > 100.1) {
      return { valid: false, reason: `Macro ${macro} per 100g too high (${nutrients100g[macro]})` };
    }
  }
  
  if (nutrients100g.sodium > 100000) return { valid: false, reason: `Sodium per 100g too high (${nutrients100g.sodium})` };
  return { valid: true };
}

export function normalizeToPer100g(meta: {
  basisType: NutrientBasisType;
  servingGrams: number | null;
  packGrams?: number | null;
  portionsPerPack?: number | null;
  nutrients: Record<string, number | null | undefined>;
}): Record<string, number> {
  const res: Record<string, number> = {};
  if (!meta || !meta.nutrients) return res;
  
  let targetGrams = meta.servingGrams;
  if (meta.basisType === 'per_pack') {
    if (meta.packGrams && meta.packGrams > 0) {
      targetGrams = meta.packGrams;
    } else if (meta.servingGrams && meta.portionsPerPack && meta.portionsPerPack > 0) {
      targetGrams = meta.servingGrams * meta.portionsPerPack;
    }
  }

  if (meta.basisType === 'per_100g' || targetGrams === 100) {
    for (const [key, val] of Object.entries(meta.nutrients)) {
      const num = parseNutrientNumber(val);
      if (num !== null) res[key] = num;
    }
    return res;
  }
  
  if (!targetGrams || targetGrams <= 0) {
    // Cannot normalize reliably, just return raw
    for (const [key, val] of Object.entries(meta.nutrients)) {
      const num = parseNutrientNumber(val);
      if (num !== null) res[key] = num;
    }
    return res;
  }
  
  const factor = 100 / targetGrams;
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
"""

if "normalizeToPer100g" not in content:
    content += "\n" + implausible_gate

with open('server_nutrient_basis.ts', 'w') as f:
    f.write(content)
