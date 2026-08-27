export { scoutSystemInstruction } from '../server_vision_scout.js';

export function buildVisualScoutPrompt(message: string, imageCount: number): string {
  if (imageCount <= 0) {
    return `Analyze the user's message: "${message}" and extract all dishes and constituent foods into the hierarchical schema with weights and nutrients.`;
  }
  const cleanMsg = (message || '').trim();
  const isGeneric = !cleanMsg || /^(analyze\s*(this|the)?\s*(meal|food|photo|image)?[s.]*|log\s*meal|scan)$/i.test(cleanMsg);
  const baseInstruction = `Analyze the provided ${imageCount > 1 ? imageCount + ' meal images' : 'meal image'}. Inspect all visible prepared dishes, cooking pots, grocery packages, and barcode labels. Read any visible OCR text on cups, wrappers, or menus to identify fast-food brands or commercial chains, and use these to anchor the nutritional estimation (e.g. calories and fat for commercial deep-fried items) to standard commercial nutrition tables. Ingest all visible foods and packages completely into dishes and constituent foods.`;

  if (isGeneric) {
    return `${baseInstruction} Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, and nutrients.`;
  }
  return `${baseInstruction} User note: "${cleanMsg}". Extract all physical dishes and constituent foods into the hierarchical schema with weightGrams, packGrams, and nutrients.`;
}
