# plan/

**Role:** Architecture and planned design (durable).  
**Not** day-to-day WIP — that lives in root **`AI_HANDOVER.md`**.  
**Not** agent process laws — those live in **`AGENTS.md`** + **`docs/agent/`**.

## Freshness note (2026-08-09)

| Doc | Freshness |
|-----|-----------|
| Architecture plans (modal, food-calc hybrid, R2 hybrid, bug tracking) | Still useful as **design intent** — re-audit code before rebuilding DONE work |
| `STATUS_CONSOLIDATED_2026-08.md` | Snapshot dated **2026-08-08** — GitHub vs Desktop bullets may be wrong after later commits; verify with `git fetch` + tree |
| `REMAINING_ROADMAP_2026-08.md` | Same — use as checklist, not blind truth |
| Live status | Prefer **`AI_HANDOVER.md`** |

Agents must not rewrite plans mid-feature without human confirmation when the change is architectural. Prefer logging progress on the handover board.

| Doc | Topic |
|-----|--------|
| [FOOD_LOG_UX_CALC_BACKLOG.md](./FOOD_LOG_UX_CALC_BACKLOG.md) | Food UX/calc backlog (label truth, portion, sync, brand…) |
| [UNIFIED_MODAL_ASYNC_JOB_PLAN.md](./UNIFIED_MODAL_ASYNC_JOB_PLAN.md) | Unified modal + async multi-job |
| [FOOD_CALC_HYBRID_AND_INTERNAL_DB_PLAN.md](./FOOD_CALC_HYBRID_AND_INTERNAL_DB_PLAN.md) | Food calc hybrid / catalog |
| [HYBRID_SUPABASE_CLOUDFLARE_R2.md](./HYBRID_SUPABASE_CLOUDFLARE_R2.md) | Storage hybrid |
| [STATUS_CONSOLIDATED_2026-08.md](./STATUS_CONSOLIDATED_2026-08.md) | DONE/TODO snapshot (verify before use) |
| [BUG_TRACKING_COMPREHENSIVE_PLAN.md](./BUG_TRACKING_COMPREHENSIVE_PLAN.md) | Bug tracking architecture |
| [BUG_SNAPSHOT_TRIAGE_PLAN.md](./BUG_SNAPSHOT_TRIAGE_PLAN.md) | Snapshot/R2/triage detail |
| [REMAINING_ROADMAP_2026-08.md](./REMAINING_ROADMAP_2026-08.md) | Remaining map (verify) |
| [ADMIN_FIREBASE_USERS_ROADMAP.md](./ADMIN_FIREBASE_USERS_ROADMAP.md) | Admin users |

Studio packs: `studio/` · Process: `AGENTS.md` · Domains: `docs/agent/domains/`.
