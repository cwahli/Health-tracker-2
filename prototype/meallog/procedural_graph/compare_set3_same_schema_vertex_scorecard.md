# Same-schema Set 3 A/B (Vertex) — isolates graph steps vs schema — 2026-09-10T20:39:03.692Z

## Fairness
- Same model `gemini-3.5-flash-lite`, same 2 photos, blank user text
- **Shared** patient targets + generic anti-collapse (no dish-name spoilers)
- **Same schema** (scoutOnlyCompareResponseSchema) on both arms; only production instruction vs procedural steps differ
- Vertex project `test-llm-project-502307` location `global`

## Scorecard vs benchmark_result.md (Set 3) — quality-focused

| Criterion | Ground truth / target | Arm A Production prompt | Arm B Procedural steps (same schema) |
|---|---|---|---|
| Extraction / recall vs 104 | 104 / ~96%+ | 113 / 108.7% | 102 / 98.1% |
| Groups formed | ~4 | 4 | 5 |
| Dishes assigned to groups (orphan gap) | all assigned | 60 (gap 53) | 102 (gap 0) |
| Catch-all ≥40 items | false | false | true |
| Macro keys complete on all groups | yes (≤10% clustering prerequisite) | true (4/4) | true (5/5) |
| Valid bounding boxes | all groups | 4/4 (100%) | 5/5 (100%) |
| Recommendation Kembung **or** Sayur Asem | either | true — `Sayur Asem / Tamarind Vegetable Soup` | true — `Sayur Asem / Sour Tamarind Vegetable Soup` |
| Advice: harms called out (fry/Na/offal/seblak) | high | 4/4 {"deepFryOrOxidized":true,"highSodiumSalted":true,"offal":true,"seblakOrStarch":true} | 4/4 {"deepFryOrOxidized":true,"highSodiumSalted":true,"offal":true,"seblakOrStarch":true} |
| Advice: benefits called out (Ω-3 / broth-fiber) | high | 2/2 {"marineOmega3":true,"clearBrothFiber":true} | 2/2 {"marineOmega3":true,"clearBrothFiber":true} |
| Advice ties to patient targets | yes | true | true |
| Latency ms | lower better | 16108 | 17961 |
| Candidate tokens | lower better | 5118 | 6510 |

Raw JSON: `/workspace/biomarker-and-nutrient-tracker/prototype/meallog/procedural_graph/compare_set3_same_schema_vertex_results.json`
