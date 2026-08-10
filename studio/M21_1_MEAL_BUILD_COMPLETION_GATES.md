# M21.1 — Meal Build completion (close gaps + self-check)

**Status:** ACTIVE — upload to **AI Studio** (do not re-open full M21).  
**Who commits/pushes:** **AI Studio only**.  
**Repo:** https://github.com/cwahli/Health-tracker-6  
**Plan:** `plan/MEAL_BUILD_DURABLE_STATE.md`  
**Why this pack:** Independent audit found M21 scaffolding on GitHub but **incomplete product wiring**. This pack closes the real gaps with a **hard gate that fails until fixed**.

**Do not rebuild:** nutrient math, full `server.ts` rewrite, Temporal/LangGraph, full chaos matrix infra.

---

## A. User prompt (copy-paste to AI Studio)

```text
Follow studio/M21_1_MEAL_BUILD_COMPLETION_GATES.md only.

You are AI Studio. Commit/push only after master gate exit 0.

Goal: close Meal Build gaps from the M21 audit:
1) Happy-path mealBuild on successful new_log (not only dietitian catch)
2) Mode D comparison.groups → ComparisonSet (live server shape)
3) Wire projectDietitianInput call site before dietitian LLM
4) Align historyLog with debugPayload (dual-read kind|type, at|timestamp)
5) appendHistory on dietitian degrade + happy-path attach
6) UI: comparison.groups + staleDietitianNarrative badge
7) Keep all existing degrade/zombie/OCC helpers

SELF-CHECK is mandatory (section E). Then run master gate §F.
If assert-meal-build-m21-1.mjs exits non-zero, you are NOT done — fix and re-run.
Do not weaken the assert script.
Do not claim COMPLETE without pasting GATE LOG exit codes.

Forbidden until exit 0: "all done", "fully verified", "M21 complete".
```

---

## B. Anti-miss (binding)

1. Import without **production call site** = FAIL.  
2. Grep-only “symbol exists” ≠ done — assert checks **calls** and **unique log markers**.  
3. Mode D live shape is **`comparison.groups`**, not only `options`.  
4. Happy-path attach must run on **success** new_log after nutrients exist.  
5. Do not remove dietitian degrade salvage.  
6. Do not weaken `scripts/assert-meal-build-m21-1.mjs`.  
7. Mode A / D / Edit STATUS columns all required.  
8. If a check is intentionally deferred: mark **known-broken** in AI_HANDOVER — else FAIL.

---

## C. Already DONE (do not rebuild)

| Item | Notes |
|------|--------|
| `src/mealBuild/*` core types/consolidate/adapters (partial) | Extend, don’t rewrite |
| Dietitian catch → `markDietitianDegraded` | Keep |
| JobStore `mealBuild`, skipScout resume | Keep |
| Unit tests zombie / stale weight | Keep |
| M20 governance | Done |

---

## D. Work items (do in order)

### D1 — Happy-path MealBuild attach

**File:** `server_meal_orchestrator.ts`

Add (or ensure) exports:

