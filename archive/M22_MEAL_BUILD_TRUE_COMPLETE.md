# M22 — Meal Build TRUE COMPLETE (hardening + anti-bug)

**Status:** ACTIVE — upload after M21.1 is on `origin` (`4506dbd`+).  
**Who commits/pushes:** **AI Studio only**.  
**Plan:** `plan/MEAL_BUILD_DURABLE_STATE.md`  
**Depends on:** M21.1 green (`assert-meal-build-m21-1.mjs` nested inside M22 gate).

**Goal:** Close remaining gaps so Meal Build is **production-hard**: live context masks, all exit paths, stage lifecycle + limits, progressive history, cold debug, edit path, Mode D stream, chaos unit tests. Minimize future multi-agent bugs.

**Do not:** rewrite nutrient math · Temporal/LangGraph · full `server.ts` rewrite · invent second pipeline · weaken asserts.

---

## A. User prompt (copy-paste to AI Studio)

```text
Follow studio/M22_MEAL_BUILD_TRUE_COMPLETE.md only.
Architecture: plan/MEAL_BUILD_DURABLE_STATE.md.

You are AI Studio. Commit/push ONLY after master gate exit 0.

M21.1 already shipped. M22 hardens remaining gaps:
H1 Live dietitian projector (must APPLY to prompt — not dead call)
H2 mealBuild on edit/modify + Mode D stream final
H3 stageLifecycle begin/end + StageLimits circuit + history every stage event
H4 progressive scout/calc stage markers
H5 OCC path still works (rebase)
H6 coldDebug package builder + expired message
H7 chaos unit tests m22_completion
H8 dual-path serverJobs keeps mealBuild

Preflight: node scripts/assert-meal-build-m22.mjs — expect FAIL before fixes, PASS after.
Also keep: node scripts/assert-meal-build-m21-1.mjs exit 0.
Run full §F. Paste GATE LOG. Do not weaken asserts.
Forbidden until exit 0: "all done", "fully verified", "meal build complete".
```

---

## B. Anti-miss (binding)

1. **Dead code = FAIL** — `projectDietitianInput` assignment without using projection in prompt is FAIL (gate checks applied marker).  
2. Import without production call site = FAIL.  
3. Mode A / D / Edit all in STATUS.  
4. Nested **M21.1 must stay green**.  
5. Do not weaken `assert-meal-build-m21-1.mjs` or `assert-meal-build-m22.mjs`.  
6. Preserve food-calc invariants (locks, label, estimatedCalories, components, diningEnvironment scout-only).  
7. Prefer helpers in `src/mealBuild/*` + thin `server.ts` call sites.  
8. If something stays known-broken: note in AI_HANDOVER — else FAIL.

---

## C. Already DONE (do not rebuild)

| Done | Notes |
|------|--------|
| M21 module + consolidate + zombies + stale flag | Keep |
| Happy-path `attachHappyPathMealBuild` on new_log | Keep; extend patterns |
| Dietitian degrade salvage | Keep |
| groups → ComparisonSet | Keep |
| debug dual-read history | Keep |
| JobQueueRunner mealBuild on done | Keep |
| `stageLifecycle.ts` / `coldDebug.ts` / tests **may already be in upload tree** | Wire them; don’t rewrite if present |

---

## D. Implementation (order)

### H1 — Live dietitian projector (CRITICAL anti-bug)

**Files:** `server.ts`, `src/mealBuild/stageLifecycle.ts` (`formatDietitianProjectionBlock`)

After:

```ts
const dietitianProjection = projectDietitianInput(dietitianTempMeal, userProfile);
```

**Must** inject into the dietitian prompt (before LLM call):

```ts
import { formatDietitianProjectionBlock } from './src/mealBuild/stageLifecycle.js';

const precalcBlock = formatDietitianProjectionBlock(dietitianProjection);
addDebugLog('[MealBuild] projector dietitian applied');
// Append to promptText OR systemInstruction:
promptText = `${promptText}\n\n${precalcBlock}`;
// Prefer NOT dumping full databaseMatchesArray into dietitian free text when precalcBlock is present.
```

Gate requires log: **`[MealBuild] projector dietitian applied`**.

### H2 — mealBuild on **edit/modify** + Mode D **stream**

**Edit/modify success** (math fallback `mode === "modify"` and any path returning updated activeMeal):

```ts
addDebugLog('[MealBuild] edit-path');
const { mealBuild, pendingFoodLog } = attachHappyPathMealBuild({
  parsedData: activeMeal /* or modified meal */,
  jobId: req.body.jobId,
  activeMeal: req.body.activeMeal,
  diningEnvironment: activeMeal?.diningEnvironment,
});
// return { ..., data: pendingFoodLog || activeMeal, mealBuild, savable: true,
//   mealBuild: { ...mealBuild, staleDietitianNarrative: true } } // if weight/structure changed without dietitian
```

