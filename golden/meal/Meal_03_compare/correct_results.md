# Golden Meal 03 — Compare Mode (Mode D) Correct Results & Benchmark Reference Ground Truth

**Benchmark ID:** `Meal_03_compare`  
**Evaluation Standard:** Vision Scout Single-Pass Mode D Architecture (`gemini-3.5-flash-lite`)  
**Input Condition:** **Pure Image Upload (`userPrompt: ""`, zero text prompt)**  
**Active Patient Profile Targets:**
- Saturated Fat: `+38% surplus`
- Added Sugar: `+50% surplus`
- Calories: `+39% surplus`
- Protein: `-17% deficit`
- Sodium: `+30% surplus`
- Carbohydrates: `+32% surplus`
- Total Dietary Fibre: `-26% deficit`

---

## 1. Transposed Benchmark Ground Truth Matrix (Sets as Columns)

The definitive reference ground truth across all 6 test cases evaluated with **blank user input**:

| Benchmark Dimension / Metric | Set 1: Bakery & Chocolate | Set 2: 4 Snack & Bread Labels | Set 3: Restaurant Menu (Pencok 89) | Set 4: Juice & Beverage List | Set 5: Street Food & Seafood Banner | Set 6: Supermarket Chip Aisle |
|---|---|---|---|---|---|---|
| **Domain & Real-World Context** | Retail bakery display + packaged confectionery | Packaged bread & snack nutrition fact panels | Casual Indonesian dine-in laminated multi-page menu | Cafe beverage & dessert counter price board | Street food tent / warung hanging menu banner | Supermarket snack aisle gondola shelving |
| **Input Photos** | 3 photos (`set1_*.jpg`) | 4 photos (`set2_*.jpg`) | 2 photos (`set3_*.jpg`) | 1 photo (`set4_*.jpg`) | 1 photo (`set5_*.jpg`) | 1 photo (`set6_*.jpg`) |
| **Exhaustive Dishes / Items Count** | **6 items** | **4 items** | **104 items** | **32 items** | **56 items** | **17 items** |
| **Groups Formed ($\le$ 10% Macro Variance)** | **3 groups** | **4 groups** | **4 groups** | **4 groups** | **4 groups** | **4 groups** |
| **Direct OCR Transcription Locks** | Verbatim printed SilverQueen label locked | All 4 printed nutrition panels locked verbatim | Multi-column items & combo descriptions parsed | Board columns & drink categories captured | 4 banner columns parsed exhaustively | Shelf brands & package sizes classified |
| **Bilingual Name Translation (`Local / English`)** | **6/6 (100%)** | **4/4 (100%)** | **104/104 (100%)** | **32/32 (100%)** | **56/56 (100%)** | **17/17 (100%)** |
| **Bounding Box Quadrants (`boundingBox2D`)** | Regional framing on shelf & chocolate packages | Regional framing on 4 label panels | Regional framing across menu pages 1 & 2 | Regional framing on board categories | Column-based framing across banner | Shelf-tier framing on gondola levels |
| **Total Nutrients (10 Allowance Keys)** | Complete (Serving & 100g)<br>Deterministic TS derivation | Complete (Serving & 100g)<br>Deterministic TS derivation | Complete (Serving & 100g)<br>Deterministic TS derivation | Complete (Serving & 100g)<br>Deterministic TS derivation | Complete (Serving & 100g)<br>Deterministic TS derivation | Complete (Serving & 100g)<br>Deterministic TS derivation |
| **Personalized Target Utilization** | Penalizes +50% sugar & +38% sat fat | Penalizes +39% calorie & +32% carb surplus | Penalizes +30% sodium & +38% sat fat | Promotes zero-sugar, penalizes syrups | Rewards whole fish for -17% protein deficit | Rewards single-serving, penalizes family bags |
| **Highlight Unlisted Harms vs. Benefits** | Trans fats (0.2g) & cocoa butter sat fat isolated | Low-fat portion snack vs saturated custard loaf | Marine Omega-3s vs deep-fry lipid peroxides & seblak | Pure water vs condensed milk & syrups | Tangy poached fish vs deep-fried batter & seblak | Whole corn grain vs extruded starches & trans fats |
| **Intra-Group Sorting by Health Value** | Cheese buns ahead of chocolate glaze | Low-sugar blue bread ahead of sweet loaves | Clear fish broths ahead of fried poultry | Unsweetened water ahead of pureed juices | Poached Garang Asem ahead of oil-brushed grill | Baked corn tortilla ahead of MSG-dusted chips |
| **Clinical Recommendation / Best Option** | **Polo Keju / Cheese Polo Bread** | **Snack Pack / Green Packaging Snack** | **Ikan Kembung / Sayur Asem** | **Es Kelapa Muda / Young Coconut Water** | **Ikan Nila Garang Asem + Nasi** | **Happy Tos / Tortilla Chips Corn Flavor** |

---

## 2. Exhaustive Case-by-Case Analysis & Item Inventories

### Case 1: Set 1 — Bakery Shelf & SilverQueen Chocolate
- **Photos:**
  - Photo `#0`: `set1_silverqueen_chocolate_front.jpg`
  - Photo `#1`: `set1_silverqueen_nutrition_label.jpg`
  - Photo `#2`: `set1_saybread_bakery_shelf.jpg`
- **Total Legible Items (6 items):**
  1. `SilverQueen Milk Chocolate with Cashews / SilverQueen Susu Cokelat dengan Kacang Mede` (Packaged confectionery bar with cashew nuts, 20g serving, 2.5 serv/pack, 52g net)
  2. `Say Bread - Polo Keju / Cheese Polo Bread` (Top shelf, soft yeast bread bun with golden cheese crust)
  3. `Say Bread - Polo Cokelat / Chocolate Polo Bread` (Top shelf, soft yeast bread bun with chocolate cookie topping)
  4. `Say Bread - Double Cheese Bread / Double Cheese Bread` (Middle shelf, savory soft bun with melted cheddar topping and filling)
  5. `Say Bread - Choco Topping Pie / Chocolate Topping Pie` (Bottom shelf, laminated flaky pastry pie with dark chocolate glaze)
  6. `Say Bread - Cheese Topping Pie / Cheese Topping Pie` (Bottom shelf, laminated flaky pastry pie with glazed cheese custard)

