# AI Handover (WIP board)

**Updated:** 2026-09-02  
**Execute:** `plan/ROADMAP.md` only. There is no `studio/` folder. Root `ROADMAP.md` / `ACTIVE_STATUS.md` are stubs.  
**Laws:** `AGENTS.md` · `docs/agent/` (read is free; named gates only).

## Now

| Track | State | Next |
|-------|--------|------|
| **F-10** Meal Agent | F-10.2 verified (`calculateDerivedNutrients` + Atwater law). F-10.1–F-10.5 & F-10.7 shipped. | F-10.6 (Grok constants) / F-10.8 Soak (Grok reviews). |
| **F-9.5** | PR1–PR4 bulk shipped. App poller still `updateJob`. | Grok only. |
| **Q-7** | Policy in QUALITY.md §1.4. | Fold `golden_g1` later. Do not `npm test`. |
| **Track B** | B0 Apply smoke, Modal wiring, and C1–C7 unified pipeline cutover COMPLETE. B7.4–B7.6 verified. | G-B1 green or next open Track B. |
| **F-1/F-2 USDA** | Parked. | Do not reopen. |
| **Track L** Localisation | L-1–L-5 + all residual EN/ID shipped (narratives, diagnostics, alerts, admin chrome). EN/ID parity green, pushed. | Track L complete for EN/ID. |
| **Agent Consolidation** | Front Desk (UC-01–UC-10, Hub-and-Spoke multi-turn follow-ups) + Unified Biomarker Agent (C1–C7 single-dispatch pipeline cutover to `/api/gemini/medical-analyze`) COMPLETE & verified (C1–C7 baseline PASS, M31 lifecycle PASS, tsc clean). | Shipped. |

**Do not:** USDA · critic LLM · LLM `calories` on create schema · `npm test` as COMPLETE · ask to approve **reads** · edit files when the user asked a question · recreate `studio/`.

## F-10 facts (do not rediscover)

- Prototype: `prototype/meallog/meal/`. 1-agent ≥ always-two on most of 11 cases.
- Agent estimates P/C/totalFat/sat/fibre/Na. TS derives kcal, unsaturated, salt.
- TS expand gate (dish/image/receipt/barcode).
- Same pattern as biomarkers: one Review for n=1–5.

## Shipped (do not redo)

F-8.1–8.9 · F-9.1–9.4 · F-10.1 · M30 curator · Q-1/2/3 · M23–M28 free-tier core.
F-10.2
