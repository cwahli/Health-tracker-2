/**
 * Parse pasted YOLK / VMOS-style nutrition panel text into a brand menu item.
 *
 * Example paste:
 *   Bang-Bang Shroom 🌱🌱(ve)
 *
 *   Freshly-roasted mushrooms, almond bang-bang sauce, ...
 *
 *   Overview
 *   Nutrition
 *   Energy (kcal)
 *   620
 *   Fats
 *   31.3g
 *   ...
 */

export type ParsedMenuPaste = {
  dish_name: string;
  description: string;
  nutrients: Record<string, number>;
  serving_grams: number | null;
  notes: string;
  warnings: string[];
};

function numFrom(line: string): number | null {
  const m = String(line).replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function energyFromText(str: string): number | null {
  const s = String(str).replace(/,/g, '').trim();
  const kcalMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kcal/i);
  if (kcalMatch) {
    const n = parseFloat(kcalMatch[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const kjMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kj/i);
  if (kjMatch) {
    const kj = parseFloat(kjMatch[1]);
    if (Number.isFinite(kj) && kj > 0) {
      return Math.round((kj / 4.184) * 10) / 10;
    }
  }
  return numFrom(s);
}

function isSectionHeader(line: string): boolean {
  return /^(overview|nutrition|allergens|ingredients|details)$/i.test(line.trim());
}

function isNutrientLabel(line: string): string | null {
  const t = line.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^energy\s*\(kcal\)|^energy\s*kcal|^calories?\b/.test(t)) return 'calories';
  if (/^energy\s*\(kj\)|^energy\s*kj/.test(t)) return 'energyKj'; // ignored for storage
  if (/^fats?\b|^total\s*fat/.test(t) && !/saturat/.test(t)) return 'totalFat';
  if (/saturat/.test(t)) return 'saturatedFat';
  if (/^carbs?\b|^carbohydrates?\b/.test(t) && !/sugar/.test(t)) return 'carbohydrates';
  if (/sugar/.test(t)) return 'sugar';
  if (/^proteins?\b/.test(t)) return 'protein';
  if (/^fibres?\b|^fibers?\b|^total\s*fibre|^total\s*fiber/.test(t)) return 'totalFibre';
  if (/^salt\b/.test(t)) return 'salt';
  if (/^sodium\b/.test(t)) return 'sodium';
  if (/serving\s*size|portion/.test(t)) return 'serving';
  return null;
}

/**
 * Parse free-text nutrition panel (title + description + nutrient rows).
 */
export function parseMenuNutritionPaste(raw: string): ParsedMenuPaste {
  const warnings: string[] = [];
  const lines = String(raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => {
      // keep single blanks collapsed later for description
      return true;
    });

  const nonEmpty = lines.filter((l) => l.length > 0);
  if (!nonEmpty.length) {
    return {
      dish_name: '',
      description: '',
      nutrients: {},
      serving_grams: null,
      notes: '',
      warnings: ['Empty paste'],
    };
  }

  // Title = first non-empty line (keep dietary tags like (ve), strip excessive emoji optional)
  let dish_name = nonEmpty[0]
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '') // emoji
    .replace(/\s+/g, ' ')
    .trim();
  // If title becomes empty after emoji strip, fall back
  if (!dish_name) dish_name = nonEmpty[0];

  // Description: lines after title until Overview/Nutrition or first nutrient label
  const descParts: string[] = [];
  let i = 1;
  // find index of first non-empty after title in original nonEmpty
  for (; i < nonEmpty.length; i++) {
    const line = nonEmpty[i];
    if (isSectionHeader(line)) {
      i++;
      break;
    }
    if (isNutrientLabel(line)) break;
    // skip pure "Overview" already handled
    descParts.push(line);
  }

  // Skip further section headers
  while (i < nonEmpty.length && isSectionHeader(nonEmpty[i])) i++;

  const nutrients: Record<string, number> = {};
  let serving_grams: number | null = null;
  let saltG: number | null = null;

  // Parse label / value pairs (value on same line or next line)
  for (; i < nonEmpty.length; i++) {
    const line = nonEmpty[i];
    if (isSectionHeader(line)) continue;

    // Same-line: "Energy (kcal) 620" or "Fats 31.3g"
    const same = line.match(
      /^(energy\s*\(kcal\)|energy\s*kcal|calories?|fats?|total\s*fat|carbs?|carbohydrates?|proteins?|fibres?|fibers?|salt|sodium|of which saturates|saturated(?:\s*fat)?|of which sugars|sugars?|serving\s*size)\s*[:\s]+(.+)$/i
    );
    if (same) {
      const key = isNutrientLabel(same[1]) || isNutrientLabel(line);
      const val = key === 'calories' || key === 'energyKj' ? energyFromText(same[2]) : numFrom(same[2]);
      if (key && val != null) {
        if (key === 'serving') serving_grams = val;
        else if (key === 'salt') saltG = val;
        else if (key === 'calories' || key === 'energyKj') {
          if (nutrients.calories == null) nutrients.calories = val;
        } else nutrients[key] = val;
      }
      continue;
    }

    const key = isNutrientLabel(line);
    if (!key) continue;

    // Value on next line
    const next = nonEmpty[i + 1];
    if (!next) continue;
    // Don't consume if next is another label
    if (isNutrientLabel(next) || isSectionHeader(next)) continue;
    const val = key === 'calories' || key === 'energyKj' ? energyFromText(next) : numFrom(next);
    if (val == null) continue;
    i++; // consume value line
    if (key === 'serving') serving_grams = val;
    else if (key === 'salt') saltG = val;
    else if (key === 'calories' || key === 'energyKj') {
      if (nutrients.calories == null) nutrients.calories = val;
    } else nutrients[key] = val;
  }

  // Salt g → sodium mg (1g salt ≈ 400mg sodium) if sodium not already set
  if (saltG != null) {
    nutrients.salt = saltG;
    if (nutrients.sodium == null) {
      nutrients.sodium = Math.round(saltG * 400 * 10) / 10;
    }
  }

  if (nutrients.calories == null) warnings.push('No calories (kcal) found');
  if (nutrients.protein == null) warnings.push('No protein found');
  if (nutrients.carbohydrates == null) warnings.push('No carbs found');
  if (nutrients.totalFat == null) warnings.push('No fat found');

  const description = descParts.join(' ').replace(/\s+/g, ' ').trim();
  const cleanedDesc = cleanDescriptionText(description);

  return {
    dish_name,
    description: cleanedDesc,
    nutrients,
    serving_grams,
    notes: cleanedDesc,
    warnings,
  };
}