```ts
import { fromPendingFoodLog, toPendingFoodLog } from './src/mealBuild/adapters.js';
import { consolidateMeal, appendHistory, migrateMealSchema } from './src/mealBuild/consolidate.js';
import type { MealBuild } from './src/mealBuild/types.js';

/** Success path: build MealBuild from finalized parsedData after calc/aggregate. */
export function attachHappyPathMealBuild(opts: {
  parsedData: any;
  jobId?: string;
  activeMeal?: any;
  scoutItems?: any[];
  diningEnvironment?: string;
  degradedStages?: string[];
}): { mealBuild: MealBuild; pendingFoodLog: any } {
  const { parsedData, jobId, activeMeal, scoutItems, diningEnvironment, degradedStages } = opts;
  const base = migrateMealSchema(
    activeMeal?.mealBuild ||
      fromPendingFoodLog(parsedData, {
        id: jobId || parsedData?.id || `meal_${Date.now()}`,
        mode: 'new_log',
      })
  );
  let meal = consolidateMeal(
    base,
    {
      ...fromPendingFoodLog(parsedData, { id: base.id, mode: base.mode || 'new_log' }),
      savable: true,
      lastCompletedStage: degradedStages?.length ? 'calculation' : 'dietitian',
      degradedStages: degradedStages || [],
      diningEnvironment: diningEnvironment || base.diningEnvironment,
      scoutSnapshot: scoutItems || base.scoutSnapshot,
      staleDietitianNarrative: false,
    },
    'calculation',
    { actor: 'job_stage_calculation', stageKey: `${base.id}|calculation|1`, attempt: 1 }
  );
  meal = appendHistory(meal, {
    type: 'stage_complete',
    timestamp: new Date().toISOString(),
    stage: 'calculation',
    message: 'Happy-path meal attached (savable)',
  } as any);
  // Unique marker string required by gate:
  // callers must also addDebugLog('[MealBuild] happy-path')
  return { mealBuild: meal, pendingFoodLog: toPendingFoodLog(meal) };
}
```

**File:** `server.ts` — after `parsedData` has final `nutrients` + `itemsBreakdown` and **before** success `res.json` / stream `final: true` for `new_log`:

```ts
import { attachHappyPathMealBuild, markDietitianDegraded, buildSavableMealFromParsed } from './server_meal_orchestrator.js';
// ...
addDebugLog('[MealBuild] happy-path');
const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
  parsedData,
  jobId: req.body.jobId,
  activeMeal: req.body.activeMeal,
  scoutItems: visionScoutItems,
  diningEnvironment,
});
// Prefer pendingFoodLog for client; always include mealBuild on success payload:
// result / body: { ..., data: pendingFoodLog or parsedData merged, mealBuild, savable: true }
```

**Rules:**

- Merge `pendingFoodLog` fields into existing success shape without dropping imageUrl/scoutItems.  
- Call **only after** calc nutrients exist.  
- Degrade path stays separate with `[Dietitian Degrade]`.

### D2 — Mode D `groups` adapter + server attach

**File:** `src/mealBuild/adapters.ts` — `fromEvaluationComparison`:

```ts
// Accept BOTH live server groups and legacy options
const rawGroups =
  (Array.isArray(comparison?.groups) && comparison.groups) ||
  (Array.isArray(comparison?.options) && comparison.options) ||
  [];
// Map each group → option Meal:
// content.name = group.groupName || group.name
// items from group.items OR scoutItems filtered by group.scoutItemIndices
```

**`toEvaluationPayload`:** emit **both**:

```ts
comparison: {
  groups: /* from optionMeals for live clients */,
  options: /* same, for M21 UI that read options */,
}
```

**File:** `server.ts` evaluation branch after `comparisonData.groups = applyServerAverageNutrients(...)`:

```ts
import { fromEvaluationComparison } from './src/mealBuild/adapters.js';
addDebugLog('[MealBuild] mode=D');
const comparisonSet = fromEvaluationComparison(comparisonData, visionScoutItems, {
  id: req.body.jobId || `cmp_${Date.now()}`,
});
// include comparisonSet on res.json / stream final result alongside comparison
```

**File:** `TaskPlaceholderCard.tsx` — Mode D preview must use:

```ts
const options =
  job.result?.comparisonSet?.optionMeals ||
  job.result?.comparison?.options ||
  job.result?.comparison?.groups ||
  [];
// map groupName || content?.name || name
```

### D3 — Wire `projectDietitianInput`

**File:** `server.ts` just before dietitian LLM call (where preCalc / payload is assembled):

