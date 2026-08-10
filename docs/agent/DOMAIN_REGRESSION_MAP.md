# Domain regression map

**Rule:** After changing files in a row, run that row’s commands. Exit 0 required for COMPLETE.  
**Do not** only run 1 happy-path test the agent invented unless the map has no entry (then add a test).

Prefer **named** suites. Expand later when full audits land.

---

## How to use

1. Diff the files you touched.  
2. Match the **most specific** row(s) below.  
3. Run **union** of matching commands.  
4. Paste results into GATE LOG (`TEMPLATES.md`).

If you touch a hot path and **no** row fits: add a unit/fixture test in the same task, then run it.

---

## Food-calc / meal pipeline

| If you touch… | Run |
|---------------|-----|
| `server_budget_reconcile.ts` / budget / reconcile | `npx vitest run server_budget_reconcile.test.ts` · `node scripts/assert-budget-reconcile.mjs` |
| `server_vision_scout.ts` / mergeScoutItems | `npx vitest run server_vision_scout.test.ts` (must include soft kcal + components preserve cases) |
| Label truth / locks / hard-lock | `node scripts/assert-label-truth-locks.mjs` · `node scripts/assert-false-hard-lock.mjs` |
| Receipt / dup rows | `node scripts/assert-receipt-dup-rows.mjs` |
| Food catalog / DB / resolver | `npx vitest run server_food_catalog.test.ts server_food_db.test.ts server_food_resolver.test.ts` |
| Nutrient aggregation / basis / prep | `npx vitest run server_nutrient_aggregation.test.ts server_nutrient_basis.test.ts server_prep_policy.test.ts` |
| Portion clarify / refine / weight | `npx vitest run server_portion_clarify.test.ts` · `node scripts/assert-backlog-b1-portion-clarify.mjs` |
| Food log identity / history | `node scripts/assert-food-log-identity.mjs` · `npx vitest run src/utils/foodLogDedupe.test.ts` |
| Broad food-calc pack | `node scripts/assert-food-calc-exact.mjs` and/or `assert-food-calc-final.mjs` |
| Mode A / D / Edit executor / modal jobs | `npx vitest run src/jobs/__tests__/ModeDAndEdit.test.ts FoodAgentExecutor.test.ts` · `node scripts/assert-unified-modal-*.mjs` as relevant |
| `server.ts` food finalize paths | At minimum: budget + vision merge + aggregation + one mode assert |

**Invariant reminder:** Mode A PASS ≠ Mode D/Edit PASS. See `domains/food-calc.md`.

**Food-calc smoke (any food math PR):**

```bash
npx vitest run server_budget_reconcile.test.ts server_vision_scout.test.ts server_nutrient_aggregation.test.ts server_portion_clarify.test.ts
```

---

## Biomarkers

| If you touch… | Run |
|---------------|-----|
| Biomarker flow / review / apply | `node scripts/assert-biomarker-flow.mjs` |
| Key identity / aliases / merged def / approval | `npx vitest run src/utils/biomarkerIdentity.test.ts` |
| Sanitize / data clean | `npx vitest run src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts` |
| Dictionary / combine / tombstones on profile | Identity + sync regression suites; see `domains/biomarkers.md` write map |
| Agent registry (`agentConfig`, medical agents) | `assert-biomarker-flow.mjs` if review path touched; write map in domain doc |
| Medical executor / history filter | Prefer `filterLogsByTombstone` / `deletedBiomarkerLogIds` semantics |

**Biomarker smoke:**

```bash
npx vitest run src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts
node scripts/assert-biomarker-flow.mjs
```

**Still TODO:** pure extract of agent1/data_review apply + goldens; front_desk same-day merge.

---

## Sync / multi-device / storage

| If you touch… | Run |
|---------------|-----|
| `syncUtils.ts` / merge / tombstones / profiles | `npx vitest run src/utils/syncUtils.regression.test.ts` |
| `SyncService.ts` / firestore sanitize / storage keys | `npx vitest run src/utils/firestoreUtils.test.ts src/utils/storageUtils.test.ts` |
| Food log dedupe | `npx vitest run src/utils/foodLogDedupe.test.ts` |
| Image sync / R2 / backlog B11 | `node scripts/assert-backlog-b11-image-sync.mjs` · `assert-b11d-b13-b8c.mjs` if relevant |
| Jobs / Supabase job sync | `npx vitest run src/jobs/__tests__/JobStore.test.ts` · `node scripts/assert-server-async-jobs.mjs` / unified-modal job asserts |
| Login / identity | `node scripts/assert-login-identity-delta.mjs` |

**Sync smoke:**

```bash
npx vitest run src/utils/syncUtils.regression.test.ts src/utils/foodLogDedupe.test.ts src/utils/firestoreUtils.test.ts
```

Treat silent changes to tombstone / merge semantics as **class X**.

---

## Agent process / governance

| If you touch… | Run |
|---------------|-----|
| `AGENTS.md` / `docs/agent/**` (only with confirmation) | `node scripts/assert-agent-governance.mjs` |
| Sync/biomarker/food regression foundation files | Same smoke suites as domain sections above |

## Bugs / triage tooling

| If you touch… | Run |
|---------------|-----|
| Bug snapshot / domain packs | `node scripts/assert-bug-snapshot-triage.mjs` · `node scripts/assert-bug-domain-packs.mjs` · related vitest under `src/utils/bug*.test.ts` |

---

## Always when TypeScript sources change

```bash
npx tsc --noEmit
```

Skip only for pure markdown/docs edits (state reason in GATE LOG).

---

## Adding a new map row

When you stabilize a domain with new tests, **add a row here in the same PR**.  
Gate growth is how rulebooks stay real; prose alone is not enough.
