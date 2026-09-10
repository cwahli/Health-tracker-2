# Meal_03 six-case Vertex GT scorecard — 2026-09-10T21:53:04.583Z

- Method: **production** Mode D monolith (graph not used)
- Eval owner: frozen GT + this script
- Overall: **5/6** pass (extract ≥90% target AND rec matches GT pattern)

| Set | Extract | Rec vs GT | Catch-all≥40 | BBox | Latency | Pass |
|---|---|---|---|---|---|---|
| set1 | 9/6 (150%) ✅ | ✅ `Say Bread Plain Bun / Say Bread Plain Bun` | false | 4/4 | 9522ms | PASS |
| set2 | 4/4 (100%) ✅ | ✅ `Green Snack Wrapper / Green Snack Bar` | false | 3/3 | 6162ms | PASS |
| set3 | 100/104 (96.2%) ✅ | ✅ `Sayur Asem / Sour Vegetable Tamarind Soup` | true | 4/4 | 18300ms | PASS |
| set4 | 31/32 (96.9%) ✅ | ✅ `Es Kelapa Muda / Young Coconut Water` | false | 4/4 | 8912ms | PASS |
| set5 | 58/56 (103.6%) ✅ | ✅ `Ikan Nila Garang Asem + Nasi / Tilapia in Tangy Spiced Broth` | false | 5/5 | 13532ms | PASS |
| set6 | 35/17 (205.9%) ✅ | ❌ `None - All shelf options violate active nutritional targets.` | false | 1/1 | 6618ms | FAIL |

Raw: `/workspace/biomarker-and-nutrient-tracker/prototype/meallog/compare/meal03_six_vertex_gt_results.json`