```ts
import { projectDietitianInput } from './src/mealBuild/projectors.js';
// Build a temporary meal or use mealBuild-in-progress
const dietitianProjection = projectDietitianInput(
  /* meal with items + nutrients from preCalc */,
  lightUserProfile
);
addDebugLog('[MealBuild] projector dietitian');
// Use projection.macroTotals + itemsSummary in the dietitian user content instead of dumping databaseMatchesArray
```

Minimum acceptable: call `projectDietitianInput(...)` and log the marker; feed **macros summary** into prompt. Full prompt rewrite optional if risky — but **call site required**.

### D4 — History / debug dual-read

**File:** `src/utils/debugPayload.ts` history loop:

```ts
const when = entry.at || entry.timestamp || '';
const kind = entry.kind || entry.type || 'event';
lines.push(`- **${when}** [${kind}]: ${entry.message || ''} ${entry.detail || entry.details ? `(${entry.detail || entry.details})` : ''}`);
```

**File:** `server_meal_orchestrator.ts` `markDietitianDegraded` — after building meal:

```ts
import { appendHistory } from './src/mealBuild/consolidate.js';
m = appendHistory(m, {
  type: 'error',
  timestamp: new Date().toISOString(),
  stage: 'dietitian',
  message: errorMsg || 'Dietitian degraded',
} as any);
```

### D5 — staleDietitianNarrative UI

**File:** `TaskPlaceholderCard.tsx` when `pendingFoodLog` / meal shown:

```tsx
{(job.result?.mealBuild?.staleDietitianNarrative || job.mealBuild?.staleDietitianNarrative) && (
  <div className="text-amber-700 text-xs">
    Macros updated — coaching may reflect a previous portion. Use Retry Advice to refresh.
  </div>
)}
```

### D6 — Client done path

Ensure when analysis `done` / final result arrives, job stores:

```ts
mealBuild: event.data?.mealBuild || result.mealBuild
savable: result.savable || result.mealBuild?.savable
degradedStages: result.degradedStages
```

(JobQueueRunner and/or App — wherever final food result is applied.)

### D7 — Tests already in tree

Keep/fix `src/mealBuild/__tests__/m21_1_completion.test.ts` (pack tree includes it). Must pass:

- groups → optionMeals  
- zombie delete  
- history fields  
- projector no databaseMatchesArray  
- round-trip critical fields  

---

## E. SELF-CHECK (Studio must run and paste)

```text
SELF-CHECK
- [ ] attachHappyPathMealBuild exists and server logs [MealBuild] happy-path on success new_log
- [ ] Success JSON/SSE includes mealBuild (not only degrade catch)
- [ ] fromEvaluationComparison reads comparison.groups
- [ ] server evaluation logs [MealBuild] mode=D and returns comparisonSet
- [ ] projectDietitianInput( appears in server.ts or orchestrator (production)
- [ ] debugPayload dual-reads kind|type and at|timestamp
- [ ] markDietitianDegrade appendHistory error
- [ ] TaskPlaceholderCard: groups + staleDietitianNarrative
- [ ] node scripts/assert-meal-build-m21-1.mjs → exit 0
- [ ] npx vitest run src/mealBuild/__tests__/m21_1_completion.test.ts → exit 0
- [ ] food-calc vitest suite → exit 0
- [ ] npx tsc --noEmit → exit 0
- [ ] Did NOT weaken assert-meal-build-m21-1.mjs
```

If any box unchecked → **not COMPLETE**.

---

## F. Master gate (exit 0 required)

```bash
# 1) Structural hard gate (designed to fail incomplete M21)
node scripts/assert-meal-build-m21-1.mjs

# 2) Completion unit tests
npx vitest run src/mealBuild/__tests__/m21_1_completion.test.ts

# 3) Regression mealBuild + food-calc
npx vitest run src/mealBuild/__tests__/
npx vitest run server_budget_reconcile.test.ts server_vision_scout.test.ts server_nutrient_aggregation.test.ts server_portion_clarify.test.ts

# 4) Types
npx tsc --noEmit
```

