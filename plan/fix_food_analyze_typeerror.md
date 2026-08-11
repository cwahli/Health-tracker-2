# SDD: Fix Food Analyze TypeError & Dietitian Degradation

**Task:** `fix_food_analyze_typeerror`  
**Class:** Class M (Multi-file bug fix across `server.ts`, `server_pure_helpers.ts`, `server_budget_reconcile.ts`, `server_nutrient_aggregation.ts`)  
**Created:** 2026-08-11  

---

## 1. Structural Root Cause Diagnosis

### Primary Defect
The runtime error `TypeError: Cannot set properties of undefined (setting 'calories')` occurs during `/api/food/analyze` execution when code attempts to set `.calories` (or another nutrient property) on an object (`comp`, `item.nutrients`, `activeMeal.nutrients`, or `sumNutrients`) that is `undefined` or `null`.

When this `TypeError` is thrown inside the main try-block of `/api/food/analyze`, the catch block intercepts it, logs `[Food Analyze Error]: TypeError: Cannot set properties of undefined (setting 'calories')`, and subsequently enters the fallback path:
`[Dietitian Degrade] Dietitian failed permanently, but pre-calculated math exists. Salvaging meal build.`

Thus, the `[Dietitian Degrade]` errors reported by the user are a direct consequence of this unhandled `TypeError` crashing the primary food analysis pipeline before completion.

### Critical Assignment Sites Requiring Defensive Guarding
1. **`server_pure_helpers.ts` (`checkAtwaterConsistency` & `applyNutrientRealityChecks`)**:
   - `checkAtwaterConsistency` attempts to read `itemNutrients.protein` / `itemNutrients.calories` without first verifying `if (!itemNutrients) return;`.
   - `applyNutrientRealityChecks` forwards `itemNutrients` directly to `checkAtwaterConsistency` without verifying `itemNutrients`.
2. **`server_budget_reconcile.ts` (`applyPostReconcileTruthLocks`)**:
   - Destructures `input.sumNutrients` directly (`const { calories: sumCal, ... } = input.sumNutrients`). If `input.sumNutrients` is undefined, destructuring throws `TypeError: Cannot read properties of undefined (reading 'calories')`.
3. **`server.ts` Component Loops**:
   - Lines 6980-7025: `item.components.forEach((comp: any) => { comp.calories = ... })`. If an element in `item.components` is not an object or is undefined/null, assigning `comp.calories` throws `TypeError: Cannot set properties of undefined (setting 'calories')`.
   - Lines 8000, 8088, 8101: `componentsDetailList.forEach((s: any) => { s.calories = ... })`. Needs explicit `if (!s || typeof s !== 'object') return;`.
4. **`server_nutrient_aggregation.ts`**:
   - `aggregateItemsNutrients`: Ensure `rawItems` is checked with `Array.isArray(rawItems)` before calling `.map()`.

---

## 2. Code Pruning Inventory

- Remove redundant duplicate null checks (e.g. line 4873 vs 4874 in `server.ts` where `if (!activeMeal.nutrients) activeMeal.nutrients = {};` was repeated twice back-to-back).
- Replace unguarded nested property assignments with clean defensive initialization patterns (`if (!obj.nutrients) obj.nutrients = {};`).

---

## 3. Deterministic Boundary

- **LLM Role:** Strictly schema extraction, food name classification, and initial vision/prompt processing.
- **TypeScript Middleware Role:** All unit conversions, thermodynamic sanity checks (Atwater checks), nutrient sum aggregation, receipt row invariants, and defensive null/type guards. The LLM must never be blamed or degraded due to TypeScript type/null errors.

---

## 4. Telemetry Audit

- Logging for `[Atwater Check]` and `[Sanity Check]` will remain structured and concise via `addDebugLog`.
- Clean up duplicate or transient console error logs that mask the exact stack trace of runtime exceptions.

---

## 5. Regression Test Plan

1. **Vitest Unit Tests:**
   - `server_pure_helpers.test.ts`: Add test cases calling `checkAtwaterConsistency` and `applyNutrientRealityChecks` with `undefined` / `null` nutrients to verify safety.
   - `server_budget_reconcile.test.ts`: Add test cases calling `applyPostReconcileTruthLocks` with missing `sumNutrients` to verify safe default behavior.
2. **Execution Commands:**
   - `npx vitest run server_pure_helpers.test.ts server_budget_reconcile.test.ts`
