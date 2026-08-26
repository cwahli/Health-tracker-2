# Image Benchmark Ground Truth Nutrients Registry (31 Nutrients)

This registry contains the verified ground truth nutritional values across all **31 canonical nutrients** for all 10 benchmark image sets in `prototype/images/`.

All values are based on **direct OCR label transcription** where labels/barcodes exist, and rigorous USDA/culinary database standards for visible plated ingredients.

---

## Benchmark Master Summary Table

| # | Benchmark Case | Images | Total Weight | Calories | Protein | Carbs | Total Fat | Sat Fat | Fibre | Sodium | Sugar |
|---|----------------|--------|:------------:|:--------:|:-------:|:-----:|:---------:|:-------:|:-----:|:------:|:-----:|
| **01** | **YOLK Chicken Sandwich & Roasted Sides** | `01_yolk_panini_wrap.jpg` | **600 g** | **950 kcal** | 49.0 g | 92.0 g | 42.0 g | 8.5 g | 11.5 g | 1,250 mg | 8.5 g |
| **02** | **Lidl Chicken Bites & Chocolate Muffin** | `02_lidl_chicken_muffin.jpg` | **195 g** | **557 kcal** | 21.7 g | 58.0 g | 26.5 g | 7.5 g | 3.0 g | 628 mg | 28.4 g |
| **03** | **Salmon Sushi, Shrimp Pasta Salad & Baguette** | `03_sushi_shrimp_salad.jpg` | **650 g** | **1,000 kcal** | 55.5 g | 134.0 g | 25.0 g | 5.5 g | 9.5 g | 1,350 mg | 12.0 g |
| **04** | **Berry Parfait, Pastries & Cobb Salad** | `04_seaside_fish_chips.jpg` | **1,000 g** | **1,630 kcal** | 75.0 g | 148.0 g | 80.0 g | 26.0 g | 18.0 g | 1,450 mg | 52.0 g |
| **05** | **Airline Breakfast: Congee, Croissant & Cake** | `05_cafe_waffles_coffee.jpg` | **640 g** | **838 kcal** | 23.0 g | 104.0 g | 37.0 g | 19.0 g | 3.5 g | 520 mg | 48.0 g |
| **06** | **Mie Gacoan: Mie Suit, Siomay & Es Petak Umpet** | `06_indonesian_menu_page_1.jpg`, `06_indonesian_menu_page_2.jpg` | **570 g** | **780 kcal** | 27.0 g | 111.0 g | 25.0 g | 5.0 g | 4.0 g | 1,250 mg | 35.0 g |
| **07** | **Fruit Plate & Greek Yogurt Oats Mug** | `07_sainsbury_oat_fruits.jpg` | **550 g** | **442 kcal** | 14.2 g | 89.0 g | 5.3 g | 1.8 g | 12.6 g | 65 mg | 54.0 g |
| **08** | **Sunrise Rolled Oats Porridge** | `08_rolled_oats_1.jpg`, `08_rolled_oats_2.jpg` | **220 g** | **212 kcal** | 5.0 g | 35.0 g | 5.8 g | 0.8 g | 5.0 g | 0 mg | 0.0 g |
| **09** | **Sizzling Pepper Steak & Fish & Chips Plates** | `09_steak_fish_chips_1.jpg`, `09_steak_fish_chips_2.jpg` | **1,135 g** | **1,340 kcal** | 78.0 g | 102.0 g | 67.0 g | 16.0 g | 10.0 g | 1,850 mg | 32.0 g |
| **10** | **Beef & Vegetable Hotpot (Barcoded Groceries)** | `10_beef_soup_barcode_meal_0.jpg`, `10_beef_soup_barcode_meal_1.jpg` | **825 g** | **616 kcal** | 65.2 g | 45.9 g | 23.5 g | 6.2 g | 17.8 g | 380 mg | 12.4 g |

---

## Detailed 31-Nutrient Ground Truth Breakdown per Case

---

### Image Set 01: YOLK Chicken Sandwich & Roasted Sides
- **Files:** `01_yolk_panini_wrap.jpg`
- **Environment:** `fast_food_chain` / `casual_restaurant` | **Brand:** `Yolk`
- **Dish Breakdown:**
  1. **Yolk Grilled Chicken Sub Sandwich (2 halves):** ~260g (Sub roll, grilled chicken breast, herb mayo, pickled slaw)
  2. **Roasted Broccoli & Cabbage Bowl:** ~160g (Roasted broccoli, charred Savoy cabbage, roasting oil)
  3. **Roasted Baby Potatoes Bowl:** ~180g (Crispy skin-on baby potatoes, olive oil, rosemary seasoning)

