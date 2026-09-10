# Seafood prep + Mr Oat rolled oats (brackets)

- **Proto case:** `11` (`prototype/meallog/runner.ts`)
- **Mode:** A (meal log) + edit/portion-clarify
- **Input types:** receipt_ocr, ingredients_photo, bracket_text_edit
- **Photos:** 11_seafood_squid_fish_ingredients.jpg, 11_seafood_squid_fish_receipt_1.jpg, 11_seafood_squid_fish_receipt_2.jpg
- **Model:** gemini-3.5-flash-lite

## Consumed-amount assumptions
See `expected.json` macros (from prototype runner groundTruth — refine via OCR/elastic analysis before treating as final clinical truth).

## Edit turns
Turn 1: scout + clarify if label portion ambiguous. Turn 2: apply portion choice / bracket text. Capture both in debug_runs/.
