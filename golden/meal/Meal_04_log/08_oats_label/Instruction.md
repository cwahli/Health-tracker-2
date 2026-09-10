# Sunrise Rolled Oats — nutrition label + portion clarify

- **Proto case:** `08` (`prototype/meallog/runner.ts`)
- **Mode:** A (meal log) + edit/portion-clarify
- **Input types:** nutrition_label, portion_clarify_edit
- **Photos:** 08_rolled_oats_1.jpg, 08_rolled_oats_2.jpg
- **Model:** gemini-3.5-flash-lite

## Consumed-amount assumptions
See `expected.json` macros (from prototype runner groundTruth — refine via OCR/elastic analysis before treating as final clinical truth).

## Edit turns
Turn 1: scout + clarify if label portion ambiguous. Turn 2: apply portion choice / bracket text. Capture both in debug_runs/.
