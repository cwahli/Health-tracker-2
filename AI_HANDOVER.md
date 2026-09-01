# AI Handover (WIP board)

**Updated:** 2026-09-01  
**Execute:** `plan/ROADMAP.md` only. There is no `studio/` folder. Root `ROADMAP.md` / `ACTIVE_STATUS.md` are stubs.  
**Laws:** `AGENTS.md` · `docs/agent/` (read is free; named gates only).

## Now

| Track | State | Next |
|-------|--------|------|
| **F-10** Meal Agent | F-10.2 finished. F-10.1–F-10.5 & F-10.7 shipped. | F-10.6 (Grok constants) / F-10.8 Soak (Grok reviews). |
| **F-9.5** | PR1–PR4 bulk shipped. App poller still `updateJob`. | Grok only. |
| **Q-7** | Policy in QUALITY.md §1.4. | Fold `golden_g1` later. Do not `npm test`. |
| **Track B** | Ingest code in tree; v1 not shipped. | B0 Apply smoke. Fill-template C1–C7 before modal wiring. |
| **F-1/F-2 USDA** | Parked. | Do not reopen. |

**Do not:** USDA · critic LLM · LLM `calories` on create schema · `npm test` as COMPLETE · ask to approve **reads** · edit files when the user asked a question · recreate `studio/`.

## F-10 facts (do not rediscover)

- Prototype: `prototype/meallog/meal/`. 1-agent ≥ always-two on most of 11 cases.
- Agent estimates P/C/totalFat/sat/fibre/Na. TS derives kcal, unsaturated, salt.
- TS expand gate (dish/image/receipt/barcode).
- Same pattern as biomarkers: one Review for n=1–5.

## Shipped (do not redo)

F-8.1–8.9 · F-9.1–9.4 · F-10.1 · M30 curator · Q-1/2/3 · M23–M28 free-tier core.
