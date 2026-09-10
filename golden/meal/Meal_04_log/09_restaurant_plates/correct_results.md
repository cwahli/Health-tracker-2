# Correct results — Steak + fish & chips plates

## Status
**DRAFT** — macros seeded from `prototype/meallog/runner.ts` groundTruth for proto `09`.
Expand with full OCR locks + 32-key nutrients from elastic/OCR benches before promoting to FINAL.

## Meal totals (seed)
```json
{
  "weight": 1135,
  "calories": 1340,
  "protein": 78.0,
  "carbs": 102.0,
  "fat": 67.0,
  "satFat": 16.0,
  "fibre": 10.0,
  "sodium": 1850
}
```

## Must-pass gates
- Model: gemini-3.5-flash-lite
- Identity of visible dishes (no phantom)
- Macro band vs seed (calories within contract used by runner)
- Label lock when nutrition panel visible (case 08)
