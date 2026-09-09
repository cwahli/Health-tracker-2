# Golden Meal 03 — Compare Mode (Mode D) Correct Results & Benchmark Ground Truth

**Benchmark ID:** `Meal_03_compare`  
**Evaluation Standard:** Vision Scout Single-Pass Mode D Architecture (`gemini-3.5-flash-lite`)  
**Input Condition:** **Blank User Input (`userPrompt: ""`) — Pure Multi-Photo Upload**  
**Active Patient Profile Targets:** +38% Saturated Fat, +50% Added Sugar, +39% Calories, -17% Protein Deficit, +30% Sodium, +32% Carbohydrates, -26% Fibre Deficit  
**Status:** 🎯 **Canonical Correct Results Reference Ground Truth**  

---

## 1. Transposed Benchmark Summary Matrix (Sets as Columns)

The complete benchmark ground truth across all 6 test sets is presented below with the **6 Test Sets across the top columns** and all evaluated criteria as rows:

| Metric / Evaluation Criterion | Set 1: Bakery & Chocolate | Set 2: 4 Snack & Bread Labels | Set 3: Restaurant Menu (Pencok 89) | Set 4: Juice & Beverage List | Set 5: Street Food & Seafood Banner | Set 6: Supermarket Chip Aisle |
|---|---|---|---|---|---|---|
| **Case Name** | Bakery Shelf & SilverQueen Chocolate | 4 Reference Snack & Bread Nutrition Labels | Restaurant Menu Pages (Sambal Bakar Pencok 89) | Cafe Crisna Juice & Beverage List | Indonesian Street Food & Seafood Menu Banner | Supermarket Chip Aisle Shelf (50+ Items on Display) |
| **Real-World Domain** | Retail bakery display + packaged confectionery | Packaged bread & snack nutrition fact panels | Casual Indonesian dine-in laminated multi-page menu | Cafe beverage & dessert counter price board | Street food tent / warung hanging menu banner | Supermarket snack aisle gondola shelving |
| **Input Photos** | 3 photos (`set1_*.jpg`): shelf, front chocolate bar, nutrition panel | 4 photos (`set2_*.jpg`): front pack, blue bread label, green bar label, yellow cake label | 2 photos (`set3_*.jpg`): multi-column menu page 1 and page 2 | 1 photo (`set4_*.jpg`): cafe beverage and dessert board | 1 photo (`set5_*.jpg`): outdoor street food hanging banner | 1 photo (`set6_*.jpg`): 4-tier supermarket snack chip aisle |
| **Exhaustive Dishes / Items Extracted** | **6 items** | **4 items** | **104 items** | **32 items** | **56 items** | **17 items** |
| **Groups Formed ($\le$ 10% Macro Variance)** | **3 groups** (Tier 2 Yeast Buns, Tier 3 Laminated Pies, Tier 4 Confectionery) | **4 groups** (Tier 1 Light Portion, Tier 2 Low-Sugar Staple, Tier 3 Custard Bun, Tier 4 High-Sugar Loaf) | **4 groups** (Tier 1 Clear Soups/Boiled, Tier 2 Whole Fish/Sautéed, Tier 3 Fried Sets, Tier 4 Salted Fish/Seblak) | **4 groups** (Tier 1 Pure Hydration, Tier 2 Fresh Juices, Tier 3 Sweet Teas/Mocktails, Tier 4 Dessert Soups) | **4 groups** (Tier 1 Poached Broths, Tier 2 Lean Grilled Fish, Tier 3 Sweet-Sour/Fried, Tier 4 Fried Rice/Seblak) | **4 groups** (Tier 1 Whole Grain Corn, Tier 2 Sliced Potato/Root, Tier 3 Extruded Pellets, Tier 4 Sweet Glaze/Family Bags) |
| **Exact OCR Transcription & Faithfulness Locks** | **100% Faithful**<br>• Transcribed verbatim from SilverQueen panel: Serving size `20g` (2.5 serv/pack).<br>• Nutrients: `110 kcal`, `7g Fat`, `3.5g Saturated Fat`, `2g Protein`, `10g Carbs`, `6g Sugar`, `20mg Salt`. | **100% Faithful**<br>• Green Snack: `23g`, `90 kcal`, `1g Sat Fat`, `7g Sugar`, `20mg Na`.<br>• Blue Bread: `44g`, `120 kcal`, `1.5g Sat Fat`, `2g Sugar`, `150mg Na`.<br>• Yellow 1: `75g`, `250 kcal`, `4.5g Sat Fat`, `6g Sugar`, `125mg Na`.<br>• Yellow 2: `80g`, `250 kcal`, `3g Sat Fat`, `38g Sugar`, `330mg Na`. | **100% Faithful**<br>• All 104 legible dishes parsed across 2 multi-column pages without sampling down.<br>• Multi-line menu combo headings joined cleanly (e.g. `LALAPAN REBUS (LABU+KANGKUNG+KCG PJG)`). | **100% Faithful**<br>• 32 distinct beverages, fruit juices, and iced desserts extracted across board columns.<br>• Accurate reading of ingredients without hallucinated items. | **100% Faithful**<br>• 56/56 menu entries extracted across grilled fish, chicken, sweet-sour, soup, and noodle banner sections. | **100% Faithful**<br>• 17 distinct shelf brands and package sizes extracted from multi-shelf aisle photo without false merges. |
| **Bilingual Name Translation (`Local / English`)** | **100% Translated Correctly**<br>• `Say Bread - Polo Keju / Cheese Polo Bread`<br>• `Say Bread - Polo Cokelat / Chocolate Polo Bread`<br>• Universal brand kept: `SilverQueen Milk Chocolate with Cashews / SilverQueen Susu Cokelat dengan Kacang Mede` | **100% Translated Correctly**<br>• `Green Package Snack Bread / Roti Kemasan Hijau Kecil`<br>• `Soft Bread (Blue Package) / Roti Tawar Lembut Bungkus Biru`<br>• `Sweet Custard Bread / Roti Manis Isi Kastard`<br>• `Multiseed Sweet Loaf / Roti Manis Multiseed` | **100% Translated Correctly**<br>• `SAYUR ASEM / Sundanese Tangy Tamarind Vegetable Soup`<br>• `PEPES TAHU / Steamed Spiced Tofu in Banana Leaf`<br>• `SOTO BETAWI DAGING SAPI / Betawi Beef Soup with Coconut Milk`<br>• `KOL GORENG / Deep-Fried Cabbage` | **100% Translated Correctly**<br>• `ES KELAPA MUDA / Pure Young Coconut Water`<br>• `WEDANG JAHE / Pure Warm Ginger Infusion`<br>• `ES CAMPUR / Mixed Shaved Ice Dessert`<br>• `ES TELER DURIAN / Durian Teler Shaved Ice` | **100% Translated Correctly**<br>• `NILA BAKAR + NASI / Grilled Tilapia with Rice`<br>• `IKAN NILA GARANG ASEM + NASI / Tilapia in Spicy Sour Poached Broth with Rice`<br>• `GURAME VILET ASAM MANIS / Sweet and Sour Gourami Fillet` | **100% Translated Correctly**<br>• `Happy Tos Tortilla Chips Hijau / Green Corn Tortilla Chips Roasted Corn Flavor`<br>• `Chitato Lite Rumput Laut / Thin Sliced Potato Chips Seaweed Flavor`<br>• `Qtela Singkong Original / Salted Cassava Chips` |
| **Bounding Box Quadrant Coordinates (`boundingBox2D`)** | **Verified Regional Framing**<br>• G1: `[170, 1, 600, 998]` (top shelf buns)<br>• G2: `[600, 1, 950, 998]` (bottom shelf pies)<br>• G3: `[0, 200, 995, 525]` (chocolate bar) | **Verified Regional Framing**<br>• G1: `[360, 0, 760, 1000]` (green pack)<br>• G2: `[300, 0, 920, 1000]` (blue bread)<br>• G3: `[230, 0, 990, 1000]` (yellow custard)<br>• G4: `[250, 0, 920, 1000]` (multiseed) | **Verified Regional Framing**<br>• G1: `[400, 100, 520, 920]` (clear soups/fish)<br>• G2: `[150, 80, 420, 920]` (stir-fried & grilled)<br>• G3: `[300, 80, 750, 920]` (fried sets)<br>• G4: `[700, 80, 990, 990]` (salted fish/seblak) | **Verified Regional Framing**<br>• G1: `[600, 180, 770, 310]` (coconut/coffee)<br>• G2: `[150, 750, 290, 940]` (fresh fruit juices)<br>• G3: `[110, 0, 320, 640]` (mocktails & teas)<br>• G4: `[570, 430, 710, 950]` (dessert bowls) | **Verified Regional Framing**<br>• G1: `[470, 50, 550, 550]` (poached Garang Asem)<br>• G2: `[160, 50, 470, 550]` (grilled fish/chicken)<br>• G3: `[250, 50, 920, 550]` (sweet-sour & fried)<br>• G4: `[160, 580, 990, 990]` (fried rice & seblak) | **Verified Regional Framing**<br>• G1: `[108, 55, 390, 300]` (corn tortillas)<br>• G2: `[350, 580, 520, 750]` (potato crisps)<br>• G3: `[410, 30, 580, 260]` (extruded pellets)<br>• G4: `[670, 0, 995, 150]` (sweet glaze & large bags) |
| **Total Nutrients Amount (Deterministic Math L12)** | Derived in TS<br>(`per100g * wt / 100`)<br>10/10 keys populated | Derived in TS<br>(`per100g * wt / 100`)<br>10/10 keys populated | Derived in TS<br>(`per100g * wt / 100`)<br>10/10 keys populated | Derived in TS<br>(`per100g * wt / 100`)<br>10/10 keys populated | Derived in TS<br>(`per100g * wt / 100`)<br>10/10 keys populated | Derived in TS<br>(`per100g * wt / 100`)<br>10/10 keys populated |
| **Usage of Nutrition Allowance by User Profile** | **Active Targeted Application:**<br>• Penalizes +50% sugar & +38% sat fat in SilverQueen.<br>• Relegates chocolate bar to Tier 4 alert despite low absolute portion. | **Active Targeted Application:**<br>• Penalizes +39% calorie and +32% carb surplus.<br>• Rewards light single-serving snack roll, penalizes 38g-sugar multiseed bun into Tier 4. | **Active Targeted Application:**<br>• Penalizes +30% sodium surplus & +38% sat fat.<br>• Relegates salted fish (1800mg sodium) and oily deep-fried animal skins to Tier 4 alert. | **Active Targeted Application:**<br>• Penalizes +50% added sugar surplus.<br>• Strictly promotes zero-sugar young coconut water and black coffee; penalizes condensed milk bowls. | **Active Targeted Application:**<br>• Addresses -17% protein deficit with clean fish.<br>• Promotes unbreaded poached tilapia (Garang Asem); relegates oily fried rice and seblak to Tier 4 alert. | **Active Targeted Application:**<br>• Penalizes +30% sodium and +39% calories.<br>• Promotes unflavored corn tortillas; penalizes 180g family bags and sweet glazes into Tier 4 alert. |
| **Accuracy to Group within 10% Macro Variance** | **Verified ($\le$10% Variance):**<br>• G1: 320–340 kcal/100g (diff <6%).<br>• G2: 370–390 kcal/100g (diff <5%). | **Verified ($\le$10% Variance):**<br>• 4 distinct nutritional profiles cleanly partitioned into separate tiers. | **Verified ($\le$10% Variance):**<br>• G1: Boiled broths cluster at 70–80 kcal/100g.<br>• G3: Fried sets cluster at 210–230 kcal/100g. | **Verified ($\le$10% Variance):**<br>• G2: Whole juices cluster at 40–50 kcal/100g.<br>• G4: Dessert bowls cluster at 90–100 kcal/100g. | **Verified ($\le$10% Variance):**<br>• G1: Poached broths cluster at 110–120 kcal/100g.<br>• G4: Fried carbs cluster at 200–220 kcal/100g. | **Verified ($\le$10% Variance):**<br>• G1: Corn tortillas cluster at 490–510 kcal/100g.<br>• G2: Sliced crisps cluster at 520–540 kcal/100g. |
| **Highlight & Separate Specific Harms / Benefits** | **Passed:**<br>• Industrial trans fat (0.2g) in cheese pies and cocoa butter sat fat isolated into Tier 3 & 4. | **Passed:**<br>• High saturated fat (4.5g) in custard bun and massive sugar (38g) in multiseed isolated. | **Passed:**<br>• Marine Omega-3s in whole mackerel elevated; oxidized deep-fry oils and seblak starches isolated. | **Passed:**<br>• Condensed milk and synthetic syrups in dessert bowls isolated into Tier 4. | **Passed:**<br>• Tangy antioxidant sour broths elevated; deep-fried batter and heavy seblak isolated into Tier 4. | **Passed:**<br>• Whole corn grain elevated; extruded starch pellets and open family sharing bags isolated. |
| **Intra-Group Sorting by Health Value** | Savory cheese buns ahead of chocolate glaze | Low-sugar blue bread ahead of sweet loaves | Clear fish broths ahead of fried poultry | Unsweetened water ahead of pureed juices | Poached Garang Asem ahead of oil-brushed grill | Plain corn tortilla ahead of MSG-dusted chips |
| **Complete Clinical Recommendation Written** | **Recommended Option:**<br>`Say Bread - Polo Keju / Cheese Polo Bread`<br>*Ordering Tip: Choose plain or cheese-topped varieties over chocolate-filled versions to avoid compounding added sugar intake.* | **Recommended Option:**<br>`Green Package Snack Bread / Roti Kemasan Hijau Kecil`<br>*Ordering Tip: Consume as a single portion and pair with unsweetened tea to blunt glycemic impact.* | **Recommended Option:**<br>`Paket Ikan Kembung / Whole Mackerel Meal Set` or `Sayur Asem`<br>*Ordering Tip: Order with plain white rice or half portions to control carbohydrate intake, and skip any added sweet soy glaze.* | **Recommended Option:**<br>`Es Kelapa Muda / Pure Young Coconut Water`<br>*Ordering Tip: Order completely plain with no added simple syrup, sugar, or flavored cordials.* | **Recommended Option:**<br>`Ikan Nila Garang Asem + Nasi / Tilapia in Spicy Sour Poached Broth with Rice`<br>*Ordering Tip: Consume half portion of rice to manage carbohydrate surplus.* | **Recommended Option:**<br>`Happy Tos Tortilla Chips Hijau / Green Corn Tortilla Chips Roasted Corn Flavor`<br>*Ordering Tip: Portion out a strict 30g serving and pair with fresh salsa instead of cheese dip.* |

