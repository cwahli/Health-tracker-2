# Golden Meal 04 — Mode A Log Suite Benchmark Results

**Execution window:** 2026-09-10 (Vertex / HTTP `:3000`, `gemini-3.5-flash-lite`)  
**Suite:** `golden/meal/Meal_04_log` (canonical) — prototype runner is harness only  
**Primary bar:** bug-free end-to-end journey (OCR / dishes / names / completeness / advice). Exact macro ±% is secondary.  
**Ground truth:** per-case [correct_results.md](./) (status **DRAFT** until FINAL)  
**Overall journey status:** ✅ **7 / 7 cases contract-PASS** on latest soak (08 & 10 after portion-clarify harness fix)

---

## 1. At-a-glance matrix (Mode A log)

| Benchmark Dimension | 01 Yolk plate | 02 Lidl packaged | 06 Mie Gacoan menu-log | 08 Oats label + clarify | 09 Steak / fish & chips | 10 Barcode hotpot | 11 Seafood + Mr Oat |
|---|---|---|---|---|---|---|---|
| **Input type** | Branded restaurant plate | Brand pack + prepared | Restaurant menu/receipt as **log** | Nutrition label + **edit** | Multi-image restaurant plates | Barcode / grocery prep + **edit** | Receipt + ingredients + bracket text |
| **Photos** | 1 | 1 | 2 | 2 | 2 | 2 | 3 |
| **Turns** | 1 | 1 | 1 | **2** (portion clarify) | 1 | **2** (portion clarify) | 1 (bracket in prompt) |
| **Latency** | 6.0s | 6.3s | 5.2s | 7.4s | 11.7s | 11.0s | 5.2s |
| **Dishes gathered (live)** | **3** | **2** | **3** | **1** | **3** | **1** | **2** |
| **Naming (live)** | Chicken sandwich halves; roasted broccoli+cabbage; baby potatoes | Double chocolate muffin; southern fried chicken bites | Mie Suit; Siomay; Es Petak Umpet | Rolled Oats | Beef steak+gravy+veg; fish & chips; iced tea | Hotpot Sayur dan Daging | Seafood+veg hotpot prep; Mr Oat rolled oats |
| **OCR / text path** | n/a (plate) | Brand/pack text | Menu names/prices | **Label per-100g + clarify grams** | n/a (plates) | Price stickers / barcodes | Thermal receipts + pack |
| **Journey / contract** | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS (rerun; prior 0 kcal Turn2 fixed) | ✅ PASS (fat ⚠️ vs GT) | ✅ PASS (rerun; prior 0 kcal Turn2 fixed) | ✅ PASS (contract; approx GT) |
| **Personalized advice present** | ✅ | (in log path) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Nutrient fields returned** | Macros on items + totals | Macros on items + totals | Macros on items + totals | Macros after clarify | Macros on items + totals | Macros after clarify | Macros on items + totals |
| **Macro >20% vs runner GT** *(secondary)* | cal/P/F | none | none | none | fat | carbs | P/F (GT approximate) |
| **GT status** | DRAFT | DRAFT (strong) | DRAFT | DRAFT (label path) | DRAFT | DRAFT | DRAFT (GT conflict) |
| **E2E journey verdict** | ✅ Green | ✅ Green | ✅ Green | ✅ Green (edit path) | ✅ Green | ✅ Green (edit path) | ✅ Green |

---

## 2. Journey notes (bug-free bar)

| Issue class | Status |
|---|---|
| Turn-2 portion-clarify dropping scout → **0 kcal** (08, 10) | **Fixed** in harness; reruns PASS |
| Case 11 bracket oats + multi-image | PASS on HTTP runner |
| Compare Mode D grouping (Meal_03 Set 3 catch-all / Kembung) | Tracked in `Meal_03_compare` — not this table |
| Exact 32-key FINAL nutrition | **Not required** for this journey bar — deferred |

---

## 3. How to re-run

```bash
# Harness still: prototype/meallog/runner.ts (must eventually read golden photos only)
npm run test:benchmark:food -- --case 08
# Offline structure gate:
node scripts/meal-golden-bench.mjs
```

Model: **gemini-3.5-flash-lite**. Source of truth: this folder under `golden/meal/` — not prototype JSON dumps.

---

## 4. Related scorecards

| Suite | Scorecard |
|---|---|
| Mode D compare (6 sets) | [`../Meal_03_compare/benchmark_result.md`](../Meal_03_compare/benchmark_result.md) |
| Mode D Vertex GT (incl. Set 3 cluster gates) | `prototype/meallog/compare/meal03_six_vertex_gt_scorecard.md` *(move into golden later)* |
| Edit multi-turn | `../Meal_01/` |
| Multi-photo split | `../Meal_02/` |
