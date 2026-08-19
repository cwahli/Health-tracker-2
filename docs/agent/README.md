# Agent docs index

**Always-on:** root `AGENTS.md` (laws + load map only).  
**Load on demand** from the table in `AGENTS.md` §1.

| File | When to read |
|------|----------------|
| [PACKS.md](./PACKS.md) | Authoring / shipping AI Studio packs |
| [TEMPLATES.md](./TEMPLATES.md) | IMPACT, SELF-CHECK, GATE LOG paste format |
| [DOMAIN_REGRESSION_MAP.md](./DOMAIN_REGRESSION_MAP.md) | Which tests/gates after a change |
| [domains/food-calc.md](./domains/food-calc.md) | Nutrition pipeline, modes A/D/Edit |
| [domains/biomarkers.md](./domains/biomarkers.md) | Catalog / pending / overlay / logs; named agents; write map |
| [plan/BIOMARKER_LIFECYCLE_PLAN.md](../../plan/BIOMARKER_LIFECYCLE_PLAN.md) | Biomarker architecture (slices 0–4) |
| [domains/sync.md](./domains/sync.md) | Firebase / Supabase / R2 multi-device |

## Document roles

| Location | Role |
|----------|------|
| `AI_HANDOVER.md` | WIP, status, multi-agent handoff (update freely) |
| `plan/` | Architecture & planned design (durable) |
| `AGENTS.md` + this tree | Process + domain guides (**protected** — confirmation + before→after) |

Rulebooks **guide** evolution; they do not ban it. Changing an invariant requires tests + rulebook update together.

**Commits/pushes to GitHub:** allowed after COMPLETE (`tsc` + named gates). AI Studio remains a valid ship path.

## Design goals

1. **Short always-on** — avoid context dilution and token waste.  
2. **Domain rulebooks** — food-calc, biomarkers, sync stay aligned as code grows.  
3. **Executable gates** — prose without tests will not stop cascades.  
4. **Regression suites (2026-08-09):**  
   - Sync: `src/utils/syncUtils.regression.test.ts`  
   - Biomarker identity: `src/utils/biomarkerIdentity.test.ts`  
   - Food merge/budget: extended vision/budget/portion/aggregation tests  
   See `DOMAIN_REGRESSION_MAP.md` smoke commands.
