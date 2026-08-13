const fs = require('fs');
let code = fs.readFileSync('server_food_db.ts', 'utf8');

const additions = `
  plain_yogurt: { fdcId: "170903", calories: 61, protein: 3.47, totalFat: 3.25, saturatedFat: 2.09, transFat: 0, carbohydrates: 4.66, sugar: 4.66, sodium: 46, potassium: 155, totalFibre: 0, foodType: 'dairy' },
  raisins: { fdcId: "169641", calories: 299, protein: 3.07, totalFat: 0.46, saturatedFat: 0.05, transFat: 0, carbohydrates: 79.18, sugar: 59.19, sodium: 11, potassium: 749, totalFibre: 3.7, foodType: 'fruit' },
  almonds: { fdcId: "170567", calories: 579, protein: 21.15, totalFat: 49.93, saturatedFat: 3.8, transFat: 0, carbohydrates: 21.55, sugar: 4.35, sodium: 1, potassium: 733, totalFibre: 12.5, foodType: 'nut' },
  croissant: { fdcId: "172242", calories: 406, protein: 8.2, totalFat: 21.0, saturatedFat: 11.66, transFat: 0.16, carbohydrates: 45.8, sugar: 11.26, sodium: 467, potassium: 118, totalFibre: 2.6, foodType: 'processed' },
  falafel: { fdcId: "falafel_canonical", calories: 333, protein: 13.3, totalFat: 17.8, saturatedFat: 2.39, transFat: 0, carbohydrates: 31.8, sugar: 4.88, sodium: 294, potassium: 585, totalFibre: 4.9, foodType: 'legume' },
  hummus: { fdcId: "174289", calories: 277, protein: 7.9, totalFat: 21.4, saturatedFat: 2.94, transFat: 0, carbohydrates: 15.6, sugar: 0, sodium: 395, potassium: 251, totalFibre: 6, foodType: 'processed' },
  feta_cheese: { fdcId: "173420", calories: 264, protein: 14.21, totalFat: 21.28, saturatedFat: 14.94, transFat: 0, carbohydrates: 4.09, sugar: 4.09, sodium: 917, potassium: 62, totalFibre: 0, foodType: 'dairy' },
  raw_red_onion: { fdcId: "11282", calories: 40, protein: 1.1, totalFat: 0.1, saturatedFat: 0.04, transFat: 0, carbohydrates: 9.34, sugar: 4.24, sodium: 4, potassium: 146, totalFibre: 1.7, foodType: 'veg' },
  raw_bell_pepper: { fdcId: "170108", calories: 20, protein: 0.86, totalFat: 0.17, saturatedFat: 0.05, transFat: 0, carbohydrates: 4.64, sugar: 2.4, sodium: 3, potassium: 175, totalFibre: 1.7, foodType: 'veg' },
`;

code = code.replace(/export const CANONICAL_BASE_FOODS: Record<[^>]+> = {/, match => match + additions);

const aliasAdditions = `
  if (normalized.includes('plain yogurt') || normalized.includes('plain yoghurt')) return CANONICAL_BASE_FOODS.plain_yogurt;
  if (normalized.includes('raisin')) return CANONICAL_BASE_FOODS.raisins;
  if (normalized.includes('almond')) return CANONICAL_BASE_FOODS.almonds;
  if (normalized.includes('croissant')) return CANONICAL_BASE_FOODS.croissant;
  if (normalized.includes('falafel')) return CANONICAL_BASE_FOODS.falafel;
  if (normalized.includes('hummus')) return CANONICAL_BASE_FOODS.hummus;
  if (normalized.includes('feta cheese')) return CANONICAL_BASE_FOODS.feta_cheese;
  if (normalized.includes('red onion')) return CANONICAL_BASE_FOODS.raw_red_onion;
  if (normalized.includes('bell pepper')) return CANONICAL_BASE_FOODS.raw_bell_pepper;
  if (normalized.includes('mixed berries fruit compote')) return CANONICAL_BASE_FOODS.strawberry;
`;

code = code.replace(/export function lookupCanonicalBaseFood[^\{]+\{/, match => match + aliasAdditions);

fs.writeFileSync('server_food_db.ts', code);
console.log('Fixed');
