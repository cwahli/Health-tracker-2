# prototype/meallog — harness only

**Canonical truth for meal benchmarks lives in [`golden/meal/`](../../golden/meal/).**

| Suite | Golden path |
|---|---|
| Edit multi-turn | `golden/meal/Meal_01` |
| Multi-photo / barcodes | `golden/meal/Meal_02` |
| Compare Mode D (6 sets) | `golden/meal/Meal_03_compare` |
| Meal log matrix (label/menu/plate/…) | `golden/meal/Meal_04_log` |

## Model
Use **`gemini-3.5-flash-lite`** (same as production scout defaults). If a script still mentions an older model, treat golden + this pin as authoritative.

## Runners
- Log: `npm run test:benchmark:food -- --case NN` (`runner.ts`)
- Compare six-set Vertex GT: `npx tsx prototype/meallog/compare/run_meal03_six_vertex_gt.ts`

Do not treat `live_output_*.json` or prototype-only summaries as ground truth — promote into golden `correct_results.md` / `benchmark_result.md` after frozen-GT scoring.
