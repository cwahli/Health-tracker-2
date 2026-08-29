export { scoutSystemInstruction } from '../server_vision_scout.js';

export function buildVisualScoutPrompt(message: string, imageCount: number): string {
  const cleanMsg = (message || '').replace(/\[+[^\]]+\]+/g, '').replace(/\s+/g, ' ').trim();
  const normalizedWords = cleanMsg.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'"“”]/g, '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const genericTokens = new Set(['i', 'had', 'have', 'ate', 'eaten', 'and', 'with', 'all', 'the', 'food', 'foods', 'dish', 'dishes', 'item', 'items', 'in', 'picture', 'pictures', 'photo', 'photos', 'image', 'images', 'log', 'meal', 'scan', 'analyze', 'this', 'that', 'for', 'my']);
  const isGeneric = !cleanMsg || normalizedWords.length === 0 || normalizedWords.every(w => genericTokens.has(w));
  const multiImageRule = imageCount > 1 
    ? " Audit every image independently and extract distinct food items seen across ALL images. Do not stop after analyzing a label."
    : "";
  const baseInstruction = `Analyze the provided ${imageCount > 1 ? imageCount + ' meal images' : 'meal image'}. Inspect all visible prepared dishes, cooking pots, grocery packages, and barcode labels. Read any visible OCR text on cups, wrappers, or menus to identify fast-food brands or commercial chains, and use these to anchor the nutritional estimation (e.g. calories and fat for commercial deep-fried items) to standard commercial nutrition tables. Ingest all visible foods and packages completely into dishes and constituent foods.${multiImageRule}`;

  if (isGeneric) {
    return `${baseInstruction} Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, and nutrients.`;
  }
  return `${baseInstruction} User note: "${cleanMsg}". If the user note explicitly mentions additional foods consumed, you MUST extract them as well, even if not visible in the images. Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, and nutrients.`;
}

export function parseBracketedFoodItems(message: string): Array<{
  originalName: string;
  foodName: string;
  keyword: string;
  estimatedWeightGrams: number;
  source: string;
  isBracketPreExtracted: boolean;
  dishName: string;
  cookingMethod: string;
  visualIngredients: any[];
}> {
  if (!message) return [];
  const matches = message.matchAll(/\[+([^\]]+)\]+/g);
  const items = [];
  for (const m of matches) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    let name = raw;
    let weight = 100;
    const weightMatch = raw.match(/(?:^|\s+)(\d+(?:\.\d+)?)\s*(?:g|grams?|ml)?\s*$/i);
    if (weightMatch) {
      weight = parseFloat(weightMatch[1]);
      name = raw.slice(0, weightMatch.index).trim();
      if (!name) name = raw;
    }
    items.push({
      originalName: name,
      foodName: name,
      keyword: name,
      estimatedWeightGrams: weight,
      source: 'bracket_pre_extracted',
      isBracketPreExtracted: true,
      dishName: name,
      cookingMethod: 'raw',
      visualIngredients: []
    });
  }
  return items;
}

