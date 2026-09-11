# Golden Meal 04 — Mode A Log Suite Benchmark Results

**Model:** `gemini-3.5-flash-lite`  
**Soak:** 2026-09-10 HTTP `:3000` / harness logs  
**SoT:** `golden/meal/Meal_04_log` (prototype = harness only)  
**Primary bar:** bug-free E2E journey — brand bind, OCR, multi-turn continuity, dish identity, serving size, nutrient completeness, personalized verdict, unlisted harms/benefits. Exact macro ±% is secondary.

**GT dish lists:** `prototype/meallog/images/Image_nutrients_true_value.md` (promote into each `correct_results.md`).

---

## 0. Criteria coverage map (which case exercises what)

| Criterion | 01 Yolk | 02 Lidl | 06 Mie Gacoan | 08 Oats label | 09 Steak/F&C | 10 Barcode hotpot | 11 Seafood+Mr Oat | Gap |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **Brand DB retrieval** (agent writes brand → DB completes nutrients) | YES (`Yolk`) | partial (Lidl pack) | — | YES (Sunrise / oats brand) | — | — | partial (`Mr Oat`) | Live assert brand emit + catalog hit still missing |
| **OCR accuracy** | — | pack/brand | menu names/prices | nutrition panel | — | barcode stickers | receipts + stickers | Formal OCR score not automated yet |
| **Multi-turn continuity** | — | — | — | 2-turn clarify | — | 2-turn clarify | bracket same-turn | **10 fails continuity** |
| **Dish count / naming** | 3/3 | 2/2 | 3/3 | 1/1 | 3/3 | **live 1–2 vs GT 5** | **live 2 vs GT 6** | **10 & 11 under-extract** |
| **Serving size** | — | pack serving | — | per-100g → portion | — | sticker kg | sticker + `[70g]` | **No Indo per-pack pack meal yet** |
| **Nutrition — core** | yes | yes | yes | yes | yes | yes | yes | Presence required |
| **Nutrition — additional (31-key)** | incomplete | incomplete | incomplete | incomplete | incomplete | incomplete | incomplete | Completeness later |
| **Verdict / recommendation** | advice | advice | advice | advice | advice | advice | advice | Need target-tied rubric |
| **Unlisted harms / benefits** | soft | soft | soft | fibre tip | sugar/oil tip | iron tip | marine tip | Need explicit score |
| **Grouping** | — | — | — | — | — | — | — | Mode D → Meal_03 |

---

## 1. At-a-glance execution matrix

| Dimension | 01 Yolk | 02 Lidl | 06 Mie Gacoan | 08 Oats + clarify | 09 Steak / F&C | 10 Barcode hotpot | 11 Seafood + Mr Oat |
|---|---|---|---|---|---|---|---|
| **Input types** | Brand DB + plate | Pack + serving | Menu OCR as log | Label OCR + serving + multi-turn + brand | Multi-plate | Barcode OCR + multi-turn | Receipt OCR + Mr Oat brand |
| **Photos / latency** | 1 / 6.0s | 1 / 6.3s | 2 / 5.2s | 2 / 7.4s | 2 / 11.7s | 2 / 11.0s | 3 / 5.2s |
| **Contract PASS** | yes | yes | yes | yes (rerun) | yes | yes (rerun) | yes |
| **GT dishes** | 3 | 2 | 3 | 1 | 3 | **5** (blade, rendang, broccoli, baby corn, enoki) | **6** (Mr Oat, ikan cendro, cumi, pak choy, telur, enoki) |
| **Live dishes** | 3 OK | 2 OK | 3 OK | 1 OK | 3 OK | **1 final** (Turn1: hotpot+telur; Turn2 dropped telur + lines) | **2** (merged seafood hotpot + oats) |
| **Brand bind scored** | not asserted | pack named | — | not asserted | — | — | Mr Oat from brackets |
| **OCR** | n/a | pack text | menu names OK | panel → clarify OK | n/a | stickers partial | receipts partial |
| **Multi-turn** | n/a | n/a | n/a | OK kept dish | n/a | **FAIL lost items** | n/a |
| **Serving size** | n/a | pack weights | n/a | 45g after clarify | n/a | 650g after clarify | 70g oats brackets OK |
| **Core nutrients present** | yes | yes | yes | yes | yes | yes | yes |
| **Additional 31-key** | no | no | no | no | no | no | no |
| **Personalized advice** | yes | yes | yes | yes | yes | yes | yes |
| **Unlisted harm/benefit** | lean/veg | — | sugar drink | soluble fibre | sugar/oil | iron/veg | marine protein |
| **Strict E2E verdict** | brand unproven | strong | OK | edit OK | OK | **FAIL dish+turn** | **FAIL under-extract** |

---

## 2. Deep findings

### Dish count (10 & 11) — confirmed under-extract
- **10 GT:** 5 barcode SKUs. Live collapsed to 1 hotpot after clarify; telur lost on Turn 2.
- **11 GT:** 6 line items. Live returned 2 (merged prep + Mr Oat).

Contract PASS hid identity/continuity bugs.

### Brand DB (01, 08)
- Pipeline supports `yolk` chain + `matchBrandMenu`.
- Soak did not prove agent emitted brand + DB completed nutrients.

### Indo per-pack serving gap
- Serving covered by **02** and **08** only.
- No Indonesian **per pack** packaged meal in golden photos yet — need your photo (Indomie / Ultramilk / similar).

---

## 3. Related
- Mode D: `../Meal_03_compare/benchmark_result.md`
- Move `Image_nutrients_true_value.md` into golden SoT next.
