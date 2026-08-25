# Indonesian Meal: Regional Cuisine Dietitian Calibration Report

- **Date:** 2026-08-24T11:09:46.604Z
- **Model:** `gemini-3.5-flash-lite`
- **Images Tested:** `06_indonesian_menu_page_1.jpg` and `06_indonesian_menu_page_2.jpg`
- **Dishes Tested:** Mie Suit, Siomay, Es Petak Umpet

---

## 1. Architecture A (Item-Level Corrections)

- **Verdict:** `146% over sodium limit` (alert)
- **Message:**
  > "You secured 27g of satisfying protein from the noodles and fish siomay. However, the heavy seasonings, shrimp paste, and preserved elements push total sodium to 1,415mg, landing 146% over your daily limit. This high sodium load causes sudden thirst, fluid retention, and blood vessel tightness. Drink a large glass of plain water now, and take a 15-minute walk to help normalize circulation."

### Item Adjustments Made:
[
  {
    "scoutIndex": 0,
    "canonicalDbName": "Mie Suit (Indonesian seasoned noodles)",
    "weightGrams": 220,
    "foodType": "prepared dish",
    "cookingMethod": "boiled and tossed with oil/soy",
    "correctedNutrients": {
      "calories": 450,
      "protein": 14,
      "totalFat": 18,
      "saturatedFat": 6,
      "sodium": 850,
      "addedSugar": 8,
      "totalFibre": 2
    },
    "clinicalCorrectionNote": "Adjusted baseline to account for typical sodium and oil usage in seasoned Indonesian noodle dishes."
  },
  {
    "scoutIndex": 1,
    "canonicalDbName": "Siomay (Indonesian fish dumplings)",
    "weightGrams": 150,
    "foodType": "dumpling",
    "cookingMethod": "steamed",
    "correctedNutrients": {
      "calories": 300,
      "protein": 13,
      "totalFat": 11,
      "saturatedFat": 3.5,
      "sodium": 520,
      "addedSugar": 2,
      "totalFibre": 1
    },
    "clinicalCorrectionNote": "Standardized nutrient profile for authentic fish-tapioca siomay with savory seasoning."
  },
  {
    "scoutIndex": 2,
    "canonicalDbName": "Es Petak Umpet (Indonesian iced beverage)",
    "weightGrams": 350,
    "foodType": "beverage",
    "cookingMethod": "mixed/iced",
    "correctedNutrients": {
      "calories": 240,
      "protein": 1,
      "totalFat": 2,
      "saturatedFat": 1.5,
      "sodium": 45,
      "addedSugar": 30,
      "totalFibre": 0
    },
    "clinicalCorrectionNote": "Accounted for simple syrup and potential coconut milk content characteristic of sweet Indonesian ice drinks."
  }
]

---

## 2. Architecture B (Aggregate Regional Audit)

- **Verdict:** `147% over sodium limit` (alert)
- **Message:**
  > "You secured 27g of protein from the fish dumplings and noodles. However, the savory seasonings and sweet beverage push sodium 147% over your limit and added sugar past daily goals. This high sodium load causes sudden fluid retention, elevated blood pressure, and vascular tightness. Take a 20-minute brisk walk to improve circulation, and hydrate with plain water to help balance your sodium levels."
- **Audit Status:** `confirmed_accurate`
- **Regional Correction Note:**
  > "None"
- **Adjusted Aggregate Nutrients:**
{
  "calories": 910,
  "protein": 27,
  "totalFat": 26.5,
  "saturatedFat": 8.2,
  "sodium": 1415,
  "potassium": 420,
  "addedSugar": 38,
  "totalFibre": 4
}

---