**Preflight (prove the gate is real):** Before coding, run `node scripts/assert-meal-build-m21-1.mjs` once — expect **FAIL** on current incomplete tree. After fixes, expect **PASS**. If it already passes without D1–D5, the assert was weakened → **FAIL honesty**.

### GATE LOG template (paste into STATUS)

```text
GATE LOG
assert-m21-1:  exit 0
vitest m21_1:  exit 0
vitest mealBuild: exit 0
vitest food-calc: exit 0
tsc:           exit 0
preflight fail-then-pass: yes
```

---

## G. STATUS table (fill before COMPLETE)

| ID | Acceptance | Mode A | Mode D | Edit | Evidence (file:line or log marker) | PASS/FAIL |
|----|------------|:------:|:------:|:----:|--------------------------------------|-----------|
| C1 | Happy-path mealBuild on success | PASS | n/a | PASS | `server.ts:9356` (`[MealBuild] happy-path`) | PASS |
| C2 | Degrade salvage still works | PASS | n/a | PASS | `server.ts:9665` (`[Dietitian Degrade]`) | PASS |
| C3 | groups → ComparisonSet | n/a | PASS | n/a | `src/mealBuild/adapters.ts:60` (`[MealBuild] mode=D`) | PASS |
| C4 | projectDietitianInput call site | PASS | PASS | PASS | `server.ts:7713` (`[MealBuild] projector dietitian`) | PASS |
| C5 | history/debug dual-read + appendHistory | PASS | PASS | PASS | `src/utils/debugPayload.ts:191`, `server_meal_orchestrator.ts:33` | PASS |
| C6 | UI groups + stale narrative | PASS | PASS | PASS | `TaskPlaceholderCard.tsx:375,381` | PASS |

COMPLETE only if all PASS and §F all exit 0.

---

## H. Commit (AI Studio only)

```bash
git add \
  scripts/assert-meal-build-m21-1.mjs \
  src/mealBuild \
  server_meal_orchestrator.ts \
  server.ts \
  serverJobs.ts \
  src/components/TaskPlaceholderCard.tsx \
  src/components/chat-cards/FoodEvaluationComparisonCard.tsx \
  src/utils/debugPayload.ts \
  src/jobs/JobQueueRunner.ts \
  src/jobs/FoodAgentExecutor.ts \
  src/App.tsx \
  studio/M21_1_MEAL_BUILD_COMPLETION_GATES.md \
  studio/ACTIVE_STATUS.md \
  AI_HANDOVER.md

# only files you changed

git commit -m "$(cat <<'EOF'
fix(meal-build): M21.1 completion — happy-path mealBuild, Mode D groups, projectors, history/debug gates

Wire progressive MealBuild on success path, map comparison.groups to ComparisonSet,
call projectDietitianInput, align historyLog with debug report, surface stale advice,
and add hard assert-meal-build-m21-1 self-check gate.

EOF
)"

git push origin HEAD
```

Update `AI_HANDOVER.md`: M21.1 DONE + paste GATE LOG.  
Move this pack to `archive/studio/completed-2026-08/` only after push.

---

## I. Out of scope (explicit)

- Full chaos matrix §12 automation  
- R2 lifecycle infra (document only if easy)  
- Biomarker durable build  
- Rewriting budget/reconcile math  
- Replacing entire food-analyze control flow  

---

## J. How Studio knows it’s really done (no re-pass)

| Check | Fails incomplete M21? | Why |
|-------|----------------------|-----|
| `assert-meal-build-m21-1.mjs` | Yes | Requires happy-path marker, groups, projector call, UI stale, dual history |
| `m21_1_completion.test.ts` | Yes | groups fixture, zombie, projector strip |
| Preflight fail→pass | Yes | Proves gate not weakened |
| STATUS evidence column | Yes | Must cite markers / paths |

If assert is green but product still wrong, add a known-broken note — do not silence the gate.
