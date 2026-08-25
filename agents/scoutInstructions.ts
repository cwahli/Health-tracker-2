export { scoutSystemInstruction } from '../server_vision_scout.js';

export function buildVisualScoutPrompt(message: string, imageCount: number): string {
  if (imageCount <= 0) {
    return `Analyze the user's message: "${message}" and extract all food items mentioned. For each item, estimate its weight in grams and provide direct physical macro estimates (protein, carbohydrates, totalFat, etc.) across all 14 required fields in "nutrients" (zero calorie input). If from a known chain/brand (e.g. McDonald's, Yolk, Starbucks), capture the brand in chainName and dish name in originalName.`;
  }
  return `Analyze the provided ${imageCount > 1 ? imageCount + ' images' : 'image'} and list the food items you see, taking into consideration the user's message: "${message}". If a package nutrition facts label or menu panel is visible, transcribe all printed facts into "rawNutritionLabel" FIRST. For each distinct food dish, estimate its weight in grams and provide direct physical macro estimates (protein, carbohydrates, totalFat, etc.) across all 14 keys in "nutrients" (zero calorie input; backend computes calories bottom-up). If any identified dish is from a known chain or brand (e.g. McDonald's, Yolk, Starbucks, Sainsbury, Lidl), capture the brand in chainName and exact dish title in originalName.`;
}