/** Parse a multi-dish pasted menu blob (e.g. copy-pasted from a restaurant's website/PDF).
 *  Supports "Dish Name (XXX kcal)" headers followed by an "Ingredients:" line and an optional
 *  "Nutrient Profile:" line. Falls back to the single-item parser if no such headers are found,
 *  so pasting one dish still works exactly as before. Section-header-only lines (no kcal, no
 *  ingredients) are silently skipped. */
export function parseMenuNutritionBulkPaste(raw: string): {
  dishes: Array<{
    dish_name: string;
    description: string;
    nutrients: Record<string, number>;
    serving_grams: number | null;
    notes: string;
    warnings: string[];
  }>;
  warnings: string[];
} {
  const lines = String(raw || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim());

  const dishHeaderRe = /^(.+?)\s*\((\d+(?:\.\d+)?)\s*kcal\)$/i;
  const headerIdxs: number[] = [];
  lines.forEach((l, idx) => {
    if (l && dishHeaderRe.test(l)) headerIdxs.push(idx);
  });

  if (headerIdxs.length === 0) {
    // Not bulk format — fall back to treating the whole paste as one dish.
    const single = parseMenuNutritionPaste(raw);
    return {
      dishes: single.dish_name ? [single] : [],
      warnings: single.dish_name ? [] : ['Could not detect any dish in paste'],
    };
  }

  const dishes: Array<{
    dish_name: string;
    description: string;
    nutrients: Record<string, number>;
    serving_grams: number | null;
    notes: string;
    warnings: string[];
  }> = [];
  const globalWarnings: string[] = [];

  for (let h = 0; h < headerIdxs.length; h++) {
    const startIdx = headerIdxs[h];
    const endIdx = h + 1 < headerIdxs.length ? headerIdxs[h + 1] : lines.length;
    const headerMatch = lines[startIdx].match(dishHeaderRe);
    if (!headerMatch) continue;

    const dish_name = headerMatch[1].trim();
    const calories = parseFloat(headerMatch[2]);
    const blockLines = lines.slice(startIdx + 1, endIdx).filter((l) => l.length > 0);

    let description = '';
    const nutrients: Record<string, number> = { calories };
    const warnings: string[] = [];

    for (const line of blockLines) {
      const ingMatch = line.match(/^ingredients\s*:\s*(.+)$/i);
      if (ingMatch) {
        description = ingMatch[1].trim();
        continue;
      }
      const profileMatch = line.match(/^nutrient\s*profile\s*:\s*(.+)$/i);
      if (profileMatch) {
        const parts = profileMatch[1].split('|').map((p) => p.trim());
        for (const part of parts) {
          const kv = part.match(/^([a-zA-Z ]+?)\s*:\s*([\d.]+)\s*g?\s*(?:\(sodium\s*:\s*([\d.]+)\s*mg\))?/i);
          if (!kv) continue;
          const label = kv[1].trim().toLowerCase();
          const val = parseFloat(kv[2]);
          if (isNaN(val)) continue;
          if (/protein/.test(label)) nutrients.protein = val;
          else if (/carb/.test(label)) nutrients.carbohydrates = val;
          else if (/saturated/.test(label)) nutrients.saturatedFat = val;
          else if (/^fats?$/.test(label)) nutrients.totalFat = val;
          else if (/sugar/.test(label)) nutrients.sugar = val;
          else if (/fib(re|er)/.test(label)) nutrients.totalFibre = val;
          else if (/salt/.test(label)) {
            nutrients.salt = val;
            if (kv[3]) nutrients.sodium = parseFloat(kv[3]);
          }
        }
        continue;
      }
      if (!description) description = line;
      else description += ' ' + line;
    }

    if (nutrients.protein == null) warnings.push('No protein found');
    if (nutrients.carbohydrates == null) warnings.push('No carbs found');
    if (nutrients.totalFat == null) warnings.push('No fat found');

    const cleanedDesc = cleanDescriptionText(description);
    dishes.push({
      dish_name,
      description: cleanedDesc,
      nutrients,
      serving_grams: null,
      notes: cleanedDesc,
      warnings,
    });
  }

  return { dishes, warnings: globalWarnings };
}

export function cleanDescriptionText(raw: string): string {
  if (!raw) return '';
  let str = String(raw).trim();
  str = str.replace(/^description\s*:\s*/i, '');
  str = str.replace(/\s*salt:\s*[\d.]+g?\s*→\s*sodium\s*\d+mg.*$/i, '');
  str = str.replace(/\s*pasted from menu nutrition panel.*$/i, '');
  return str.trim();
}
