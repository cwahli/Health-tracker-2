// Standardized Nutritional Database (per 100g)
// Used to calculate precise nutrients on the backend, freeing the LLM from calculation/estimation.

export interface NutritionalProfile {
  calories: number;        // kcal
  protein: number;         // g
  totalFat: number;        // g
  saturatedFat: number;    // g
  transFat: number;        // g
  unsaturatedFat: number;  // g
  omega3: number;          // g
  carbohydrates: number;   // g
  addedSugar: number;      // g
  totalFibre: number;      // g
  solubleFibre: number;    // g
  sodium: number;          // mg
  potassium: number;       // mg
  magnesium: number;       // mg
  calcium: number;         // mg
  iron: number;            // mg
  zinc: number;            // mg
  selenium: number;        // mcg
  iodine: number;          // mcg
  phosphorus: number;      // mg
  vitaminD: number;        // IU
  vitaminB12: number;      // mcg
  folate: number;          // mcg
  vitaminC: number;        // mg
  vitaminE: number;        // mg
  vitaminK: number;        // mcg
  vitaminA: number;        // mcg
  vitaminB6: number;       // mg
  thiamine: number;        // mg
  riboflavin: number;      // mg
  niacin: number;          // mg
}

export const FOOD_DATABASE: Record<string, NutritionalProfile> = {
  "apple": {
    calories: 52, protein: 0.3, totalFat: 0.2, saturatedFat: 0.03, transFat: 0, unsaturatedFat: 0.1, omega3: 0,
    carbohydrates: 13.8, addedSugar: 0, totalFibre: 2.4, solubleFibre: 0.5, sodium: 1, potassium: 107,
    magnesium: 5, calcium: 6, iron: 0.1, zinc: 0.04, selenium: 0, iodine: 0.5, phosphorus: 11,
    vitaminD: 0, vitaminB12: 0, folate: 3, vitaminC: 4.6, vitaminE: 0.18, vitaminK: 2.2, vitaminA: 54,
    vitaminB6: 0.04, thiamine: 0.01, riboflavin: 0.02, niacin: 0.1
  },
  "banana": {
    calories: 89, protein: 1.1, totalFat: 0.3, saturatedFat: 0.1, transFat: 0, unsaturatedFat: 0.15, omega3: 0.01,
    carbohydrates: 22.8, addedSugar: 0, totalFibre: 2.6, solubleFibre: 0.6, sodium: 1, potassium: 358,
    magnesium: 27, calcium: 5, iron: 0.3, zinc: 0.15, selenium: 1.0, iodine: 0, phosphorus: 22,
    vitaminD: 0, vitaminB12: 0, folate: 20, vitaminC: 8.7, vitaminE: 0.1, vitaminK: 0.5, vitaminA: 64,
    vitaminB6: 0.4, thiamine: 0.03, riboflavin: 0.07, niacin: 0.7
  },
  "pear": {
    calories: 57, protein: 0.4, totalFat: 0.1, saturatedFat: 0.01, transFat: 0, unsaturatedFat: 0.08, omega3: 0,
    carbohydrates: 15.2, addedSugar: 0, totalFibre: 3.1, solubleFibre: 1.0, sodium: 1, potassium: 116,
    magnesium: 7, calcium: 9, iron: 0.2, zinc: 0.1, selenium: 0.1, iodine: 0, phosphorus: 12,
    vitaminD: 0, vitaminB12: 0, folate: 7, vitaminC: 4.3, vitaminE: 0.12, vitaminK: 4.4, vitaminA: 25,
    vitaminB6: 0.03, thiamine: 0.01, riboflavin: 0.03, niacin: 0.2
  },
  "pineapple": {
    calories: 50, protein: 0.5, totalFat: 0.1, saturatedFat: 0.01, transFat: 0, unsaturatedFat: 0.08, omega3: 0,
    carbohydrates: 13.1, addedSugar: 0, totalFibre: 1.4, solubleFibre: 0.3, sodium: 1, potassium: 109,
    magnesium: 12, calcium: 13, iron: 0.3, zinc: 0.12, selenium: 0.1, iodine: 0, phosphorus: 8,
    vitaminD: 0, vitaminB12: 0, folate: 18, vitaminC: 47.8, vitaminE: 0.02, vitaminK: 0.7, vitaminA: 58,
    vitaminB6: 0.11, thiamine: 0.08, riboflavin: 0.03, niacin: 0.5
  },
  "orange": {
    calories: 47, protein: 0.9, totalFat: 0.1, saturatedFat: 0.01, transFat: 0, unsaturatedFat: 0.08, omega3: 0,
    carbohydrates: 11.8, addedSugar: 0, totalFibre: 2.4, solubleFibre: 0.6, sodium: 0, potassium: 181,
    magnesium: 10, calcium: 40, iron: 0.1, zinc: 0.07, selenium: 0.5, iodine: 0, phosphorus: 14,
    vitaminD: 0, vitaminB12: 0, folate: 30, vitaminC: 53.2, vitaminE: 0.18, vitaminK: 0, vitaminA: 225,
    vitaminB6: 0.06, thiamine: 0.09, riboflavin: 0.04, niacin: 0.3
  },
  "broccoli": {
    calories: 34, protein: 2.8, totalFat: 0.4, saturatedFat: 0.04, transFat: 0, unsaturatedFat: 0.3, omega3: 0.02,
    carbohydrates: 6.6, addedSugar: 0, totalFibre: 2.6, solubleFibre: 0.4, sodium: 33, potassium: 316,
    magnesium: 21, calcium: 47, iron: 0.7, zinc: 0.4, selenium: 2.5, iodine: 1.0, phosphorus: 66,
    vitaminD: 0, vitaminB12: 0, folate: 63, vitaminC: 89.2, vitaminE: 0.78, vitaminK: 101.6, vitaminA: 623,
    vitaminB6: 0.18, thiamine: 0.07, riboflavin: 0.12, niacin: 0.6
  },
  "chicken breast": {
    calories: 165, protein: 31.0, totalFat: 3.6, saturatedFat: 1.0, transFat: 0, unsaturatedFat: 2.3, omega3: 0.03,
    carbohydrates: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 74, potassium: 256,
    magnesium: 29, calcium: 15, iron: 1.0, zinc: 1.0, selenium: 27.6, iodine: 4.5, phosphorus: 228,
    vitaminD: 5, vitaminB12: 0.3, folate: 4, vitaminC: 0, vitaminE: 0.3, vitaminK: 0, vitaminA: 21,
    vitaminB6: 0.6, thiamine: 0.07, riboflavin: 0.12, niacin: 13.7
  },
  "beef steak": {
    calories: 250, protein: 26.0, totalFat: 17.0, saturatedFat: 6.8, transFat: 0.4, unsaturatedFat: 8.5, omega3: 0.05,
    carbohydrates: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 60, potassium: 318,
    magnesium: 22, calcium: 18, iron: 2.6, zinc: 4.5, selenium: 22.4, iodine: 3.0, phosphorus: 198,
    vitaminD: 4, vitaminB12: 2.6, folate: 9, vitaminC: 0, vitaminE: 0.2, vitaminK: 1.5, vitaminA: 0,
    vitaminB6: 0.4, thiamine: 0.08, riboflavin: 0.18, niacin: 4.8
  },
  "salmon": {
    calories: 208, protein: 20.0, totalFat: 13.0, saturatedFat: 3.1, transFat: 0, unsaturatedFat: 9.0, omega3: 2.5,
    carbohydrates: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 59, potassium: 363,
    magnesium: 27, calcium: 9, iron: 0.3, zinc: 0.4, selenium: 32.4, iodine: 15.0, phosphorus: 240,
    vitaminD: 526, vitaminB12: 3.2, folate: 5, vitaminC: 0, vitaminE: 1.1, vitaminK: 0.1, vitaminA: 50,
    vitaminB6: 0.6, thiamine: 0.2, riboflavin: 0.15, niacin: 8.5
  },
  "pork": {
    calories: 242, protein: 27.0, totalFat: 14.0, saturatedFat: 4.8, transFat: 0.1, unsaturatedFat: 7.5, omega3: 0.08,
    carbohydrates: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 62, potassium: 340,
    magnesium: 25, calcium: 12, iron: 0.9, zinc: 2.1, selenium: 31.8, iodine: 2.0, phosphorus: 210,
    vitaminD: 25, vitaminB12: 0.7, folate: 4, vitaminC: 0, vitaminE: 0.15, vitaminK: 0, vitaminA: 2,
    vitaminB6: 0.5, thiamine: 0.8, riboflavin: 0.2, niacin: 6.2
  },
  "white rice": {
    calories: 130, protein: 2.7, totalFat: 0.3, saturatedFat: 0.08, transFat: 0, unsaturatedFat: 0.2, omega3: 0,
    carbohydrates: 28.0, addedSugar: 0, totalFibre: 0.4, solubleFibre: 0.1, sodium: 1, potassium: 35,
    magnesium: 12, calcium: 10, iron: 1.2, zinc: 0.5, selenium: 7.5, iodine: 0, phosphorus: 43,
    vitaminD: 0, vitaminB12: 0, folate: 58, vitaminC: 0, vitaminE: 0, vitaminK: 0, vitaminA: 0,
    vitaminB6: 0.05, thiamine: 0.16, riboflavin: 0.01, niacin: 1.5
  },
  "brown rice": {
    calories: 111, protein: 2.6, totalFat: 0.9, saturatedFat: 0.18, transFat: 0, unsaturatedFat: 0.6, omega3: 0.01,
    carbohydrates: 23.0, addedSugar: 0, totalFibre: 1.8, solubleFibre: 0.2, sodium: 5, potassium: 43,
    magnesium: 43, calcium: 10, iron: 0.4, zinc: 0.6, selenium: 5.8, iodine: 0, phosphorus: 83,
    vitaminD: 0, vitaminB12: 0, folate: 4, vitaminC: 0, vitaminE: 0.2, vitaminK: 0.2, vitaminA: 0,
    vitaminB6: 0.14, thiamine: 0.18, riboflavin: 0.02, niacin: 2.6
  },
  "egg": {
    calories: 155, protein: 13.0, totalFat: 11.0, saturatedFat: 3.3, transFat: 0.04, unsaturatedFat: 6.5, omega3: 0.11,
    carbohydrates: 1.1, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 124, potassium: 126,
    magnesium: 10, calcium: 50, iron: 1.2, zinc: 1.1, selenium: 30.8, iodine: 49.0, phosphorus: 172,
    vitaminD: 87, vitaminB12: 1.1, folate: 44, vitaminC: 0, vitaminE: 1.0, vitaminK: 0.3, vitaminA: 140,
    vitaminB6: 0.12, thiamine: 0.06, riboflavin: 0.5, niacin: 0.1
  },
  "avocado": {
    calories: 160, protein: 2.0, totalFat: 15.0, saturatedFat: 2.1, transFat: 0, unsaturatedFat: 12.0, omega3: 0.11,
    carbohydrates: 8.5, addedSugar: 0, totalFibre: 6.7, solubleFibre: 2.0, sodium: 7, potassium: 485,
    magnesium: 29, calcium: 12, iron: 0.6, zinc: 0.6, selenium: 0.4, iodine: 0, phosphorus: 52,
    vitaminD: 0, vitaminB12: 0, folate: 81, vitaminC: 10.0, vitaminE: 2.07, vitaminK: 21.0, vitaminA: 146,
    vitaminB6: 0.26, thiamine: 0.07, riboflavin: 0.13, niacin: 1.7
  },
  "whole wheat bread": {
    calories: 247, protein: 13.0, totalFat: 3.4, saturatedFat: 0.7, transFat: 0, unsaturatedFat: 2.2, omega3: 0.05,
    carbohydrates: 41.0, addedSugar: 5.0, totalFibre: 7.0, solubleFibre: 1.5, sodium: 400, potassium: 248,
    magnesium: 75, calcium: 161, iron: 2.4, zinc: 1.8, selenium: 25.8, iodine: 8.0, phosphorus: 200,
    vitaminD: 0, vitaminB12: 0, folate: 45, vitaminC: 0, vitaminE: 0.3, vitaminK: 1.8, vitaminA: 0,
    vitaminB6: 0.1, thiamine: 0.35, riboflavin: 0.15, niacin: 4.3
  },
  "white bread": {
    calories: 265, protein: 9.0, totalFat: 3.2, saturatedFat: 0.8, transFat: 0.05, unsaturatedFat: 1.8, omega3: 0.01,
    carbohydrates: 49.0, addedSugar: 5.0, totalFibre: 2.7, solubleFibre: 0.5, sodium: 491, potassium: 115,
    magnesium: 25, calcium: 260, iron: 3.6, zinc: 0.7, selenium: 21.5, iodine: 7.0, phosphorus: 98,
    vitaminD: 0, vitaminB12: 0, folate: 110, vitaminC: 0, vitaminE: 0.2, vitaminK: 0.2, vitaminA: 0,
    vitaminB6: 0.04, thiamine: 0.4, riboflavin: 0.3, niacin: 4.0
  },
  "butter": {
    calories: 717, protein: 0.9, totalFat: 81.0, saturatedFat: 51.4, transFat: 3.2, unsaturatedFat: 24.0, omega3: 0.32,
    carbohydrates: 0.1, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 576, potassium: 24,
    magnesium: 2, calcium: 24, iron: 0.02, zinc: 0.09, selenium: 1.0, iodine: 18.0, phosphorus: 24,
    vitaminD: 60, vitaminB12: 0.17, folate: 3, vitaminC: 0, vitaminE: 2.32, vitaminK: 7.0, vitaminA: 684,
    vitaminB6: 0, thiamine: 0, riboflavin: 0.03, niacin: 0.04
  },
  "cheese": {
    calories: 403, protein: 25.0, totalFat: 33.0, saturatedFat: 21.0, transFat: 1.1, unsaturatedFat: 9.5, omega3: 0.24,
    carbohydrates: 1.3, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 621, potassium: 98,
    magnesium: 28, calcium: 721, iron: 0.7, zinc: 3.9, selenium: 14.5, iodine: 35.0, phosphorus: 512,
    vitaminD: 24, vitaminB12: 1.5, folate: 18, vitaminC: 0, vitaminE: 0.3, vitaminK: 2.8, vitaminA: 330,
    vitaminB6: 0.08, thiamine: 0.03, riboflavin: 0.4, niacin: 0.1
  },
  "salad": {
    calories: 17, protein: 1.2, totalFat: 0.2, saturatedFat: 0.02, transFat: 0, unsaturatedFat: 0.1, omega3: 0.01,
    carbohydrates: 3.2, addedSugar: 0, totalFibre: 1.6, solubleFibre: 0.3, sodium: 8, potassium: 194,
    magnesium: 13, calcium: 32, iron: 0.8, zinc: 0.2, selenium: 0.4, iodine: 0, phosphorus: 28,
    vitaminD: 0, vitaminB12: 0, folate: 38, vitaminC: 18.0, vitaminE: 0.22, vitaminK: 102.0, vitaminA: 370,
    vitaminB6: 0.08, thiamine: 0.05, riboflavin: 0.06, niacin: 0.3
  },
  "tomato": {
    calories: 18, protein: 0.9, totalFat: 0.2, saturatedFat: 0.03, transFat: 0, unsaturatedFat: 0.1, omega3: 0,
    carbohydrates: 3.9, addedSugar: 0, totalFibre: 1.2, solubleFibre: 0.2, sodium: 5, potassium: 237,
    magnesium: 11, calcium: 10, iron: 0.3, zinc: 0.17, selenium: 0, iodine: 0, phosphorus: 24,
    vitaminD: 0, vitaminB12: 0, folate: 15, vitaminC: 13.7, vitaminE: 0.54, vitaminK: 7.9, vitaminA: 833,
    vitaminB6: 0.08, thiamine: 0.04, riboflavin: 0.02, niacin: 0.6
  },
  "olive oil": {
    calories: 884, protein: 0, totalFat: 100.0, saturatedFat: 13.8, transFat: 0, unsaturatedFat: 82.0, omega3: 0.76,
    carbohydrates: 0, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 2, potassium: 1,
    magnesium: 0, calcium: 1, iron: 0.56, zinc: 0, selenium: 0, iodine: 0, phosphorus: 0,
    vitaminD: 0, vitaminB12: 0, folate: 0, vitaminC: 0, vitaminE: 14.4, vitaminK: 60.2, vitaminA: 0,
    vitaminB6: 0, thiamine: 0, riboflavin: 0, niacin: 0
  },
  "potato": {
    calories: 77, protein: 2.0, totalFat: 0.1, saturatedFat: 0.03, transFat: 0, unsaturatedFat: 0.05, omega3: 0.01,
    carbohydrates: 17.5, addedSugar: 0, totalFibre: 2.1, solubleFibre: 0.4, sodium: 6, potassium: 421,
    magnesium: 23, calcium: 12, iron: 0.8, zinc: 0.3, selenium: 0.4, iodine: 0, phosphorus: 57,
    vitaminD: 0, vitaminB12: 0, folate: 15, vitaminC: 19.7, vitaminE: 0.01, vitaminK: 2.0, vitaminA: 2,
    vitaminB6: 0.3, thiamine: 0.08, riboflavin: 0.03, niacin: 1.1
  },
  "pasta": {
    calories: 131, protein: 5.0, totalFat: 1.1, saturatedFat: 0.18, transFat: 0, unsaturatedFat: 0.7, omega3: 0,
    carbohydrates: 25.0, addedSugar: 0, totalFibre: 1.8, solubleFibre: 0.2, sodium: 1, potassium: 44,
    magnesium: 18, calcium: 6, iron: 1.3, zinc: 0.5, selenium: 26.4, iodine: 0, phosphorus: 58,
    vitaminD: 0, vitaminB12: 0, folate: 102, vitaminC: 0, vitaminE: 0.11, vitaminK: 0.1, vitaminA: 0,
    vitaminB6: 0.05, thiamine: 0.16, riboflavin: 0.04, niacin: 1.2
  },
  "donut": {
    calories: 426, protein: 4.9, totalFat: 23.0, saturatedFat: 5.7, transFat: 4.5, unsaturatedFat: 11.5, omega3: 0.05,
    carbohydrates: 51.0, addedSugar: 27.0, totalFibre: 1.5, solubleFibre: 0.2, sodium: 327, potassium: 112,
    magnesium: 16, calcium: 35, iron: 2.1, zinc: 0.4, selenium: 7.2, iodine: 2.0, phosphorus: 98,
    vitaminD: 4, vitaminB12: 0.1, folate: 45, vitaminC: 0.1, vitaminE: 1.5, vitaminK: 3.5, vitaminA: 15,
    vitaminB6: 0.03, thiamine: 0.18, riboflavin: 0.15, niacin: 1.8
  },
  "french fries": {
    calories: 312, protein: 3.4, totalFat: 15.0, saturatedFat: 2.3, transFat: 3.8, unsaturatedFat: 8.5, omega3: 0.08,
    carbohydrates: 41.0, addedSugar: 0, totalFibre: 3.8, solubleFibre: 0.5, sodium: 210, potassium: 579,
    magnesium: 30, calcium: 18, iron: 0.8, zinc: 0.5, selenium: 0.9, iodine: 0, phosphorus: 125,
    vitaminD: 0, vitaminB12: 0, folate: 24, vitaminC: 4.7, vitaminE: 1.8, vitaminK: 12.0, vitaminA: 0,
    vitaminB6: 0.32, thiamine: 0.09, riboflavin: 0.04, niacin: 3.0
  },
  "pizza": {
    calories: 266, protein: 11.4, totalFat: 9.8, saturatedFat: 4.5, transFat: 0.2, unsaturatedFat: 4.7, omega3: 0.1,
    carbohydrates: 33.0, addedSugar: 3.5, totalFibre: 2.3, solubleFibre: 0.4, sodium: 598, potassium: 172,
    magnesium: 24, calcium: 188, iron: 2.5, zinc: 1.3, selenium: 19.8, iodine: 12.0, phosphorus: 216,
    vitaminD: 8, vitaminB12: 0.4, folate: 68, vitaminC: 1.4, vitaminE: 0.6, vitaminK: 4.5, vitaminA: 310,
    vitaminB6: 0.08, thiamine: 0.22, riboflavin: 0.18, niacin: 3.2
  },
  "hamburger": {
    calories: 295, protein: 17.0, totalFat: 14.0, saturatedFat: 5.0, transFat: 0.6, unsaturatedFat: 7.8, omega3: 0.15,
    carbohydrates: 24.0, addedSugar: 4.0, totalFibre: 1.5, solubleFibre: 0.3, sodium: 504, potassium: 258,
    magnesium: 20, calcium: 85, iron: 2.5, zinc: 3.2, selenium: 21.0, iodine: 10.0, phosphorus: 165,
    vitaminD: 5, vitaminB12: 1.2, folate: 48, vitaminC: 0.8, vitaminE: 0.4, vitaminK: 3.2, vitaminA: 85,
    vitaminB6: 0.18, thiamine: 0.18, riboflavin: 0.2, niacin: 4.2
  },
  "yogurt": {
    calories: 63, protein: 3.5, totalFat: 3.3, saturatedFat: 2.1, transFat: 0.1, unsaturatedFat: 1.0, omega3: 0.02,
    carbohydrates: 4.7, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 46, potassium: 141,
    magnesium: 11, calcium: 121, iron: 0.05, zinc: 0.6, selenium: 2.2, iodine: 25.0, phosphorus: 95,
    vitaminD: 0, vitaminB12: 0.4, folate: 7, vitaminC: 0.5, vitaminE: 0.02, vitaminK: 0.2, vitaminA: 99,
    vitaminB6: 0.05, thiamine: 0.03, riboflavin: 0.14, niacin: 0.1
  },
  "milk": {
    calories: 61, protein: 3.2, totalFat: 3.3, saturatedFat: 1.9, transFat: 0.1, unsaturatedFat: 1.2, omega3: 0.04,
    carbohydrates: 4.8, addedSugar: 0, totalFibre: 0, solubleFibre: 0, sodium: 43, potassium: 132,
    magnesium: 10, calcium: 113, iron: 0.03, zinc: 0.4, selenium: 2.0, iodine: 23.0, phosphorus: 84,
    vitaminD: 40, vitaminB12: 0.45, folate: 5, vitaminC: 0, vitaminE: 0.07, vitaminK: 0.3, vitaminA: 162,
    vitaminB6: 0.04, thiamine: 0.04, riboflavin: 0.14, niacin: 0.1
  },
  "oatmeal": {
    calories: 68, protein: 2.4, totalFat: 1.4, saturatedFat: 0.2, transFat: 0, unsaturatedFat: 1.1, omega3: 0.03,
    carbohydrates: 12.0, addedSugar: 0, totalFibre: 1.7, solubleFibre: 0.8, sodium: 2, potassium: 61,
    magnesium: 26, calcium: 80, iron: 0.9, zinc: 0.5, selenium: 4.5, iodine: 0, phosphorus: 77,
    vitaminD: 0, vitaminB12: 0, folate: 6, vitaminC: 0, vitaminE: 0.08, vitaminK: 0.3, vitaminA: 0,
    vitaminB6: 0.03, thiamine: 0.08, riboflavin: 0.02, niacin: 0.2
  },
  "nuts": {
    calories: 579, protein: 21.0, totalFat: 49.0, saturatedFat: 3.8, transFat: 0, unsaturatedFat: 43.0, omega3: 0.1,
    carbohydrates: 22.0, addedSugar: 0, totalFibre: 12.0, solubleFibre: 1.2, sodium: 1, potassium: 733,
    magnesium: 270, calcium: 269, iron: 3.7, zinc: 3.1, selenium: 4.1, iodine: 0, phosphorus: 481,
    vitaminD: 0, vitaminB12: 0, folate: 44, vitaminC: 0, vitaminE: 25.6, vitaminK: 0, vitaminA: 2,
    vitaminB6: 0.14, thiamine: 0.2, riboflavin: 1.1, niacin: 3.6
  },
  "spinach": {
    calories: 23, protein: 2.9, totalFat: 0.4, saturatedFat: 0.06, transFat: 0, unsaturatedFat: 0.3, omega3: 0.03,
    carbohydrates: 3.6, addedSugar: 0, totalFibre: 2.2, solubleFibre: 0.3, sodium: 79, potassium: 558,
    magnesium: 79, calcium: 99, iron: 2.7, zinc: 0.5, selenium: 1.0, iodine: 3.0, phosphorus: 49,
    vitaminD: 0, vitaminB12: 0, folate: 194, vitaminC: 28.1, vitaminE: 2.03, vitaminK: 482.9, vitaminA: 9377,
    vitaminB6: 0.2, thiamine: 0.08, riboflavin: 0.19, niacin: 0.7
  }
};