If weight-only skip-dietitian (D8): set `staleDietitianNarrative: true` on mealBuild.

**Mode D evaluation** — support stream:

```ts
addDebugLog('[MealBuild] mode=D stream'); // when isStream
const payload = { mode: 'evaluation', comparison: comparisonData, comparisonSet, ... };
if (isStream && hasSentHeaders) {
  res.write(`data: ${JSON.stringify({ final: true, result: payload })}\n\n`);
  return res.end();
}
return res.json(payload);
```

### H3 — Stage lifecycle + StageLimits (core anti-loop)

**Files already provided in pack tree:** `src/mealBuild/stageLifecycle.ts`

Export from `src/mealBuild/index.ts`:

```ts
export * from './stageLifecycle';
export * from './coldDebug';
```

**Wire production call sites** (minimum):

1. **Scout complete** (server after vision scout items ready, or client JobQueueRunner on checkpoint):  
   `beginStage` → patch items → `endStage(..., 'success')`  
   Log: `addDebugLog('[MealBuild] stage scout')` or rely on helper + ensure server logs `[MealBuild] stage ` once.

2. **Dietitian start/end:**  
   Before LLM: `const life = beginStage(meal, 'dietitian')`; if `!life.allowed` skip LLM → degrade.  
   On success/fail: `endStage`.  
   On circuit: log `[MealBuild] stage-limits`.

3. **Calculation / happy-path:** `endStage(..., 'calculation', 'success')` inside or after `attachHappyPathMealBuild` (optional refactor).

4. **Degrade path:** already appendHistory; also `endStage(..., 'dietitian', 'degraded')`.

Unique logs required by gate: **`[MealBuild] stage `** or **`[MealBuild] stage-limits`**.

### H4 — Progressive meal on client scout

`JobQueueRunner` already consolidates scout items. Ensure:

```ts
// after consolidateMeal on checkpoint
statusMessage: 'Scout checkpoint saved',
// mealBuild retained (already)
```

Optional: call `beginStage`/`endStage` from dynamic import of stageLifecycle for scout — preferred for history.

### H5 — OCC

Keep `rebaseUserEdit` / `JobStore.rebaseJobMealEdit`.  
On user delete/edit weight: always pass `deletedItemIds` and bump via consolidate.  
No new framework.

### H6 — Cold debug

**File:** `src/mealBuild/coldDebug.ts` (`buildColdDebugPackage`, `coldDebugExpiredMessage`)

**Wire:**

- `serverJobs` when uploading R2 debug (or after persistSucceeded): build package from mealBuild + backendLogs; upload JSON if R2 helper allows; set `mealBuild.coldDebugUrl` / clean_result.debugUrl.  
- If upload fails: non-fatal (existing pattern).  
- UI: if debug open fails / 404, show `coldDebugExpiredMessage()` (TaskPlaceholderCard or debug download path).

Minimum for gate: module exists + expired string + used in debugPayload or card:

```ts
// debugPayload or card
import { coldDebugExpiredMessage } from '../mealBuild/coldDebug';
// when debugUrl fetch fails → show coldDebugExpiredMessage()
```

Or add to `buildDebugMarkdownReport` footer note about 14–30d expiry.

### H7 — Tests

Keep/fix `src/mealBuild/__tests__/m22_completion.test.ts` (pack includes). Must pass vitest.

### H8 — serverJobs

Ensure `clean_result` always forwards:

```ts
mealBuild: finalPayload?.mealBuild,
degradedStages: finalPayload?.degradedStages,
savable: finalPayload?.savable ?? finalPayload?.mealBuild?.savable,
```

On error salvage with pendingFoodLog: still attach mealBuild if present.

---

## E. SELF-CHECK (paste results)

```text
SELF-CHECK
- [ ] Preflight assert-m22 FAILED before code, PASSED after
- [ ] assert-meal-build-m21-1.mjs exit 0
- [ ] assert-meal-build-m22.mjs exit 0
- [ ] [MealBuild] projector dietitian applied in server logs path
- [ ] [MealBuild] edit-path on modify success
- [ ] Mode D stream final includes comparisonSet
- [ ] stageLifecycle called from server or orchestrator
- [ ] [MealBuild] stage  OR [MealBuild] stage-limits logged
- [ ] coldDebug builder exists; expired message available
- [ ] index.ts exports stageLifecycle + coldDebug
- [ ] vitest m22 + m21_1 + mealBuild + food-calc exit 0
- [ ] tsc --noEmit exit 0
- [ ] Did NOT weaken assert scripts
- [ ] food-calc invariants preserved (no math rewrite)
```

---

## F. Master gate