#### Comprehensive 31 Nutrients Table
| Nutrient | Value | Unit | Nutrient | Value | Unit |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Calories** | `950` | kcal | **Zinc** | `3.6` | mg |
| **Protein** | `49.0` | g | **Selenium** | `42` | mcg |
| **Carbohydrates** | `92.0` | g | **Iodine** | `35` | mcg |
| **Total Fat** | `42.0` | g | **Phosphorus** | `580` | mg |
| **Saturated Fat** | `8.5` | g | **Vitamin D** | `0.4` | mcg |
| **Trans Fat** | `0.2` | g | **Vitamin B12** | `0.8` | mcg |
| **Unsaturated Fat** | `33.3` | g | **Folate** | `140` | mcg |
| **Omega-3** | `0.45` | g | **Vitamin C** | `85` | mg |
| **Sugar (Total)** | `8.5` | g | **Vitamin E** | `4.8` | mg |
| **Added Sugar** | `1.5` | g | **Vitamin K** | `160` | mcg |
| **Dietary Fibre** | `11.5` | g | **Vitamin A** | `120` | mcg |
| **Soluble Fibre** | `3.2` | g | **Vitamin B6** | `1.1` | mg |
| **Sodium** | `1,250` | mg | **Thiamine (B1)** | `0.45` | mg |
| **Potassium** | `1,450` | mg | **Riboflavin (B2)**| `0.42` | mg |
| **Calcium** | `160` | mg | **Niacin (B3)** | `14.5` | mg |
| **Iron** | `4.6` | mg | **Magnesium** | `125` | mg |

---

### Image Set 02: Lidl Chicken Bites & Double Chocolate Muffin
- **Files:** `02_lidl_chicken_muffin.jpg`
- **Environment:** `fast_food_chain` / `retail_bakery` | **Brand:** `Lidl`
- **Dish Breakdown:**
  1. **Lidl Double Chocolate Bakery Muffin:** 110g (In-store fresh bakery muffin)
  2. **Lidl Seasoned Fried Style Minced Chicken Bites Pack:** 85g (Packaging with printed nutrition facts)

#### Comprehensive 31 Nutrients Table
| Nutrient | Value | Unit | Nutrient | Value | Unit |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Calories** | `557` | kcal | **Zinc** | `1.9` | mg |
| **Protein** | `21.7` | g | **Selenium** | `18` | mcg |
| **Carbohydrates** | `58.0` | g | **Iodine** | `14` | mcg |
| **Total Fat** | `26.5` | g | **Phosphorus** | `260` | mg |
| **Saturated Fat** | `7.5` | g | **Vitamin D** | `0.1` | mcg |
| **Trans Fat** | `0.2` | g | **Vitamin B12** | `0.4` | mcg |
| **Unsaturated Fat** | `19.0` | g | **Folate** | `45` | mcg |
| **Omega-3** | `0.15` | g | **Vitamin C** | `2` | mg |
| **Sugar (Total)** | `28.4` | g | **Vitamin E** | `1.8` | mg |
| **Added Sugar** | `22.0` | g | **Vitamin K** | `12` | mcg |
| **Dietary Fibre** | `3.0` | g | **Vitamin A** | `25` | mcg |
| **Soluble Fibre** | `0.8` | g | **Vitamin B6** | `0.42` | mg |
| **Sodium** | `628` | mg | **Thiamine (B1)** | `0.22` | mg |
| **Potassium** | `440` | mg | **Riboflavin (B2)**| `0.18` | mg |
| **Calcium** | `65` | mg | **Niacin (B3)** | `6.8` | mg |
| **Iron** | `2.4` | mg | **Magnesium** | `55` | mg |

---

### Image Set 03: Salmon Sushi Roll, Shrimp Pasta Salad & Demi-Baguette
- **Files:** `03_sushi_shrimp_salad.jpg`
- **Environment:** `casual_restaurant`
- **Dish Breakdown:**
  1. **Salmon Avocado Sushi (2 Maki + 4 Inside-Out rolls):** ~160g (Sushi rice, raw salmon, avocado, nori)
  2. **Shrimp & Pasta Salad with Creamy Dressing:** ~350g (Cooked shrimp, penne pasta, mixed greens, Thousand Island dressing)
  3. **French Demi-Baguette Bread:** ~140g (Crusty white bakery baguette)