#### Correct Groups & Clinical Reasoning:
- **Group 1: Tier 2 - Neutral: Soft Yeast Bakery Buns (`Polo & Double Cheese`)**
  - Targeted Image: Photo `#2` | Bounding Box: `[170, 1, 600, 998]`
  - Serving: `80g` | Calories: `272 kcal` (`340 kcal/100g`)
  - Nutrients per 100g: Protein 8.0g, Total Fat 12.0g, Sat Fat 4.8g, Carbs 50.0g, Sugar 16.0g, Sodium 280mg, Fibre 2.0g
  - Items (Sorted): `Say Bread - Polo Keju / Cheese Polo Bread`, `Say Bread - Double Cheese Bread / Double Cheese Bread`, `Say Bread - Polo Cokelat / Chocolate Polo Bread`
  - Clinical Verdict: `neutral` — *"Higher Carbohydrate Bakery Staples"*
  - Comparison: *"Unlike dense chocolate bars or laminated pies, these yeast buns contain softer saturated fat loads, though they still contribute to your active carbohydrate surplus."*
- **Group 2: Tier 3 - Warning: Laminated Flaky Pastry Pies (`Choco & Cheese Pies`)**
  - Targeted Image: Photo `#2` | Bounding Box: `[600, 1, 950, 998]`
  - Serving: `85g` | Calories: `323 kcal` (`380 kcal/100g`)
  - Nutrients per 100g: Protein 6.5g, Total Fat 18.0g, Sat Fat 9.0g, Carbs 48.0g, Sugar 18.0g, Sodium 320mg, Trans Fat 0.2g
  - Items (Sorted): `Say Bread - Cheese Topping Pie / Cheese Topping Pie`, `Say Bread - Choco Topping Pie / Chocolate Topping Pie`
  - Clinical Verdict: `warning` — *"Laminated Pastry Fats & Sugar"*
  - Comparison: *"These pastry pies rely on laminated shortening that introduces industrial trans fats and doubled saturated fats compared to plain yeast buns."*
- **Group 3: Tier 4 - Alert: High-Density Confectionery Bar (`SilverQueen`)**
  - Targeted Image: Photo `#0` | Bounding Box: `[0, 200, 995, 525]`
  - Serving: `20g` (Printed label) / `52g` (Full bar) | Calories: `110 kcal` (serving) / `286 kcal` (bar) (`550 kcal/100g`)
  - Nutrients per 100g: Protein 10.0g, Total Fat 35.0g, Sat Fat 17.5g, Carbs 50.0g, Sugar 45.0g, Added Sugar 42.0g, Sodium 100mg
  - Items: `SilverQueen Milk Chocolate with Cashews / SilverQueen Susu Cokelat dengan Kacang Mede`
  - Clinical Verdict: `alert` — *"Severe Sugar & Saturated Fat Hazard"*
  - Comparison: *"This chocolate confectionery packs extreme saturated fat (17.5g/100g) and added sugar (42g/100g) that directly clash with your active +38% saturated fat and +50% sugar surpluses."*

---

### Case 2: Set 2 — 4 Reference Snack & Bread Nutrition Labels
- **Photos:**
  - Photo `#0`: `set2_snack_pack_front.jpg`
  - Photo `#1`: `set2_snack_green_bar_label.jpg`
  - Photo `#2`: `set2_snack_yellow_cake_label.jpg`
  - Photo `#3`: `set2_snack_blue_bread_label.jpg`
- **Total Legible Items (4 items):**
  1. `Green Package Snack Bread / Roti Kemasan Hijau Kecil` (Small individual portion bread roll, 23g)
  2. `Soft Bread (Blue Package) / Roti Tawar Lembut Bungkus Biru` (Single slice enriched sandwich bread, 44g)
  3. `Sweet Custard Bread (Yellow Package 75g) / Roti Manis Isi Kastard Bungkus Kuning` (Filled custard sweet bun, 75g)
  4. `Multiseed Sweet Loaf (Yellow/Green Package 80g) / Roti Manis Multiseed Bungkus Kuning 80g` (Dense sweet bun with grain seeds, 80g)

#### Correct Groups & Clinical Reasoning:
- **Group 1: Tier 1 - Safest Choice: Low-Fat Controlled-Portion Snack**
  - Targeted Image: Photo `#0` / `#1` | Bounding Box: `[360, 0, 760, 1000]`
  - Serving: `23g` | Calories: `90 kcal` (`391.3 kcal/100g`)
  - Nutrients: Protein 1g, Fat 3g, Sat Fat 1g, Carbs 15g, Sugar 7g, Sodium 20mg
  - Items: `Green Package Snack Bread / Roti Kemasan Hijau Kecil`
  - Clinical Verdict: `good` — *"Lowest Saturated Fat & Smallest Energy Load"*
- **Group 2: Tier 2 - Neutral: Low-Sugar Staple Bread**
  - Targeted Image: Photo `#3` | Bounding Box: `[300, 0, 920, 1000]`
  - Serving: `44g` | Calories: `120 kcal` (`272.7 kcal/100g`)
  - Nutrients: Protein 4g, Fat 2.5g, Sat Fat 1.5g, Carbs 21g, Sugar 2g, Sodium 150mg
  - Items: `Soft Bread (Blue Package) / Roti Tawar Lembut Bungkus Biru`
  - Clinical Verdict: `neutral` — *"Low Sugar Staple Carbohydrate"*
- **Group 3: Tier 3 - Warning: High Saturated Fat Custard Pastry**
  - Targeted Image: Photo `#2` | Bounding Box: `[230, 0, 990, 1000]`
  - Serving: `75g` | Calories: `250 kcal` (`333.3 kcal/100g`)
  - Nutrients: Protein 4g, Fat 6g, Sat Fat 4.5g, Carbs 42g, Sugar 6g, Sodium 125mg
  - Items: `Sweet Custard Bread (Yellow Package 75g) / Roti Manis Isi Kastard Bungkus Kuning`
  - Clinical Verdict: `warning` — *"High Saturated Fat Spike"*