```bash
# Preflight (before coding): expect FAIL
node scripts/assert-meal-build-m22.mjs

# After implementation:
node scripts/assert-meal-build-m21-1.mjs
node scripts/assert-meal-build-m22.mjs

npx vitest run src/mealBuild/__tests__/m22_completion.test.ts
npx vitest run src/mealBuild/__tests__/m21_1_completion.test.ts
npx vitest run src/mealBuild/__tests__/
npx vitest run server_budget_reconcile.test.ts server_vision_scout.test.ts \
  server_nutrient_aggregation.test.ts server_portion_clarify.test.ts

npx tsc --noEmit
```

### GATE LOG (required)

```text
GATE LOG
preflight m22 fail-then-pass: yes/no
assert-m21-1: exit ?
assert-m22:   exit ?
vitest m22:   exit ?
vitest m21_1: exit ?
vitest mealBuild: exit ?
vitest food-calc: exit ?
tsc:          exit ?
```

---

## G. STATUS (Mode matrix)

| ID | Acceptance | A | D | Edit | Evidence | PASS/FAIL |
|----|------------|:-:|:-:|:----:|----------|-----------|
| H1 | Projector applied to prompt | | | | `projector dietitian applied` | |
| H2 | mealBuild all exits + D stream | | | | `edit-path` / mode=D stream | |
| H3 | Stage lifecycle + limits | | | | stageLifecycle call + logs | |
| H4 | Progressive scout meal | | n/a | | JobQueueRunner | |
| H5 | OCC rebase still works | | | | tests + JobStore | |
| H6 | Cold debug + expiry note | | | | coldDebug.ts | |
| H7 | Chaos unit tests | | | | m22_completion | |
| H8 | serverJobs durability | | | | clean_result fields | |

COMPLETE only if all PASS + §F all exit 0.

---

## H. Commit (AI Studio only)

```bash
git add \
  studio/M22_MEAL_BUILD_TRUE_COMPLETE.md \
  scripts/assert-meal-build-m22.mjs \
  src/mealBuild/stageLifecycle.ts \
  src/mealBuild/coldDebug.ts \
  src/mealBuild/index.ts \
  src/mealBuild/__tests__/m22_completion.test.ts \
  server.ts \
  server_meal_orchestrator.ts \
  serverJobs.ts \
  src/jobs/JobQueueRunner.ts \
  src/jobs/JobStore.ts \
  src/components/TaskPlaceholderCard.tsx \
  src/utils/debugPayload.ts \
  plan/MEAL_BUILD_DURABLE_STATE.md \
  studio/ACTIVE_STATUS.md \
  AI_HANDOVER.md

git commit -m "$(cat <<'EOF'
fix(meal-build): M22 true complete — live projectors, stage lifecycle, cold debug, edit path

Apply dietitian input masks to prompts, attach mealBuild on edit, Mode D stream,
stage begin/end with StageLimits circuits, cold forensic package helper, and hard
assert-meal-build-m22 self-check (includes nested M21.1).

EOF
)"

git push origin HEAD
```

Archive M22 pack only after push + GATE LOG green. Update AI_HANDOVER: **Meal Build true complete (M22)**.

---

## I. Out of scope (still later / ops)

| Item | Why deferred |
|------|----------------|
| Cloudflare R2 **bucket lifecycle rule** apply | Infra console; plan already says 14–30d — document confirmation only |
| Full §12 chaos E2E manual suite | Unit chaos-lite in m22; manual soak separate |
| Biomarker progressive build | Separate initiative |
| Removing all free-form dietitian schema fields | High risk; projector block is enough first |

---

## J. Definition of “Meal Build complete” (honest)

**Complete means:**

1. Every successful/degraded food analysis yields a **durable `mealBuild`** (A/D/Edit).  
2. Failures are **local** (stage + recovery), not whole-meal wipe when calc exists.  
3. Agents get **masked context** (dietitian uses preCalc block).  
4. Stages are **bounded** (StageLimits) and **audited** (ledger + history).  
5. Deletes/versions don’t resurrect zombies or lose user edits (tombstones + rebase).  
6. Debug is **focused** (ledger/history hot; cold package forensics).  
7. **Machine gates** M21.1 + M22 exit 0 and stay green.

**Complete does not mean:** zero LLM mistakes, perfect USDA coverage, or Temporal-level workflows.

---

## K. Upload checklist (human)

| Upload | Required |
|--------|----------|
| `studio/M22_MEAL_BUILD_TRUE_COMPLETE.md` | **Yes** |
| `scripts/assert-meal-build-m22.mjs` | **Yes** |
| `src/mealBuild/stageLifecycle.ts` | **Yes** |
| `src/mealBuild/coldDebug.ts` | **Yes** |
| `src/mealBuild/__tests__/m22_completion.test.ts` | **Yes** |
| Paste **§A** into chat | **Yes** |
| Full tree if Studio not on latest origin | Recommended |

Do **not** re-upload full M21 as primary pack.