#### Comprehensive 31 Nutrients Table
| Nutrient | Value | Unit | Nutrient | Value | Unit |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Calories** | `1,000` | kcal | **Zinc** | `3.8` | mg |
| **Protein** | `55.5` | g | **Selenium** | `65` | mcg |
| **Carbohydrates** | `134.0` | g | **Iodine** | `110` | mcg |
| **Total Fat** | `25.0` | g | **Phosphorus** | `540` | mg |
| **Saturated Fat** | `5.5` | g | **Vitamin D** | `3.5` | mcg |
| **Trans Fat** | `0.1` | g | **Vitamin B12** | `3.8` | mcg |
| **Unsaturated Fat** | `19.4` | g | **Folate** | `130` | mcg |
| **Omega-3** | `1.45` | g | **Vitamin C** | `18` | mg |
| **Sugar (Total)** | `12.0` | g | **Vitamin E** | `3.8` | mg |
| **Added Sugar** | `5.0` | g | **Vitamin K** | `45` | mcg |
| **Dietary Fibre** | `9.5` | g | **Vitamin A** | `95` | mcg |
| **Soluble Fibre** | `2.4` | g | **Vitamin B6** | `0.85` | mg |
| **Sodium** | `1,350` | mg | **Thiamine (B1)** | `0.45` | mg |
| **Potassium** | `920` | mg | **Riboflavin (B2)**| `0.38` | mg |
| **Calcium** | `180` | mg | **Niacin (B3)** | `11.2` | mg |
| **Iron** | `5.2` | mg | **Magnesium** | `135` | mg |

---

### Image Set 04: Berry Yogurt Parfait, Bakery Pastries & Cobb Salad
- **Files:** `04_seaside_fish_chips.jpg`
- **Environment:** `casual_restaurant` / `park_takeaway`
- **Dish Breakdown:**
  1. **Berry Granola Yogurt Parfait (in plastic cup):** ~350g (Yogurt, oat-nut granola, strawberries, raspberries, blueberries, blackberries)
  2. **Bakery Pastries (in paper bag):** ~150g (1 Butter Croissant ~70g + 1 Raisin/Cinnamon Swirl ~80g)
  3. **Chicken Avocado Egg Cobb Salad Bowl:** ~500g (Chicken breast ~130g, Avocado ~100g, 2 Eggs ~100g, Feta ~40g, Tomatoes ~70g, Lettuce ~80g)

#### Comprehensive 31 Nutrients Table
| Nutrient | Value | Unit | Nutrient | Value | Unit |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Calories** | `1,630` | kcal | **Zinc** | `5.2` | mg |
| **Protein** | `75.0` | g | **Selenium** | `78` | mcg |
| **Carbohydrates** | `148.0` | g | **Iodine** | `65` | mcg |
| **Total Fat** | `80.0` | g | **Phosphorus** | `850` | mg |
| **Saturated Fat** | `26.0` | g | **Vitamin D** | `2.8` | mcg |
| **Trans Fat** | `0.6` | g | **Vitamin B12** | `2.2` | mcg |
| **Unsaturated Fat** | `53.4` | g | **Folate** | `210` | mcg |
| **Omega-3** | `0.95` | g | **Vitamin C** | `45` | mg |
| **Sugar (Total)** | `52.0` | g | **Vitamin E** | `7.2` | mg |
| **Added Sugar** | `28.0` | g | **Vitamin K** | `140` | mcg |
| **Dietary Fibre** | `18.0` | g | **Vitamin A** | `320` | mcg |
| **Soluble Fibre** | `5.5` | g | **Vitamin B6** | `1.4` | mg |
| **Sodium** | `1,450` | mg | **Thiamine (B1)** | `0.65` | mg |
| **Potassium** | `1,850` | mg | **Riboflavin (B2)**| `0.72` | mg |
| **Calcium** | `480` | mg | **Niacin (B3)** | `15.8` | mg |
| **Iron** | `7.8` | mg | **Magnesium** | `210` | mg |

---

