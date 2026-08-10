# Active Status

**Handover (WIP):** [`AI_HANDOVER.md`](../AI_HANDOVER.md)  
**Plans:** [`plan/MEAL_BUILD_DURABLE_STATE.md`](../plan/MEAL_BUILD_DURABLE_STATE.md)  
**Process:** [`AGENTS.md`](../AGENTS.md) · [`docs/agent/`](../docs/agent/)

## Active pack (upload this)

| Pack | Role |
|------|------|
| **[M21_1_MEAL_BUILD_COMPLETION_GATES.md](./M21_1_MEAL_BUILD_COMPLETION_GATES.md)** | **Close M21 gaps** with **hard self-check** (`assert-meal-build-m21-1.mjs`) — AI Studio commit/push |

| Prior | Note |
|-------|------|
| M21 | Scaffolding shipped; **incomplete** wiring (audit). Do not re-run full M21. |
| M20 | Governance shipped |

## Master gate (M21.1)

```bash
# Expect FAIL before fixes; PASS after
node scripts/assert-meal-build-m21-1.mjs
npx vitest run src/mealBuild/__tests__/m21_1_completion.test.ts
npx vitest run src/mealBuild/__tests__/
npx vitest run server_budget_reconcile.test.ts server_vision_scout.test.ts server_nutrient_aggregation.test.ts server_portion_clarify.test.ts
npx tsc --noEmit
```

COMPLETE only if all exit **0** and pack STATUS table all PASS.