---

## 2. Comprehensive Ground Truth Reference Document

The full exhaustive case-by-case analysis, complete 104-dish menu inventory for Set 3, 56-dish inventory for Set 5, 32-drink inventory for Set 4, 17-snack inventory for Set 6, 6-bakery item inventory for Set 1, and 4-label panel inventory for Set 2 are detailed in [correct_results.md](file:///Users/chiwah/src/Health-tracker/golden/meal/Meal_03_compare/correct_results.md).


---

## 3. Key Insights from Golden Meal 01 & 02 Transposition

Reviewing the official golden meals in the repository revealed core architectural differences and opportunities for deep integration:

```
Meal 01 (Mode A): Eaten Plated Meal  --> 3 Turns (Log -> Portion Clarify -> Correction Patch)
Meal 02 (Mode A): Complex Groceries  --> Parallel Auto-split (Arm C Workers) & 19 RefIds
Meal 03 (Mode D): Pre-Meal Compare   --> Transposed into a Unified Ingestion Bridge
```

### Insight 1: The Behavioral Mode Bridge (Mode D $\to$ Mode A)
- **The Gap:** `Meal_01` and `Meal_02` are **Mode A (Logging)** benchmarks: the meal has been eaten, and dishes form an additive sum ($\sum \text{dish}_i = \text{total}$). In contrast, `Meal_03_compare` is **Mode D (Evaluation)**: options are mutually exclusive candidates, and groups represent average macro clusters.
- **The Transposition:** A new golden meal standard should link Mode D directly into Mode A in a continuous 3-turn user journey:
  1. **Turn 1 (Compare / Mode D):** User submits menu or shelf photo $\to$ Model identifies all items, computes 10-nutrient allowance profiles (serving & 100g), clusters into $\le 10\%$ macro variance, and recommends the optimal choice.
  2. **Turn 2 (Order Selection & Ingestion / Mode A):** User replies: *"I ordered the recommended grilled tilapia (Nila Bakar) and tamarind soup (Sayur Asem), with 100g rice."* $\to$ The system converts the selected comparative candidates directly into a logged meal with exact grams, expanding the 10 allowance keys into the full **32 canonical nutrients** without re-running vision models.
  3. **Turn 3 (Portion Patch / Mode A Edit):** User corrects portion (e.g. *"I only ate half the rice"*), triggering the `Meal_01` dietitian patch flow (`dishUpdates` with image coordinates and non-regenerative updates).

### Insight 2: Dual-Layer Testing Architecture
Following the standard set by `tests/Golden_meal/README.md` and `tests/golden_meal01.test.ts`:
- **Layer A (Visual & Clinical E2E):** Tested live via Playwright (`prototype/tests/compare-mode-six-cases.spec.ts`). Validates Gemini 3.5 Flash Lite visual transcription, complex multi-column OCR, and personalized recommendation generation.
- **Layer B (Mathematical & Parity Gates):** Fast non-LLM Vitest suite (`tests/golden_meal03.test.ts`). Asserts that:
  1. Zero orphaned items exist (all `scoutItemIndices` point to valid items).
  2. Spatial quadrant bounding boxes are normalized $[0, 1000]$ with $ymin \le ymax$ and $xmin \le xmax$.
  3. Complete 10-nutrient allowance vectors exist for both per-serving and per-100g.
  4. Clinical verdict levels (`good`, `neutral`, `warning`, `alert`) and labels are valid.

### Insight 3: Spatial Quadrant Bounding Boxes
- `Meal_01` and `Meal_02` use item-level bounding boxes pointing to single food items on a plate or package.
- In dense multi-item scenes (Set 3 has 95 items, Set 5 has 57 items), per-item bounding boxes exhaust token limits and cause UI clutter.
- **The Transposition:** `Meal_03_compare` introduces **spatial quadrant bounding boxes** at the group level (`[ymin, xmin, ymax, xmax]`), which can be hierarchically refined to item-level coordinates upon selection.

### Insight 4: Label Lock Invariants
- Direct OCR printed labels (SilverQueen in Set 1, all 4 packs in Set 2) are locked as immutable truth. Atwater formulas are never used to recalculate printed calories.
- TypeScript strictly derives:
  $$\text{salt (g)} = \text{sodium (mg)} \times 0.00254$$
  $$\text{unsaturatedFat (g)} = \text{totalFat} - \text{saturatedFat} - \text{transFat}$$

---

## 3. Verification & Parity Gates

To execute the non-LLM structural parity gate on this benchmark:
```bash
npx vitest run tests/golden_meal03.test.ts
```
Expected output: **14 tests passed (100%)**.

To execute the live Playwright E2E test suite across all 6 cases:
```bash
npx playwright test prototype/tests/compare-mode-six-cases.spec.ts --project=chromium
```
Expected output: **6 / 6 passed (100%)**.

---

## 4. Playwright Automated Benchmark Execution Process (Blank User Input Reference)

This section documents the exact, reproducible execution procedure so any agent or developer can run the benchmark directly upon request.

### 4.1 Invariants of the Benchmark Run
1. **Blank User Input (`userPrompt: ""`):** The user does NOT write any text prompts or instructions. The user solely uploads the comparison images.
2. **Reference Benchmark Standard:** All 6 cases are verified against the canonical ground truth defined in `expected.json` and Section 1 of this file (`Instruction.md`).
3. **Multimodal Evaluation Dimensions:**
   - Exhaustive dish/item extraction count
   - Group clustering within $\le 10\%$ macronutrient variance
   - Direct OCR transcription faithfulness (verbatim printed label locks)
   - Bilingual naming (`Local Name / English Translation`)
   - Group quadrant bounding boxes (`[ymin, xmin, ymax, xmax]` normalized 0-1000)
   - Full 10 allowance nutrient vectors (per-serving and per-100g density)
   - Active clinical personalization against the patient profile (+38% sat fat, +50% added sugar, +39% calorie surplus, -17% protein deficit)
   - Highlight & separation of unlisted harms/hazards (trans fats, simple syrups, oxidized deep-fry oils)
   - Intra-group sorting by health value (`scoutItemIndices`)
   - Complete verdict sentences (level + 3-6 word label + 1 comparative sentence)
   - Complete clinical recommendations with ordering tips
   - Browser UI Mode D evaluation card rendering in Chromium.

### 4.2 Single-Command Benchmark Execution
To run the automated benchmark across all 6 cases with blank user input:
```bash
npx playwright test prototype/tests/meal03-compare-benchmark.spec.ts --project=chromium
```

### 4.3 Automated Benchmark Result Output
Upon test completion, the suite automatically compiles and writes the complete execution matrix to:
[`golden/meal/Meal_03_compare/benchmark_result.md`](file:///Users/chiwah/src/Health-tracker/golden/meal/Meal_03_compare/benchmark_result.md)

This file contains:
- The complete transposed benchmark matrix (6 sets as columns, 12 evaluation criteria as rows).
- Execution latencies per set.
- Detailed breakdown of groups, bounding boxes, calorie densities, and clinical verdicts.
- Direct comparison between live run results and reference values.

### 4.4 Debug Report Instruction & Schema Standard
All diagnostic and debug run files (`ideal_debug_turn01.md` and `debug_runs/debug_set*.md`) must adhere strictly to the full diagnostic dispatch contract:
1. **Full System Instruction:** Must never be abridged or truncated. It includes output language directives, all 9 Mode D invariants, the patient's 3-day nutritional target status, and the complete `=== REQUIRED OUTPUT JSON SCHEMA ===` block defining all properties for items, groups, averageNutrients, verdicts, and bounding boxes.
2. **Complete User Prompt:** Must document the exact prompt string constructed by `buildScoutComparePrompt` for blank user input scenarios, incorporating the patient's priorities and target deviations.
3. **Verbatim Raw Emission:** Must display the complete parsed JSON output matching the schema.

### 4.5 Bilingual Dish Name Standard
In accordance with Invariant #2, all non-English dishes, menu items, and packaged goods must be formatted as:
`"Local Name / English Translation"` (e.g., `SAYUR ASEM / Tamarind Vegetable Soup`, `KOPI / Black Coffee`, `Say Bread - Polo Keju / Cheese Polo Bun`).
- **Ground Truth Reference (`expected.json`):** 100% of non-English items carry verified bilingual translations.
- **Automated Verification:** The benchmark test verifies item names for the ` / ` separator and logs the exact ratio of translated items to total extracted items in `benchmark_result.md`.