const DEFAULT_PROFILE: NutritionalProfile = {
  calories: 100, protein: 3, totalFat: 3, saturatedFat: 0.5, transFat: 0, unsaturatedFat: 2.3, omega3: 0.05,
  carbohydrates: 15, addedSugar: 0, totalFibre: 1.5, solubleFibre: 0.3, sodium: 50, potassium: 150,
  magnesium: 15, calcium: 20, iron: 0.5, zinc: 0.5, selenium: 2.0, iodine: 1.0, phosphorus: 50,
  vitaminD: 0, vitaminB12: 0.1, folate: 10, vitaminC: 5, vitaminE: 0.2, vitaminK: 5, vitaminA: 100,
  vitaminB6: 0.05, thiamine: 0.05, riboflavin: 0.05, niacin: 0.5
};

export function getNutrientsForFood(canonicalName: string, weightGrams: number): NutritionalProfile {
  const normalized = (canonicalName || "").toLowerCase().trim();
  
  // Try exact match first
  let foundProfile = FOOD_DATABASE[normalized];

  if (!foundProfile) {
    // Try substring matching
    const matchingKey = Object.keys(FOOD_DATABASE).find(key => 
      normalized.includes(key) || key.includes(normalized)
    );
    if (matchingKey) {
      foundProfile = FOOD_DATABASE[matchingKey];
    }
  }

  // Fallback if not found
  const baseProfile = foundProfile || DEFAULT_PROFILE;
  const factor = weightGrams / 100;

  const result: any = {};
  for (const k of Object.keys(baseProfile)) {
    const key = k as keyof NutritionalProfile;
    result[key] = parseFloat((baseProfile[key] * factor).toFixed(2));
  }

  return result as NutritionalProfile;
}