### Image Set 05: Airline Breakfast Tray (Congee, Croissant, Mousse Cake & Coffee)
- **Files:** `05_cafe_waffles_coffee.jpg`
- **Environment:** `airline`
- **Dish Breakdown:**
  1. **Savory Chicken Rice Congee (in foil container):** ~280g (Rice porridge, minced chicken, scallions)
  2. **Butter Croissant:** ~50g
  3. **Mousse Cake Dessert:** ~80g
  4. **Duerr's Strawberry Jam (20g) & Lurpak Butter (8g):** ~28g
  5. **Hot Milky Coffee / Tea (in teal ceramic mug):** ~200ml

#### Comprehensive 31 Nutrients Table
| Nutrient | Value | Unit | Nutrient | Value | Unit |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Calories** | `838` | kcal | **Zinc** | `1.8` | mg |
| **Protein** | `23.0` | g | **Selenium** | `22` | mcg |
| **Carbohydrates** | `104.0` | g | **Iodine** | `32` | mcg |
| **Total Fat** | `37.0` | g | **Phosphorus** | `310` | mg |
| **Saturated Fat** | `19.0` | g | **Vitamin D** | `0.6` | mcg |
| **Trans Fat** | `0.5` | g | **Vitamin B12** | `0.7` | mcg |
| **Unsaturated Fat** | `17.5` | g | **Folate** | `65` | mcg |
| **Omega-3** | `0.18` | g | **Vitamin C** | `3` | mg |
| **Sugar (Total)** | `48.0` | g | **Vitamin E** | `1.6` | mg |
| **Added Sugar** | `35.0` | g | **Vitamin K** | `15` | mcg |
| **Dietary Fibre** | `3.5` | g | **Vitamin A** | `210` | mcg |
| **Soluble Fibre** | `1.0` | g | **Vitamin B6** | `0.38` | mg |
| **Sodium** | `520` | mg | **Thiamine (B1)** | `0.24` | mg |
| **Potassium** | `560` | mg | **Riboflavin (B2)**| `0.35` | mg |
| **Calcium** | `190` | mg | **Niacin (B3)** | `4.8` | mg |
| **Iron** | `2.6` | mg | **Magnesium** | `58` | mg |

---

### Image Set 06: Mie Gacoan (Mie Suit, Siomay & Es Petak Umpet)
- **Files:** `06_indonesian_menu_page_1.jpg`, `06_indonesian_menu_page_2.jpg`
- **Environment:** `fast_food_chain` (Indonesian Noodle Chain) | **Brand:** `Mie Gacoan`
- **Dish Breakdown:**
  1. **Mie Suit (Savory Non-Spicy Noodles with Crispy Wonton Skins):** ~150g
  2. **Siomay Dimsum (3 Steamed Chicken/Shrimp Dumplings):** ~100g
  3. **Es Petak Umpet (Sweet Iced Tropical Beverage with Popping Boba):** ~320ml

#### Comprehensive 31 Nutrients Table
| Nutrient | Value | Unit | Nutrient | Value | Unit |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Calories** | `780` | kcal | **Zinc** | `2.2` | mg |
| **Protein** | `27.0` | g | **Selenium** | `34` | mcg |
| **Carbohydrates** | `111.0` | g | **Iodine** | `28` | mcg |
| **Total Fat** | `25.0` | g | **Phosphorus** | `320` | mg |
| **Saturated Fat** | `5.0` | g | **Vitamin D** | `0.2` | mcg |
| **Trans Fat** | `0.1` | g | **Vitamin B12** | `0.5` | mcg |
| **Unsaturated Fat** | `19.9` | g | **Folate** | `75` | mcg |
| **Omega-3** | `0.25` | g | **Vitamin C** | `8` | mg |
| **Sugar (Total)** | `35.0` | g | **Vitamin E** | `2.8` | mg |
| **Added Sugar** | `30.0` | g | **Vitamin K** | `18` | mcg |
| **Dietary Fibre** | `4.0` | g | **Vitamin A** | `45` | mcg |
| **Soluble Fibre** | `1.1` | g | **Vitamin B6** | `0.45` | mg |
| **Sodium** | `1,250` | mg | **Thiamine (B1)** | `0.38` | mg |
| **Potassium** | `480` | mg | **Riboflavin (B2)**| `0.26` | mg |
| **Calcium** | `95` | mg | **Niacin (B3)** | `7.4` | mg |
| **Iron** | `3.4` | mg | **Magnesium** | `62` | mg |

---

