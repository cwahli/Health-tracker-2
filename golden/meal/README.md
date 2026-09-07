# golden/meal — meal benchmark goldens

Each `Meal_NN/` folder is one computation use case: photos + `Instruction.md`
+ `expected.json` (dishes, 32-nutrient vectors, totals, label locks).

## Adding Meal_02

1. Add photos (≤200 KB each, `NN_description.jpg`).
2. Copy `Meal_01/expected.json` shape: dishes with `weightGrams`,
   `nutrients` in `NUTRIENT_KEYS` order, `source` (`label_lock` | `estimate`),
   `lockedLabelTruth` for packaged items, meal `totals` that equal the
   column sums (verify with the summation check).
3. Write `Instruction.md`: photo→dish map + consumed-amount assumptions.
4. Flag anything not directly legible in `verifyFlags`.