- **Group 4: Tier 4 - Alert: Ultra-High Sugar & Sodium Pastry**
  - Targeted Image: Photo `#2` | Bounding Box: `[250, 0, 920, 1000]`
  - Serving: `80g` | Calories: `250 kcal` (`312.5 kcal/100g`)
  - Nutrients: Protein 3g, Fat 7g, Sat Fat 3g, Carbs 38g, Sugar 38g, Sodium 330mg
  - Items: `Multiseed Sweet Loaf (Yellow/Green Package 80g) / Roti Manis Multiseed Bungkus Kuning 80g`
  - Clinical Verdict: `alert` — *"Excessive Added Sugar (47.5g/100g) & Sodium Hazard"*

---

### Case 3: Set 3 — Restaurant Menu Pages (Sambal Bakar Pencok 89)
- **Photos:**
  - Photo `#0`: `set3_restaurant_menu_page1.jpg`
  - Photo `#1`: `set3_restaurant_menu_page2.jpg`
- **Total Legible Items (104 items across both pages):**

#### Page 1 Full Inventory (43 items):
1. `Kerupuk Mie + Bumbu Kacang / Yellow Noodle Crackers with Savory Peanut Sauce`
2. `Asinan Buah Bogor / Bogor Preserved Sweet & Tangy Tropical Fruit Salad`
3. `Asinan Sayur Rujak Pengantin / Pickled Vegetable Salad with Spiced Peanut Dressing`
4. `Sate Usus / Skewered Braised & Fried Chicken Intestines`
5. `Sate Ati-Ampela / Skewered Braised Chicken Liver and Gizzard`
6. `Sate Kulit / Crispy Deep-Fried Chicken Skin Skewers`
7. `Paket Burung Puyuh / Quail Meal Set (Rice + Quail + Tamarind Soup + Tempeh + Tofu)`
8. `Paket Uduk Burung Puyuh / Quail Coconut Rice Meal Set (Coconut Rice + Quail + Tamarind Soup + Tempeh + Tofu)`
9. `Paket Ayam Goreng / Fried Chicken Meal Set (Rice + Fried Chicken + Tamarind Soup + Tofu + Tempeh)`
10. `Paket Ayam Bakar / Grilled Chicken Meal Set (Rice + Grilled Chicken + Tamarind Soup + Tofu + Tempeh)`
11. `Paket Uduk Ayam Goreng / Fried Chicken Coconut Rice Set (Coconut Rice + Fried Chicken + Tamarind Soup + Tofu + Tempeh)`
12. `Paket Uduk Ayam Bakar / Grilled Chicken Coconut Rice Set (Coconut Rice + Grilled Chicken + Tamarind Soup + Tofu + Tempeh)`
13. `Paket Empal / Sweet Spiced Beef Empal Set (Rice + Beef Empal + Tamarind Soup + Tofu + Tempeh)`
14. `Paket Uduk Empal / Sweet Spiced Beef Empal Coconut Rice Set (Coconut Rice + Beef Empal + Tamarind Soup + Tofu + Tempeh)`
15. `Paket Bebek Goreng / Fried Duck Meal Set (Rice + Fried Duck + Tamarind Soup + Tofu + Tempeh)`
16. `Paket Uduk Bebek Goreng / Fried Duck Coconut Rice Set (Coconut Rice + Fried Duck + Tamarind Soup + Tofu + Tempeh)`
17. `Paket Lele Goreng / Fried Catfish Meal Set (Rice + 2pcs Fried Catfish + Tamarind Soup + Tofu + Tempeh)`
18. `Paket Uduk Lele Goreng / Fried Catfish Coconut Rice Set (Coconut Rice + 2pcs Catfish + Tamarind Soup + Tofu + Tempeh)`
19. `Paket Ikan Kembung / Whole Mackerel Meal Set (Rice + Mackerel + Tamarind Soup + Tofu + Tempeh)`
20. `Paket Uduk Ikan Kembung / Whole Mackerel Coconut Rice Set (Coconut Rice + Mackerel + Tamarind Soup + Tofu + Tempeh)`
21. `Paket Ikan Mujair Goreng / Fried Tilapia Mujair Meal Set (Rice + Mujair + Tamarind Soup + Tofu + Tempeh)`
22. `Paket Uduk Ikan Mujair / Fried Mujair Coconut Rice Set (Coconut Rice + Mujair + Tamarind Soup + Tofu + Tempeh)`
23. `Paket Ikan Nila Goreng / Fried Tilapia Nila Meal Set (Rice + Nila + Tamarind Soup + Tofu + Tempeh)`
24. `Paket Uduk Ikan Nila / Fried Nila Coconut Rice Set (Coconut Rice + Nila + Tamarind Soup + Tofu + Tempeh)`
25. `Pencok Kacang / Long Beans in Fresh Kencur Chili Relish`
26. `Pencok Kacang + Ketimun / Long Beans and Cucumber in Fresh Chili Relish`
27. `Ayam Goreng Cabe Kering / Fried Chicken with Dried Chili`
28. `Pencok Ceker / Braised Chicken Feet in Fresh Chili Relish`
29. `Pencok Tahu / Tempe / Fried Tofu and Tempeh in Fresh Chili Relish`
30. `Ayam Geprek Selera Pedas / Crispy Smashed Chicken with Spicy Sambal`
31. `Pencok Kepala Ayam / Fried Chicken Heads in Fresh Chili Relish`
32. `Pencok Kulit / Crispy Fried Chicken Skin in Fresh Chili Relish`
33. `Pencok Ampela / Usus / Ati / Chicken Innards in Fresh Chili Relish`
34. `Karedok ala Pencok 89 / Sundanese Fresh Raw Vegetable Salad with Peanut Dressing`
35. `Pencok Ayam Goreng / Fried Chicken in Fresh Chili Relish`
36. `Pencok Ayam Bakar / Grilled Chicken in Fresh Chili Relish`
37. `Pencok Daging Empal / Sweet Spiced Beef Empal in Fresh Chili Relish`
38. `Pencok Ikan Nila Goreng / Fried Tilapia in Fresh Chili Relish`
39. `Pencok Ikan Mujair Goreng / Fried Mujair in Fresh Chili Relish`
40. `Pencok Lele Goreng / Fried Catfish in Fresh Chili Relish`
41. `Pencok Ikan Kembung / Whole Mackerel in Fresh Chili Relish`
42. `Pencok Bebek Goreng Presto / Pressure-Cooked Crispy Duck in Fresh Chili Relish`
43. `Pencok Burung Puyuh / Crispy Quail in Fresh Chili Relish`

