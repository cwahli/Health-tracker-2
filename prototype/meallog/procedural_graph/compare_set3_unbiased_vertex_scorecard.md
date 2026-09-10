# Unbiased Set 3 A/B (Vertex) — 2026-09-10T20:31:33.375Z

## Fairness
- Same model `gemini-3.5-flash-lite`, same 2 photos, blank user text
- **Shared** patient targets + generic anti-collapse (no dish-name spoilers)
- Arm A = production instruction/schema; Arm B = procedural steps + compact schema **with required boundingBox2D**
- Vertex project `test-llm-project-502307` location `global`

## Scorecard vs benchmark_result.md (Set 3) — quality-focused

| Criterion | Ground truth / target | Arm A Production | Arm B Procedural (unbiased) |
|---|---|---|---|
| Extraction / recall vs 104 | 104 / ~96%+ | 101 / 97.1% | 101 / 97.1% |
| Groups formed | ~4 | 4 | 3 |
| Dishes assigned to groups (orphan gap) | all assigned | 100 (gap 1) | 29 (gap 72) |
| Catch-all ≥40 items | false | true | false |
| Macro keys complete on all groups | yes (≤10% clustering prerequisite) | true (4/4) | true (3/3) |
| Valid bounding boxes | all groups | 4/4 (100%) | 3/3 (100%) |
| Recommendation Kembung **or** Sayur Asem | either | true — `Paket Kembung (Nasi + Ikan Kembung + Sayur Asem + Tahu + Tempe) / Mackerel Meal Set` | true — `PAKET KEMBUNG (Nasi + Ikan Kembung + Sayur Asem + Tahu + Tempe)` |
| Advice: harms called out (fry/Na/offal/seblak) | high | 4/4 {"deepFryOrOxidized":true,"highSodiumSalted":true,"offal":true,"seblakOrStarch":true} | 4/4 {"deepFryOrOxidized":true,"highSodiumSalted":true,"offal":true,"seblakOrStarch":true} |
| Advice: benefits called out (Ω-3 / broth-fiber) | high | 2/2 {"marineOmega3":true,"clearBrothFiber":true} | 2/2 {"marineOmega3":true,"clearBrothFiber":true} |
| Advice ties to patient targets | yes | true | true |
| Latency ms | lower better | 16615 | 8787 |
| Candidate tokens | lower better | 5770 | 2939 |

Raw JSON: `/workspace/biomarker-and-nutrient-tracker/prototype/meallog/procedural_graph/compare_set3_unbiased_vertex_results.json`
