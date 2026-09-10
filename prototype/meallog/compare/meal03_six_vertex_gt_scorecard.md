# Meal_03 six-case Vertex GT scorecard — 2026-09-10T22:04:24.384Z
- Method: **production** Mode D monolith (graph not used)
- Eval owner: frozen GT + this script
- Overall: **5/6** pass (extract ≥90% target AND rec matches GT pattern; set3 also requires no catch-all≥40 and no kembung/mackerel in alert with offal/usus/seblak)
- Partial re-run: **set3** (other sets preserved from prior scorecard)
| Set | Extract | Rec vs GT | Catch-all≥40 | Kembung⊗OffalAlert | BBox | Latency | Pass |
|---|---|---|---|---|---|---|---|
| set1 | 9/6 (150%) ✅ | ✅ `Say Bread Plain Bun / Say Bread Plain Bun` | false | — | 4/4 | 9522ms | PASS |
| set2 | 4/4 (100%) ✅ | ✅ `Green Snack Wrapper / Green Snack Bar` | false | — | 3/3 | 6162ms | PASS |
| set3 | 116/104 (111.5%) ✅ | ✅ `Paket Uduk Kembung / Mackerel Uduk Rice Meal Set` | false | ok | 7/7 | 20077ms | PASS |
| set4 | 31/32 (96.9%) ✅ | ✅ `Es Kelapa Muda / Young Coconut Water` | false | — | 4/4 | 8912ms | PASS |
| set5 | 58/56 (103.6%) ✅ | ✅ `Ikan Nila Garang Asem + Nasi / Tilapia in Tangy Spiced Broth` | false | — | 5/5 | 13532ms | PASS |
| set6 | 35/17 (205.9%) ✅ | ❌ `None - All shelf options violate active nutritional targets.` | false | — | 1/1 | 6618ms | FAIL |
### Set3 clustering gates
- FAIL if any group has ≥40 items (`hasCatchAll40`).
- FAIL if a dish matching `/kembung|mackerel/i` sits in an alert/Tier4 group that also contains offal/usus/ati/jeroan/seblak.
- Frozen GT rec patterns unchanged (Kembung OR Sayur Asem still accepted).
Raw: `/workspace/biomarker-and-nutrient-tracker/prototype/meallog/compare/meal03_six_vertex_gt_results.json`