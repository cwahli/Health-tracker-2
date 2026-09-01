# F-10 PR1 Gemini — expand gate is in tree; derive calories from macros

**For:** Gemini / AI Studio. **PRE-APPROVED / MULTIPASS AUTONOMOUS.**  
**Spec:** `plan/ROADMAP.md` F-10.1 (landed) + F-10.2 (you). Class `ALWAYS_SECOND_AGENT`.  
**Who:** You implement F-10.2 only. Grok reviews. Do not start F-10.7 cutover.

Grok already landed `shouldExpandMealAgent` + its vitest + `scripts/assert-f10-pr1.mjs`. You do **not** edit `AGENTS.md`, `docs/agent/**`, `App.tsx`, or delete the Dietitian create call.

---

## A. Paste this as the Gemini prompt

```text
You are doing F-10 PR1 for Health-tracker. Read studio/F10_PR1_GEMINI.md and execute IDs F10P1-1 … F10P1-3 only. PRE-APPROVED. Do not ask the human to confirm reads, file views, or “continue” between IDs. If a file read truncates, immediately read the rest in this same turn.

Already done (do not rebuild): src/mealBuild/shouldExpandMealAgent.ts; src/mealBuild/__tests__/shouldExpandMealAgent.test.ts; scripts/assert-f10-pr1.mjs; plan/FOOD.md Process; food-calc emit-vs-derive.

DO:
1. F10P1-1 — Run the named gates in pack §F. If shouldExpandMealAgent tests fail, fix only that helper. Do not rewrite it.
2. F10P1-2 — In server_derivation.ts calculateDerivedNutrients: when protein, carbohydrates, and totalFat are all present numbers, calories MUST be computeCaloriesFromMacros (ignore base.calories). deriveCarbohydratesFromEnergy only when carbohydrates is missing. OCR/brand printed-kcal lock stays in finalizeDishLedger, not this helper.
3. F10P1-3 — Add vitest cases in server_derivation.test.ts: agent calories 9999 with P/C/F present → Atwater; missing carbs still uses deriveCarbohydratesFromEnergy.

DO NOT:
- Ask the user to approve reading any file
- npm test / golden:inbox / golden_g1 / assert-biomarker-* / assert-free-tier-*
- Edit AGENTS.md, docs/agent/**, plan/**
- Edit App.tsx, LogChat.tsx, JobStore.ts
- Delete or skip the Dietitian call in server_food_analyze_run.ts (that is F-10.7, later pack)
- Add LLM calories to scout schema; add COMPLETE/DELEGATE to the expand helper
- npm run build
- Leave patch_*.mjs / fix_*.mjs at repo root

Gate: pack §F only. Then stop.
```

---

## B. Honesty

- 800 green tests is **not** COMPLETE. Named files in §F must exit 0.
- Do not claim F-10 create cutover is done. Dietitian still runs on create until F-10.7.

---

## C. Already DONE

| Piece | Where |
|-------|--------|
| Expand gate | `src/mealBuild/shouldExpandMealAgent.ts` |
| Expand tests | `src/mealBuild/__tests__/shouldExpandMealAgent.test.ts` |
| Assert | `scripts/assert-f10-pr1.mjs` |
| Laws | `plan/FOOD.md` Process, `docs/agent/domains/food-calc.md` §1c |

---

## D. Path matrix

| Input | Calories writer |
|-------|-----------------|
| P=25 C=50 F=20, agent calories=9999 | 480 (Atwater) |
| C missing, calories=400, P=25 F=20 | carbs from energy fallback; then kcal from macros |
| Printed label kcal | **not this helper** — finalize lock (out of this PR) |

---

## E. FIND → REPLACE

### E1. `calculateDerivedNutrients` in `server_derivation.ts`

Replace the calories assignment so **P+C+F present ⇒ always Atwater**. Keep the existing carbs fallback when C is missing.

### E2. Tests — append to `server_derivation.test.ts` `calculateDerivedNutrients` describe (create the describe if missing)

```ts
it('ignores agent calories when P/C/F are present (F-10.2)', () => {
  const out = calculateDerivedNutrients({
    calories: 9999,
    protein: 25,
    carbohydrates: 50,
    totalFat: 20,
    saturatedFat: 5,
    transFat: 0,
    sodium: 400,
  });
  expect(out.calories).toBe(480);
  expect(out.unsaturatedFat).toBe(15);
  expect(out.salt).toBeCloseTo(1.02, 2);
});
```

---

## F. Gates (this pack only)

```bash
npx tsc --noEmit
npx vitest run src/mealBuild/__tests__/shouldExpandMealAgent.test.ts server_derivation.test.ts
node scripts/assert-f10-pr1.mjs
```

Do not run anything else.

---

## G. STATUS

| ID | Done when |
|----|-----------|
| F10P1-1 | expand helper tests PASS |
| F10P1-2 | P/C/F present → Atwater, agent kcal ignored |
| F10P1-3 | named vitest + assert-f10-pr1 + tsc exit 0 |

---

## H. Out of scope

F-10.3 workers · F-10.4 narrate substitute · F-10.5 edit role · F-10.6 fat/Na TS table · F-10.7 delete Dietitian-on-create · F-10.8 soak · F-9.5 App poller · Q-7 golden_g1 fold · USDA
