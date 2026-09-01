# Golden meals

These seven folders are the product contract. A change that moves their
identity, forbidden matches, or locked **scale** numbers does not ship.

Photos + `Instruction.md` are what the user actually does.
`expected.json` is what the test suite asserts.

There is **no** Scout → Dietitian pass anymore (F-10). Create is one Meal Agent
role; TypeScript derives calories / unsaturated fat / salt. Do not add
`calories` to agent fixtures. Do not replay `scout.json` through a dietitian.

Inner COMPLETE for these folders is **only** `npx vitest run tests/golden_meals.test.ts`.
Not `golden_g1.test.ts`, not `npm run golden:inbox`, not `npm test` (Q-7).

## Two layers

| Layer | What it is | Runs on edit |
|---|---|---|
| **A — Meal** | Photos, prompt, passes (identify / edit / portion / compare) | Fixture check only. Live Analyze is F-10.8 soak, one example. |
| **B — Resolve + math** | Query → canonical ID, never-match IDs, brand/label/refine math | `npx vitest run tests/golden_meals.test.ts` |

Layer B is how curator / USDA-not-found bugs become tests. A photo golden
that only checks “4 dishes found” would go green on Powerade berries.

Frozen outer soak (when needed): Meal Agent JSON (dishes/foods/P/C/F, **no kcal**),
not a scout+dietitian dump. `scout.json` in G1 / inbox is legacy until Q-7.

## The set

| ID | Folder | Mode | What it locks |
|---|---|---|---|
| G1 | `1. Multi-food log` | A + edit | 4 dishes, component IDs, croissant edit |
| G2 | `2. Composite dish with branded food` | A | Sainsbury oats 60g + latte + fruit lines |
| G3 | `3. Branded dish with incomplete data` | A + edit | Yolk brand, kcal-only vs full, half potatoes |
| G4 | `4. Portion size confirmation` | A, 2-step | Portion card, then one stitched meal |
| G5 | `5. Compare nutrition labels` | D | Printed label OCR + compare |
| G6 | `6. Compare menu items` | D | Menu extraction, not a consumed picnic |
| G7 | `7. Compare large set of similar choices` | D | Compact aisle, no 50-way curator |

## How to add a golden

1. New folder `N. Short name/`
2. Photos + `Instruction.md` (what the user types / attaches)
3. `expected.json` (copy G1 and fill)
4. Add the folder to `manifest.json`
5. Run `npx vitest run tests/golden_meals.test.ts`

Do not pin three different kcal totals for the same photos.

## Inbox loop (failing meal → test → fix → promote)

Do **not** re-log the meal 10 times. Capture once, replay until green.

```bash
node scripts/golden-from-debug.mjs ~/Downloads/debug-job_XXXX.md
npm run golden:inbox          # or npm run golden:inbox:watch
# fix catalog / plumbing
node scripts/golden-promote.mjs job_XXXX
```

See `inbox/README.md`.