#### Page 2 Full Inventory (61 items):
44. `Jengkol Pencok / Jengkol Beans in Fresh Kencur Chili Relish`
45. `Jengkol Balado / Jengkol Beans in Red Chili Balado Sauce`
46. `Jengkol Semur / Jengkol Beans Stewed in Sweet Soy and Spices`
47. `Jengkol Goreng / Fried Jengkol Beans`
48. `Sate Taichan Juara / Lean Grilled Chicken Breast Skewers with Chili Dip`
49. `Tumis Kangkung / Stir-Fried Water Spinach with Chili and Garlic`
50. `Tumis Caisim / Stir-Fried Chinese Mustard Greens`
51. `Tumis Genjer ala Pencok 89 / Stir-Fried Yellow Velvetleaf Greens`
52. `Tumis Sawi Putih / Stir-Fried Napa Cabbage`
53. `Tumis Sawi Putih + Telor / Stir-Fried Napa Cabbage with Scrambled Egg`
54. `Tumis Toge / Stir-Fried Fresh Bean Sprouts`
55. `Tumis Toge + Ikan Asin / Stir-Fried Bean Sprouts with Salted Fish Pieces`
56. `Tumis Oncom / Stir-Fried Fermented Soybean Oncom with Basil`
57. `Tumis Udang Balado / Stir-Fried Shrimp in Spicy Balado Sauce`
58. `Tumis Udang + Pete Bumbu Balado / Stir-Fried Shrimp and Stink Beans in Balado`
59. `Tumis Cumi Balado / Stir-Fried Squid in Spicy Balado Sauce`
60. `Tumis Cumi + Pete Bumbu Balado / Stir-Fried Squid and Stink Beans in Balado`
61. `Tumis Peda / Stir-Fried Salted Mackerel Peda Fish`
62. `Tumis Peda + Pete / Stir-Fried Salted Peda Fish with Stink Beans`
63. `Tumis Cue / Stir-Fried Braised Cured Tuna Fish`
64. `Tumis Cue + Pete / Stir-Fried Cured Tuna Fish with Stink Beans`
65. `Sop Ayam Kampung / Free-Range Chicken Clear Vegetable Soup`
66. `Sop Daging Sapi / Clear Beef Vegetable Broth with Carrots and Potatoes`
67. `Soto Betawi Daging Sapi / Betawi Beef Soup in Rich Coconut Milk Broth`
68. `Soto Betawi Ayam Kampung / Betawi Chicken Soup in Rich Coconut Milk Broth`
69. `Sayur Sop Ceker / Clear Vegetable Broth with Chicken Feet`
70. `Sayur Asem / Sundanese Tangy Tamarind Vegetable Soup`
71. `Rujak Kangkung / Plecing Kangkung / Blanched Water Spinach with Spicy Sambal`
72. `Kangkung Rebus / Plain Boiled Water Spinach`
73. `Lalapan Rebus (Labu + Kangkung + Kcg Pjg) / Boiled Vegetable Medley (Chayote, Water Spinach, Long Beans)`
74. `Terong Balado / Pan-Fried Eggplant in Red Balado Sauce`
75. `Kol Goreng / Deep-Fried Cabbage Leaves in Recurrent Frying Oil`
76. `Tahu Acak / Scrambled Spicy Tofu Hash`
77. `Pepes Tahu / Steamed Herb-Spiced Tofu Wrapped in Banana Leaf`
78. `Pepes Peda Mix Pete / Steamed Salted Peda Fish and Stink Beans in Banana Leaf`
79. `Pete Goreng / Bakar / Mentah / Fried, Charred, or Raw Stink Beans`
80. `Telur Dadar / Deep-Fried Fluffy Indonesian Egg Omelette`
81. `Cumi Asin Goreng / Deep-Fried Heavily Salted Baby Squid`
82. `Ikan Asin Peda Cabe Pencok / Salted Peda Fish with Raw Kencur Chili Relish`
83. `Ikan Teri Jengki Sambal Pencok / Salted Jengki Anchovies with Fresh Chili Relish`
84. `Ikan Asin Sepat / Deep-Fried Salted Sepat Fish`
85. `Ikan Asin Jambal / Deep-Fried Giant Salted Jambal Roti Fish`
86. `Ikan Asin Gabus / Deep-Fried Salted Snakehead Fish Fillet`
87. `Nasi Putih / Steamed Plain White Rice`
88. `Nasi Uduk / Fragrant Coconut Milk Steamed Rice`
89. `Nasi Bakar Cakalang / Charred Banana Leaf Rice with Shredded Skipjack Tuna`
90. `Nasi Bakar Ayam + Teri Medan / Charred Banana Leaf Rice with Chicken and Anchovies`
91. `Nasi Bakar Ayam Cumi Cabe Ijo / Charred Banana Leaf Rice with Chicken and Green Chili Squid`
92. `Nasi Goreng Ayam / Wok-Fried Rice with Shredded Chicken and Sweet Soy`
93. `Nasi Goreng Ikan Asin / Wok-Fried Rice with Salted Fish Bits`
94. `Nasi Goreng Pete / Wok-Fried Rice with Stink Beans`
95. `Nasi Goreng Ati / Ampela / Wok-Fried Rice with Chicken Liver and Gizzard`
96. `Nasi Goreng ala Pencok 89 / House Signature Fried Rice with Mixed Meats`
97. `Seblak Complete / Sundanese Spicy Stewed Tapioca Crackers with Mixed Toppings`
98. `Seblak Ceker / Spicy Stewed Tapioca Crackers with Braised Chicken Feet`
99. `Seblak Sea Food / Spicy Stewed Tapioca Crackers with Squid, Fishballs, and Shrimp`
100. `Seblak Cret Viral / Extra Fiery Viral Stewed Tapioca Crackers`
101. `Bubur Ayam / Rice Congee with Shredded Chicken, Celery, and Broth`
102. `Mie Ayam Original / Egg Noodles with Sweet Soy Diced Chicken and Broth`
103. `Mie Ayam Ceker / Bakso / Pangsit / Chicken Noodles with Meatballs, Wontons, and Chicken Feet`
104. `Bubur Manis (Sumsum / Ketan Hitam / Kacang Hijau / Singkong Thai / Kolang Kaling) / Traditional Sweet Coconut Porridge Desserts`

