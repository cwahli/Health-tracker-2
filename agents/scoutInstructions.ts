export { scoutSystemInstruction } from '../server_vision_scout.js';

export function buildVisualScoutPrompt(message: string, imageCount: number): string {
  if (imageCount <= 0) {
    return `Analyze the user's message: "${message}" and extract all food items or products mentioned. Return them in the structured scout JSON format. If any item is from a known chain or brand (e.g. McDonald's, Yolk), capture exact brand and dish name in originalName and queriesToSearch.`;
  }
  return `Analyze the provided ${imageCount > 1 ? imageCount + ' images' : 'image'} and list the food items you see, taking into consideration the user's message: "${message}".${
    imageCount > 1
      ? ' NOTE: If these images show different views/sides of the same package (e.g. front of package and back nutrition label), do NOT merge them into a single item object yourself inside the JSON output. Instead, list them as TWO separate entries in the "items" array: 1. The primary food item (from the front photo) with its brand/product name. 2. A dedicated label item (from the back photo) with originalName containing "Nutrition Facts Label" or "Back of Package" and sourceImageIndex pointing to the label image. Transcribe the full "rawNutritionLabel" and "ingredientsList" inside this item.'
      : ''
  } If any identified dish is from a known chain or brand (e.g. McDonald's, Yolk, Starbucks), capture exact brand and dish name in originalName and queriesToSearch.`;
}
