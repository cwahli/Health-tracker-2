# AI Handover (WIP board)

**Updated:** 2026-09-04  
**Execute:** `plan/ROADMAP.md` only. There is no `studio/` folder. Root `ROADMAP.md` / `ACTIVE_STATUS.md` are stubs.  
**Laws:** `AGENTS.md` · `docs/agent/` (read is free; named gates only).

## Now

| Track | State | Next |
|-------|--------|------|
| **Live food** | Pass 6 `STALL_NO_FALLBACK`: 90s scout hang failed the job; same-job hop to `gemini-3.1-flash-lite`. | **You:** one Log Meal. Stall/503 should retry on 3.1 without a Retry button. |

### Soto/matcha display bug — actual passes (1-pass dump loop failed)

Intended: one live capture → named vitest → fix. What happened: **each live run was a new class**, so we still burned ~6 confirms.

| Pass | Dump / symptom | Class we then named | Fix |
|---|---|---|---|
| 1 | `…m9wm9cs9a` stuck running, dietitian 503 | `DEGRADE_NOT_TERMINAL` | SSE `res.json` → `{final,result}` (medical already had this) |
| 2 | `…8tj525gki` looks done, felt “queued 2 min” | misread session MAX=20 | Not a queue. Gemini + submit lied `queued` |
| 3 | same | `QUEUE_LIE` | submit/client write `running`; don’t clobber running→queued |
| 4 | `…f1ficeqqb` debug done, UI Attempt 1/3 for 4 min | `DISPLAY_LAG` (runner never polled) | `getQueue` includes running-without-meal; don’t treat empty prior as stale edit |
| 5 | `…g72emkjh7` debug done ~16:58:08, card ~16:59:25; AnalyzeFinished ×4 | persist blocked status; two runner loops | `publishResultReady` immediately; `inFlightIds` + loop generation; skip AnalyzeFinished if meal already on the job |
| 6 | `…c115aabvo` ~4 min, Retry ×2. Scout 90s hang → **failed**; user retried; dietitian 503 then ok. Not persist lag. | `STALL_NO_FALLBACK` | **this:** stall/503/quota hops to `gemini-3.1-flash-lite` on the same job. Do not fail and ask the user to switch models. |

Lesson: dump oracles must include **DISPLAY_LAG**, **COMPLETE_ONCE**, and **STALL_NO_FALLBACK** (90s stall + failed/Retry and no “falling back to 3.1”). Each live run has been a new class. Inner loop should catch this dump without another meal; live confirm is still one Log Meal.
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