#### Correct Groups & Clinical Reasoning (Set 3):
- **Group 1: Tier 1 - Safest Choice: Clear Broths, Boiled Greens & Lean Steamed Dishes (12 items)**
  - Targeted Image: Photo `#1` | Bounding Box: `[400, 100, 520, 920]`
  - Average Nutrients per 100g: `75 kcal`, Protein 9.0g, Total Fat 2.5g, Sat Fat 0.6g, Carbs 5.0g, Sugar 1.2g, Sodium 290mg, Fibre 2.8g
  - Core Items: `Sayur Asem / Sundanese Tangy Tamarind Vegetable Soup`, `Kangkung Rebus / Plain Boiled Water Spinach`, `Lalapan Rebus / Boiled Vegetable Medley`, `Pepes Tahu / Steamed Tofu in Banana Leaf`, `Sop Ayam Kampung / Free-Range Chicken Soup`, `Sop Daging Sapi / Clear Beef Soup`, `Sate Taichan Juara / Lean Grilled Chicken Skewers`
  - Clinical Rationale: Cardioprotective. Minimal saturated fat, high soluble and insoluble fiber, closes protein deficit without contributing to caloric or sodium surplus.
- **Group 2: Tier 2 - Neutral: Whole Marine Fish & Sautéed Stir-Fried Greens (25 items)**
  - Targeted Image: Photo `#0` & `#1` | Bounding Box: `[150, 80, 420, 920]`
  - Average Nutrients per 100g: `140 kcal`, Protein 14.0g, Total Fat 6.0g, Sat Fat 1.2g, Carbs 8.0g, Sugar 1.8g, Sodium 420mg, Fibre 2.2g
  - Core Items: `Paket Ikan Kembung / Whole Mackerel Meal Set`, `Paket Ayam Bakar / Grilled Chicken Meal Set`, `Tumis Kangkung / Stir-Fried Water Spinach`, `Tumis Sawi Putih / Stir-Fried Napa Cabbage`, `Tumis Toge / Stir-Fried Bean Sprouts`, `Nasi Bakar Cakalang / Banana Leaf Rice with Skipjack Tuna`
  - Clinical Rationale: Mackerel and tuna deliver unlisted marine Omega-3 fatty acids (EPA/DHA) that improve lipid profiles. Moderate oil from wok sautéing.
- **Group 3: Tier 3 - Warning: Deep-Fried Poultry, Catfish & Heavy Balado Dishes (35 items)**
  - Targeted Image: Photo `#0` & `#1` | Bounding Box: `[300, 80, 750, 920]`
  - Average Nutrients per 100g: `220 kcal`, Protein 15.0g, Total Fat 14.5g, Sat Fat 4.8g, Carbs 12.0g, Sugar 2.5g, Sodium 680mg, Fibre 1.2g
  - Core Items: `Paket Ayam Goreng / Fried Chicken Meal Set`, `Paket Bebek Goreng / Fried Duck Meal Set`, `Paket Lele Goreng / Fried Catfish Meal Set`, `Paket Empal / Beef Empal Set`, `Ayam Geprek Selera Pedas / Smashed Fried Chicken`, `Telur Dadar / Fried Omelette`, `Terong Balado / Eggplant Balado`
  - Clinical Rationale: High saturated palm oil absorption and thermal oxidation peroxides directly worsen the patient's +38% saturated fat surplus and elevated LDL.
- **Group 4: Tier 4 - Alert: Ultra-High Sodium Salted Fish, Organ Meats, Deep-Fried Cabbage & Seblak (32 items)**
  - Targeted Image: Photo `#0` & `#1` | Bounding Box: `[700, 80, 990, 990]`
  - Average Nutrients per 100g: `260 kcal`, Protein 8.0g, Total Fat 13.0g, Sat Fat 5.0g, Carbs 32.0g, Sugar 4.0g, Sodium 1250mg, Fibre 1.0g
  - Core Items: `Kol Goreng / Deep-Fried Cabbage`, `Sate Kulit / Crispy Fried Chicken Skin`, `Cumi Asin Goreng / Deep-Fried Salted Squid`, `Ikan Asin Peda / Jambal / Sepat`, `Seblak Complete / Spicy Stewed Tapioca Crackers`, `Seblak Ceker / Tapioca Stew with Feet`, `Nasi Goreng Ikan Asin`
  - Clinical Rationale: Extreme metabolic hazard. Kol Goreng absorbs concentrated acrolein and oxidized fatty acids; salted fish exceeds 1800mg sodium per serving; Seblak gelatinized tapioca starches trigger massive glycemic spikes that severely aggravate high HbA1c.

---