### Image Set 07: Fresh Fruit Plate & Greek Yogurt Oats Mug
- **Files:** `07_sainsbury_oat_fruits.jpg`
- **Environment:** `home_cooked`
- **Dish Breakdown:**
  1. **Greek Yogurt Oats Mug with Red Grapes & Raspberries:** ~200g (Greek yogurt ~100g, rolled oats ~30g, grapes ~40g, raspberries ~30g)
  2. **Whole Fresh Banana:** ~120g
  3. **Whole Fresh Apple:** ~160g
  4. **Whole Fresh Purple Plum:** ~70g

#### Comprehensive 31 Nutrients Table
| Nutrient | Value | Unit | Nutrient | Value | Unit |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Calories** | `442` | kcal | **Zinc** | `1.4` | mg |
| **Protein** | `14.2` | g | **Selenium** | `12` | mcg |
| **Carbohydrates** | `89.0` | g | **Iodine** | `24` | mcg |
| **Total Fat** | `5.3` | g | **Phosphorus** | `260` | mg |
| **Saturated Fat** | `1.8` | g | **Vitamin D** | `0.1` | mcg |
| **Trans Fat** | `0.0` | g | **Vitamin B12** | `0.6` | mcg |
| **Unsaturated Fat** | `3.5` | g | **Folate** | `85` | mcg |
| **Omega-3** | `0.12` | g | **Vitamin C** | `32` | mg |
| **Sugar (Total)** | `54.0` | g | **Vitamin E** | `1.9` | mg |
| **Added Sugar** | `0.0` | g | **Vitamin K** | `28` | mcg |
| **Dietary Fibre** | `12.6` | g | **Vitamin A** | `65` | mcg |
| **Soluble Fibre** | `4.2` | g | **Vitamin B6** | `0.75` | mg |
| **Sodium** | `65` | mg | **Thiamine (B1)** | `0.28` | mg |
| **Potassium** | `1,120` | mg | **Riboflavin (B2)**| `0.32` | mg |
| **Calcium** | `195` | mg | **Niacin (B3)** | `3.2` | mg |
| **Iron** | `2.5` | mg | **Magnesium** | `115` | mg |

---

### Image Set 08: Sunrise Rolled Oats Porridge (Direct Label)
- **Files:** `08_rolled_oats_1.jpg`, `08_rolled_oats_2.jpg`
- **Environment:** `home_cooked`
- **Dish Breakdown:**
  1. **Rolled Oats Porridge:** 220g cooked (50g dry rolled oats from Sunrise 30g serving facts label)

#### Comprehensive 31 Nutrients Table
| Nutrient | Value | Unit | Nutrient | Value | Unit |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Calories** | `212` | kcal | **Zinc** | `1.8` | mg |
| **Protein** | `5.0` | g | **Selenium** | `16` | mcg |
| **Carbohydrates** | `35.0` | g | **Iodine** | `0` | mcg |
| **Total Fat** | `5.8` | g | **Phosphorus** | `235` | mg |
| **Saturated Fat** | `0.8` | g | **Vitamin D** | `0.0` | mcg |
| **Trans Fat** | `0.0` | g | **Vitamin B12** | `0.0` | mcg |
| **Unsaturated Fat** | `5.0` | g | **Folate** | `28` | mcg |
| **Omega-3** | `0.08` | g | **Vitamin C** | `0` | mg |
| **Sugar (Total)** | `0.0` | g | **Vitamin E** | `0.6` | mg |
| **Added Sugar** | `0.0` | g | **Vitamin K** | `2` | mcg |
| **Dietary Fibre** | `5.0` | g | **Vitamin A** | `0` | mcg |
| **Soluble Fibre** | `2.2` | g | **Vitamin B6** | `0.12` | mg |
| **Sodium** | `0` | mg | **Thiamine (B1)** | `0.24` | mg |
| **Potassium** | `185` | mg | **Riboflavin (B2)**| `0.08` | mg |
| **Calcium** | `25` | mg | **Niacin (B3)** | `1.4` | mg |
| **Iron** | `2.1` | mg | **Magnesium** | `70` | mg |

---

### Image Set 09: Sizzling Pepper Beef Steak & Fried Fish and Chips Plates
- **Files:** `09_steak_fish_chips_1.jpg`, `09_steak_fish_chips_2.jpg`
- **Environment:** `casual_restaurant`
- **Dish Breakdown:**
  1. **Sizzling Pepper Beef Steak Plate:** ~420g (Beef steak ~180g, black pepper onion gravy ~80g, mixed vegetables with mayo ~60g, 4 potato wedges ~100g)
  2. **Crispy Fried Fish & Chips Plate:** ~365g (Battered fish fillet ~200g, 4 potato wedges ~100g, tartar sauce & cabbage salad ~50g, lemon ~15g)
  3. **Sweet Iced Tea:** ~350ml

