---
slug: golden-meal-suite-20260911
date: 2026-09-11
class: PROCESS_GAP
node: Builder
status: draft
---

# Learning: golden Meal_04 suite stays DRAFT until a 32-key ledger exists

## What happened
Enriched all 7 `golden/meal/Meal_04_log/*/correct_results.md` + `expected.json`
from prototype sources only (runner GT, `final_elastic_benchmark_results.json`,
`BENCHMARK_PERFORMANCE_SUMMARY.md`, CASE rerun logs). No macros invented:
case 11's scaffold nulls restored to the runner's explicitly approximate GT,
and the runner-vs-elastic GT conflict (700g/900kcal/P55 vs 892g/822kcal/P95.1)
kept on record instead of merged. All 7 stay DRAFT — no 32-key ledger exists
anywhere in the prototype (only 6–8 macros). `npm run test:benchmark:meal-golden`
(offline, 7/7) guards this invariant. Found HEAD `8412e8f` already held tasks
2+3 (Set3 anti-collapse + scorer); added only the missing PATCH deltas
(`Paket Kembung` literal, schema ≥40 forbid).

## What the user asked
Enrich Meal_04 goldens honestly; PATCH compare instructions; extend set3
scoring; add bench script; write learning; commit on `golden/meal-04-suite`.

## Keep
- DRAFT-vs-FINAL honesty + dual-GT conflict on record (11)
- Builder ≠ scorer separation (goldens score via script, never narrative)
- 08/10 Turn-2 harness regression documented in goldens, not just logs

## Propose standing (add only)
```json
{"id": "golden_draft_until_32key_ledger", "must_keep": "Meal_04_log cases stay DRAFT until a weighed/label-locked 32-key NUTRIENT_KEYS ledger lands; conflicting GTs stay on record, never averaged."}
```

## Propose skill delta (≤5 lines each, additive)
- planner:
- builder: When enriching goldens, cite every macro's source file+case; conflicting GTs both on record.
- guard:

## Do not
- Delete standing rows
- Merge journey packs
- Edit Guard scripts in this file's promote