### Case 4: Set 4 — Cafe Crisna Juice & Beverage List
- **Photos:** Photo `#0`: `set4_juice_and_beverage_list.jpg`
- **Total Legible Items (32 items):**
  - **Zero-Sugar & Natural Hydration (4 items):**
    1. `Es Kelapa Muda / Pure Young Coconut Water`
    2. `Kopi Hitam / Hot or Iced Plain Black Coffee`
    3. `Teh Tawar / Unsweetened Hot or Iced Tea`
    4. `Wedang Jahe Original / Pure Warm Ginger Infusion (Unsweetened)`
  - **100% Fresh Blended Fruit Juices (12 items):**
    5. `Jus Alpukat / Fresh Avocado Juice`
    6. `Jus Melon / Fresh Melon Juice`
    7. `Jus Jeruk / Fresh Orange Juice`
    8. `Jus Mangga / Fresh Mango Juice`
    9. `Jus Durian / Fresh Durian Juice`
    10. `Jus Kedondong / Fresh Ambarella Juice`
    11. `Jus Sirsak / Fresh Soursop Juice`
    12. `Jus Pisang / Fresh Banana Juice`
    13. `Jus Tomat / Fresh Tomato Juice`
    14. `Jus Jambu Biji / Fresh Pink Guava Juice`
    15. `Jus Apel / Fresh Apple Juice`
    16. `Jus Buah Naga / Fresh Dragon Fruit Juice`
  - **Sweetened Mocktails, Flavored Teas & Jelly Ices (11 items):**
    17. `Es Teh Manis / Sweetened Iced Tea`
    18. `Es Leci Jelly / Lychee Flavored Jelly Ice`
    19. `Es Bango Ager Item / Black Grass Jelly Ice with Sweet Syrup`
    20. `Es Mocktail Rainbow / Rainbow Multi-Syrup Mocktail`
    21. `Es Leci Yakult / Lychee Sweetened Fermented Milk Drink`
    22. `Es Leci Kelapa / Lychee Sweetened Coconut Drink`
    23. `Es Nipis Jelly Selasih / Lime Basil Seed Jelly Ice`
    24. `Es Lemon Jelly Selasih / Lemon Basil Seed Jelly Ice`
    25. `Es Kuwut Bali / Balinese Sweetened Melon Cucumber Ice`
    26. `Es Kuwut Nanas / Sweetened Pineapple Kuwut Ice`
    27. `Es Virgin Mojito / Non-Alcoholic Sweetened Mint Lime Mojito`
  - **Condensed Milk & Rich Coconut Cream Dessert Bowls (5 items):**
    28. `Es Campur / Mixed Shaved Ice Dessert with Condensed Milk`
    29. `Es Alpukat Kocok / Smashed Avocado with Chocolate Condensed Milk`
    30. `Es Teler Alpukat / Avocado Teler Shaved Ice with Sweet Cream`
    31. `Es Teler Durian / Durian Teler Shaved Ice with Condensed Milk`
    32. `Sop Buah / Indonesian Fruit Cocktail Soup with Condensed Milk & Syrup`

#### Correct Groups & Clinical Reasoning (Set 4):
- **Group 1: Tier 1 - Safest Choice: Pure Hydration & Electrolytes** (`Es Kelapa Muda`, `Kopi Hitam`, `Teh Tawar`)
  - Calories: `20 kcal/100g` | Zero added sugars, cardioprotective antioxidants, preserves glycemic targets.
- **Group 2: Tier 2 - Neutral: 100% Fresh Blended Fruit Juices** (`12 Fresh Juices`)
  - Calories: `45 kcal/100g` | Natural fructose without refined syrups, provides vitamin C and potassium.
- **Group 3: Tier 3 - Warning: Liquid Sucrose Teas & Artificial Mocktails** (`11 Mocktails & Teas`)
  - Calories: `65 kcal/100g`, Sugar: `15g/100g` (all added sugar) | Rapid blood glucose spiking, violates +50% added sugar surplus.
- **Group 4: Tier 4 - Alert: High Saturated Fat Condensed Milk Dessert Bowls** (`5 Dessert Soups`)
  - Calories: `95 kcal/100g`, Sat Fat: `3.5g/100g`, Sugar: `22g/100g` | Double metabolic hazard combining saturated fat from coconut milk with heavy condensed milk.

---