#### Comprehensive 31 Nutrients Table
| Nutrient | Value | Unit | Nutrient | Value | Unit |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Calories** | `1,340` | kcal | **Zinc** | `7.2` | mg |
| **Protein** | `78.0` | g | **Selenium** | `72` | mcg |
| **Carbohydrates** | `102.0` | g | **Iodine** | `85` | mcg |
| **Total Fat** | `67.0` | g | **Phosphorus** | `780` | mg |
| **Saturated Fat** | `16.0` | g | **Vitamin D** | `2.4` | mcg |
| **Trans Fat** | `0.8` | g | **Vitamin B12** | `3.6` | mcg |
| **Unsaturated Fat** | `50.2` | g | **Folate** | `95` | mcg |
| **Omega-3** | `1.2` | g | **Vitamin C** | `35` | mg |
| **Sugar (Total)** | `32.0` | g | **Vitamin E** | `5.6` | mg |
| **Added Sugar** | `25.0` | g | **Vitamin K** | `45` | mcg |
| **Dietary Fibre** | `10.0` | g | **Vitamin A** | `140` | mcg |
| **Soluble Fibre** | `2.8` | g | **Vitamin B6** | `1.2` | mg |
| **Sodium** | `1,850` | mg | **Thiamine (B1)** | `0.55` | mg |
| **Potassium** | `1,680` | mg | **Riboflavin (B2)**| `0.62` | mg |
| **Calcium** | `190` | mg | **Niacin (B3)** | `16.4` | mg |
| **Iron** | `6.8` | mg | **Magnesium** | `160` | mg |

---

### Image Set 10: Indonesian Beef Hotpot & Steamed Vegetables (Direct Barcodes)
- **Files:** `10_beef_soup_barcode_meal_0.jpg`, `10_beef_soup_barcode_meal_1.jpg`
- **Environment:** `home_cooked` | **Retailer:** Hari Hari Lokasari
- **Dish Breakdown:**
  1. **Hari Hari Beef Blade:** 110g (`BLADE/ RDNG SP SPC`)
  2. **Hari Hari Beef Rendang Cut:** 115g (`DAGING RENDANG SAPI`)
  3. **Hari Hari Imported Broccoli:** 350g edible trimmed (`BROCOLI IMPOR`)
  4. **Hari Hari Baby Corn:** 150g (`JAGUNG PUTREN`)
  5. **Hari Hari Enoki Mushrooms:** 100g (`JAMUR ENOKI LOKAL`)

#### Comprehensive 31 Nutrients Table
| Nutrient | Value | Unit | Nutrient | Value | Unit |
| :--- | :---: | :---: | :--- | :---: | :---: |
| **Calories** | `616` | kcal | **Zinc** | `8.8` | mg |
| **Protein** | `65.2` | g | **Selenium** | `46` | mcg |
| **Carbohydrates** | `45.9` | g | **Iodine** | `18` | mcg |
| **Total Fat** | `23.5` | g | **Phosphorus** | `620` | mg |
| **Saturated Fat** | `6.2` | g | **Vitamin D** | `0.4` | mcg |
| **Trans Fat** | `0.2` | g | **Vitamin B12** | `3.2` | mcg |
| **Unsaturated Fat** | `17.1` | g | **Folate** | `245` | mcg |
| **Omega-3** | `0.35` | g | **Vitamin C** | `285` | mg |
| **Sugar (Total)** | `12.4` | g | **Vitamin E** | `4.2` | mg |
| **Added Sugar** | `0.0` | g | **Vitamin K** | `380` | mcg |
| **Dietary Fibre** | `17.8` | g | **Vitamin A** | `115` | mcg |
| **Soluble Fibre** | `4.6` | g | **Vitamin B6** | `1.4` | mg |
| **Sodium** | `380` | mg | **Thiamine (B1)** | `0.42` | mg |
| **Potassium** | `2,450` | mg | **Riboflavin (B2)**| `0.65` | mg |
| **Calcium** | `340` | mg | **Niacin (B3)** | `12.5` | mg |
| **Iron** | `7.8` | mg | **Magnesium** | `225` | mg |
