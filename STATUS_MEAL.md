## STATUS
| ID | Criterion | Result | Evidence |
|----|-----------|--------|----------|
| N1 | componentsDetailList for all components | PASS | Switched to `componentsDetailList`, pushed `cIdx === 0`. |
| N7 | No duplicate name+grams rows; dedupe log | PASS | Implemented `dedupedMap` combining lines by `normalizeFoodKey` and rounded grams. |
| N1b | softBudget scales detail list once | PASS | `softBudget` scales all entries of `componentsDetailList`. |
| N2 | syrup hard reject | PASS | Implemented explicit regex hard-reject in `findBestMatch`. |
| N3 | yoghurt→yogurt | PASS | Appended `greek yogurt plain` fallback in `prepareSearchQueryWithState`. |
| N4 | mega-component query split | PASS | Splits on `and` `,` or >=8 words in `server.ts` resolution. |
| N5 | multi-comp salad not VISCOUS_SAUCE | PASS | Injected `COMPOUND_MEAL` override in `classifyUniversalPhysicalFormV3`. |
| N6 | receipt uses preCalc multi-row | PASS | Suppressed Row 2 if `hasComponents`. |
| N8 | ensureFoodCatalogSchema + admin route | PASS | DDL auto-apply via `pg`; explicit catch logs. Admin REST exposed. |
| G  | assert-meal-accuracy-next.mjs exit 0 | PASS | Evaluated successfully with exit code 0. |

**Overall:** COMPLETE