### Case 5: Set 5 — Indonesian Street Food & Seafood Menu Banner
- **Photos:** Photo `#0`: `set5_restaurant_banner_menu.jpg`
- **Total Legible Items (56 items across 4 banner columns):**
  - **Column 1: Whole Grilled / Roasted Fish & Poached Broths (13 items):**
    1. `Ikan Nila Garang Asem + Nasi / Tilapia in Spicy Sour Poached Broth with Rice`
    2. `Ayam Garang Asem + Nasi / Chicken in Spicy Sour Poached Broth with Rice`
    3. `Tongkol Garang Asem + Nasi / Mackerel Tuna in Spicy Sour Poached Broth with Rice`
    4. `Gurame Garang Asem + Nasi / Giant Gourami in Spicy Sour Poached Broth with Rice`
    5. `Nila Bakar / Gr + Nasi / Grilled or Roasted Tilapia with Rice`
    6. `Bawal Bakar / Gr + Nasi / Grilled or Roasted Pomfret with Rice`
    7. `Bandeng Bakar / Gr + Nasi / Grilled or Roasted Milkfish with Rice`
    8. `Tongkol Bakar / Gr + Nasi / Grilled or Roasted Mackerel Tuna with Rice`
    9. `Cue Bakar / Gr + Nasi / Grilled or Roasted Cured Tuna with Rice`
    10. `Gurame Bakar / Goreng + Nasi / Grilled or Fried Giant Gourami with Rice`
    11. `Ikan Que Bakar / Gr + Nasi / Grilled or Roasted Que Fish with Rice`
    12. `Baronang Bakar / Gr + Nasi / Grilled or Roasted Rabbitfish with Rice`
    13. `Ikan Lele Bakar / Gr + Nasi / Grilled or Roasted Catfish with Rice`
  - **Column 2: Chicken & Sweet-Sour / Battered Dishes (17 items):**
    14. `Ayam Bakar + Nasi / Grilled Chicken with Rice`
    15. `Ayam Bakar Sambel / Grilled Chicken with Sambal`
    16. `Ayam Bakar Sambel Ijo + Nasi / Grilled Chicken with Green Chili and Rice`
    17. `Ayam Goreng Sambel / Fried Chicken with Sambal`
    18. `Ayam Goreng Sambel Ijo + Nasi / Fried Chicken with Green Chili and Rice`
    19. `Ayam Goreng Sambel Judes / Fried Chicken with Fiery Judes Sambal`
    20. `Ayam Goreng Geprek Tepung + Nasi / Crispy Smashed Battered Fried Chicken with Rice`
    21. `Ayam Asam Manis + Nasi / Sweet and Sour Chicken with Rice`
    22. `Lampung + Nasi / Lampung Style Spicy Dish with Rice`
    23. `Gurame Asam Manis + Nasi / Sweet and Sour Giant Gourami with Rice`
    24. `Gurame Vilet Asam Manis + Nasi / Sweet and Sour Giant Gourami Fillet with Rice`
    25. `Ikan Bawal Asem Manis + Nasi / Sweet and Sour Pomfret with Rice`
    26. `Cumi Goreng Tepung + Nasi / Crispy Battered Fried Calamari with Rice`
    27. `Cumi Saos Asam Manis / Calamari in Sweet and Sour Sauce`
    28. `Udang Goreng Tepung + Nasi / Crispy Battered Fried Prawns with Rice`
    29. `Udang Saos Asam Manis / Prawns in Sweet and Sour Sauce`
    30. `Seafood Tumpah / Spilled Mixed Seafood Platter in Sweet Corn Sauce`
  - **Column 3: Nasi Goreng Varieties (9 items):**
    31. `Nasi Goreng Seafood / Seafood Fried Rice`
    32. `Nasi Goreng Spesial / Special Fried Rice with Egg and Sausage`
    33. `Nasi Goreng Pete / Stink Bean Fried Rice`
    34. `Nasi Goreng Jengkol / Jengkol Bean Fried Rice`
    35. `Nasi Goreng Sosis / Sausage Fried Rice`
    36. `Nasi Goreng Bakso / Meatball Fried Rice`
    37. `Nasi Goreng Kornet / Corned Beef Fried Rice`
    38. `Nasi Goreng Telor Dadar / Omelette Fried Rice`
    39. `Nasi Goreng Ayam / Chicken Fried Rice`
  - **Column 4: Seblak, Street Noodles & Kwetiau (17 items):**
    40. `Seblak Cobek Viral / Viral Mortar-Pounded Spicy Tapioca Crackers`
    41. `Seblak Seafood / Spicy Tapioca Crackers with Mixed Seafood`
    42. `Seblak Ceker / Spicy Tapioca Crackers with Chicken Feet`
    43. `Ceker Mercon / Explosive Fiery Chicken Feet`
    44. `Mie Tek - Tek Kuah / Street Noodle Soup with Cabbage and Egg`
    45. `Mie Tek - Tek Goreng / Stir-Fried Street Noodles with Sweet Soy`
    46. `Mie Tek - Tek Sosis / Street Noodles with Sliced Sausage`
    47. `Mie Tek - Tek Bakso / Street Noodles with Beef Meatballs`
    48. `Mie Tek - Tek Kornet / Street Noodles with Corned Beef`
    49. `Mie Tek - Tek Seafood / Street Noodles with Calamari and Shrimp`
    50. `Mie Tek - Tek Ayam / Street Noodles with Shredded Chicken`
    51. `Mie Tek - Tek Spesial / Special Street Noodles with Complete Toppings`
    52. `Kwetiau Goreng Seafood / Stir-Fried Flat Rice Noodles with Seafood`
    53. `Kwetiau Goreng Bakso Sosis / Flat Rice Noodles with Meatballs and Sausage`
    54. `Kwetiau Kuah Sosis Bakso / Flat Rice Noodle Soup with Sausage and Meatballs`
    55. `Kwetiau Spesial / Special Flat Rice Noodles with Mixed Toppings`
    56. `Kwetiau Ayam / Flat Rice Noodles with Chicken`

#### Correct Groups & Clinical Reasoning (Set 5):
- **Group 1: Tier 1 - Safest Choice: Tangy Poached Broths (`Garang Asem`) (4 items)**
  - Targeted Image: Photo `#0` | Bounding Box: `[470, 50, 550, 550]`
  - Nutrients per 100g: `115 kcal`, Protein 11.5g, Total Fat 3.2g, Sat Fat 0.8g, Carbs 10.5g, Sugar 1.2g, Sodium 340mg
  - Items: `Ikan Nila Garang Asem + Nasi`, `Ayam Garang Asem + Nasi`, `Tongkol Garang Asem + Nasi`, `Gurame Garang Asem + Nasi`
  - Clinical Verdict: `good` — *"Lowest Saturated Fat & Clean Protein"*
- **Group 2: Tier 2 - Neutral: Open-Flame Grilled Whole Fish & Poultry (10 items)**
  - Targeted Image: Photo `#0` | Bounding Box: `[160, 50, 470, 550]`
  - Nutrients per 100g: `135 kcal`, Protein 12.8g, Total Fat 5.1g, Sat Fat 1.2g, Carbs 9.8g, Sugar 1.5g, Sodium 380mg
  - Items: `Nila Bakar`, `Bawal Bakar`, `Bandeng Bakar`, `Tongkol Bakar`, `Cue Bakar`, `Gurame Bakar`, `Ikan Que Bakar`, `Baronang Bakar`, `Ayam Bakar`
  - Clinical Verdict: `neutral` — *"Cardioprotective Marine Omega-3s with Moderate Glaze"*
- **Group 3: Tier 3 - Warning: Battered Fried & Sweet-Sour Glazed Dishes (17 items)**
  - Targeted Image: Photo `#0` | Bounding Box: `[250, 50, 920, 550]`
  - Nutrients per 100g: `185 kcal`, Protein 10.2g, Total Fat 9.5g, Sat Fat 3.1g, Carbs 14.2g, Sugar 4.5g, Sodium 520mg
  - Items: `Gurame Asam Manis`, `Ayam Goreng Geprek Tepung`, `Cumi Goreng Tepung`, `Udang Asam Manis`, `Seafood Tumpah`
  - Clinical Verdict: `warning` — *"Refined Sugars & Heavy Frying Oils"*
- **Group 4: Tier 4 - Alert: Ultra-Processed Starches, Fried Rice & Seblak (25 items)**
  - Targeted Image: Photo `#0` | Bounding Box: `[160, 580, 990, 990]`
  - Nutrients per 100g: `210 kcal`, Protein 6.5g, Total Fat 10.2g, Sat Fat 3.5g, Carbs 24.5g, Sugar 2.1g, Sodium 650mg
  - Items: `9 Nasi Goreng variations`, `Seblak Cobek / Seafood / Ceker`, `Ceker Mercon`, `8 Mie Tek-Tek variations`, `5 Kwetiau variations`
  - Clinical Verdict: `alert` — *"Severe Glycemic & Sodium Hazard"*

---

### Case 6: Set 6 — Supermarket Chip Aisle Shelf
- **Photos:** Photo `#0`: `set6_supermarket_chip_aisle_shelf.jpg`
- **Total Legible Items (17 items across 4 shelf tiers):**
  1. `Happy Tos Tortilla Chips Hijau / Green Corn Tortilla Chips Roasted Corn Flavor` (55g standard pouch)
  2. `Happy Tos Tortilla Chips Merah / Red Corn Tortilla Chips Original Flavor` (55g standard pouch)
  3. `Qtela Singkong Original / Salted Cassava Chips Single Serving` (60g pouch)
  4. `Qtela Singkong Balado / Spicy Balado Cassava Chips Single Serving` (60g pouch)
  5. `Chitato Lite Rumput Laut / Thin Cut Potato Chips Seaweed Flavor` (68g bag)
  6. `Chitato Beef Barbeque / Ridged Potato Chips Beef Barbeque Flavor` (68g bag)
  7. `Lay's Rumput Laut / Classic Potato Crisps Seaweed Flavor` (68g bag)
  8. `Lay's Salmon Teriyaki / Potato Crisps Salmon Teriyaki Flavor` (68g bag)
  9. `Doritos Nacho Cheese / Extruded Tortilla Chips Nacho Cheese Flavor` (55g bag)
  10. `Panchos Tortilla Chips Sapi Panggang / Barbeque Tortilla Chips` (55g bag)
  11. `Jetz Hollow Paprika / Hollow Potato Pellets Paprika Flavor` (35g pouch)
  12. `Chiki Twist Sweet Corn / Puffed Corn Extrudate Sweet Corn Flavor` (20g mini pouch)
  13. `Taro Net Potato BBQ / Lattice Potato Snack Barbeque Flavor` (36g pouch)
  14. `Oishi Popcorn Caramel / Caramel Glazed Popcorn` (45g bag)
  15. `Cheetos Twist Jagung Bakar / Grilled Corn Puffed Snack` (40g pouch)
  16. `Qtela Singkong Family Pack / Large Cassava Chips Sharing Bag` (180g family bag)
  17. `Chitato Giant Sharing Bag / Ridged Potato Chips Party Size` (120g party bag)

#### Correct Groups & Clinical Reasoning (Set 6):
- **Group 1: Tier 1 - Safest Choice: Plain Corn Tortilla & Single-Serving Cassava Chips (4 items)**
  - Targeted Image: Photo `#0` | Bounding Box: `[108, 55, 390, 300]`
  - Nutrients per 100g: `500 kcal`, Protein 7.0g, Fat 24.0g, Sat Fat 8.0g, Carbs 64.0g, Sugar 1.0g, Sodium 550mg, Fibre 5.0g
  - Core Items: `Happy Tos Tortilla Chips Hijau`, `Happy Tos Merah`, `Qtela Singkong Original`
  - Clinical Verdict: `good` — *"Lowest Refined Sugar & Whole Grain Base"*
- **Group 2: Tier 2 - Neutral: Seasoned Potato & Standard Root Chips (4 items)**
  - Targeted Image: Photo `#0` | Bounding Box: `[350, 580, 520, 750]`
  - Nutrients per 100g: `530 kcal`, Protein 5.5g, Fat 32.0g, Sat Fat 12.0g, Carbs 58.0g, Sugar 2.5g, Sodium 680mg
  - Core Items: `Chitato Lite Rumput Laut`, `Lay's Potato Chips`, `Chitato Beef Barbeque`
  - Clinical Verdict: `neutral` — *"Moderate Saturated Fat & Sodium Load"*
- **Group 3: Tier 3 - Warning: Extruded Snack Pellets & Industrial Powders (4 items)**
  - Targeted Image: Photo `#0` | Bounding Box: `[410, 30, 580, 260]`
  - Nutrients per 100g: `520 kcal`, Protein 4.0g, Fat 28.0g, Sat Fat 11.0g, Carbs 65.0g, Sugar 4.0g, Sodium 750mg
  - Core Items: `Doritos Nacho Cheese`, `Panchos Barbeque`, `Jetz Hollow Paprika`
  - Clinical Verdict: `warning` — *"Ultra-Processed Starch & Heavy MSG Sodium"*
- **Group 4: Tier 4 - Alert: Sweet-Glazed Snacks & Open Family Sharing Bags (5 items)**
  - Targeted Image: Photo `#0` | Bounding Box: `[670, 0, 995, 150]` & Bottom Shelf
  - Nutrients per 100g: `540 kcal`, Protein 3.0g, Fat 30.0g, Sat Fat 14.0g, Carbs 62.0g, Sugar 12.0g, Sodium 600mg
  - Core Items: `Chiki Twist Sweet Corn`, `Taro Net BBQ`, `Oishi Popcorn Caramel`, `Qtela Family Pack 180g`, `Chitato Giant 120g`
  - Clinical Verdict: `alert` — *"Added Sugar Spikes & Loss of Portion Control"*

---

## 3. Ground Truth Verification Contract

To assert and verify the benchmark fixtures and ground truth parity:
```bash
npx vitest run tests/golden_meal03.test.ts
```
Expected output: **14 / 14 tests passing green**.
