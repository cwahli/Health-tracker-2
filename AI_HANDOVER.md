# AI Handover (WIP board)

**Updated:** 2026-09-05  
**Execute:** `plan/ROADMAP.md` only. There is no `studio/` folder. Root `ROADMAP.md` / `ACTIVE_STATUS.md` are stubs.  
**Laws:** `AGENTS.md` · `docs/agent/` (read is free; named gates only).

## Now

| Track | State | Next |
|-------|--------|------|
| **Live food** | Process boards green (Q-8.1–8.5). | **Q-8.6:** one website Log Meal — `scripts/soak-q8-tier3.md`. If dump class already a row, inner failed. |
| **Q-8** Process goldens | **Shipped 8.1–8.5.** Boards: `tests/foodProcess.golden.test.ts`, `tests/bioProcess.golden.test.ts`, `tests/deskProcess.golden.test.ts`. Q-8.3 Playwright stub in tree. | Outer confirm Q-8.6. Historical Soto capture stays red. |

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
| **Track S / Q-5** | Q-5 7 one-shots deleted; S-1 chrome keys + leftover list, S-2 coach builder, S-6 UC-02 acks green (tsc clean, 2026-09-04). F-8.12 printed/brand vitamin-C locks green (77/77 + budgets). F-6 held net-zero this batch (FoodCard/LogChat prod deltas net 0; trim to ~3800 deferred). F-8.10 shard 1 green: loosenQuery/cleanQuery/chain-detect → helpers module, run file 3429→3340 (helpers test + test:food 88/88 + budgets). Shard 2 green: label-gate + component enrichment + past-meals ctx → helpers, run file 3340→3213 (helpers 7/7 + test:food 88/88 + budgets, uncommitted). Shard 3 green: 7 prompt-ctx builders + schema + stitcher → 2 modules, run file 3213→2935 (prompt-ctx 10/10 + test:food 88/88 + budgets, uncommitted; tsc caught 2 const/reassign misses, fixed). Shard 4 green: JSON repair + dietitian skip gates → dispatch module, run file 2935→2892 (dispatch 5/5 + food shards 28/28 + test:food 88/88 + budgets, uncommitted). Shard 5 green: mode routing + apiCalls → routing module, run file 2892→2882 (shards 34/34 + test:food 88/88 + budgets; tsc caught catch-scope apiCalls + null-scout demotion, fixed; uncommitted). Shard 6 green: fallback breakdown + meal header → assemble module, run file 2882→2784 (shards 39/39 + test:food 88/88 + budgets, uncommitted). Shard 7 green: edit-path seams (backfill/title/history/chips/gate) → assemble module, run file 2784→2660 (shards 43/43 + test:food 88/88 + budgets; tsc caught 2 strict param types, loosened; uncommitted). Shard 8 green: composition + image urls + final scout merge + shared new_log gate → assemble module, run file 2660→2523 (shards 47/47 + test:food 88/88 + budgets, uncommitted). Shard 9 green: scout schema + sourcing (inherit/compare/prior) → schema + source modules, run file 2523→2384 (shards 52/52 + test:food 88/88 + budgets, uncommitted). Shard 10 green: bracket/tags/chain/text-query prep → source module, run file 2384→2288 (shards 55/55 + test:food 88/88 + budgets, uncommitted). Shard 11 green: failure classify + result apply + meal merge + item logs → source module, run file 2288→2211 (shards 59/59 + test:food 88/88 + budgets, uncommitted). Shard 12 green: portion pause/carry + brand lock + FDC hints + ledger map + modifiers → precalc module, run file 2211→2094 (shards 65/65 + test:food 88/88 + budgets, uncommitted). Shard 13 green: image payloads + weight-refine triad → session module, run file 2094→2060 (shards 69/69 + test:food 88/88 + budgets, uncommitted). Shard 14 green: full DB-search stage (fan-out/shaping/gaps/curator/fallbacks) with DI → db_search module, run file 2060→1603 (shards 72/72 + test:food 88/88 + budgets; stub gate caught 2 test-expectation errors; uncommitted). Shard 15 green: instruction router + verdict/advice ladders → prompt/dispatch modules, run file 1603→1548 (shards 75/75 + test:food 88/88 + budgets; uncommitted). Shard 16 green: weight-mod shortcut + turn-1 restore + retry delay → source module, run file 1548→1535 (shards 78/78 + test:food 88/88 + budgets; uncommitted). Shard 17 green: skipScout shortcut + dietitian call args → source/dispatch modules, run file 1535→1508 (shards 81/81 + test:food 88/88 + budgets, uncommitted). Shard 18 green: pure-scale response + totals + retry delay + post-dietitian norm → dispatch/routing modules, run file 1508→1470 (shards 86/86 + test:food 88/88 + budgets, uncommitted). | S-4 needs frozen Meal-06/10 (suspect: mergeScoutItems drops unmatched llmItems); F-8.10 later shards: DB-search block, prompt assembly, mode branches. |
| **F-10** Meal Agent | F-10.1–F-10.7 shipped. F-10.6: TS fat/Na critic in `finalizeDishLedger` via `decidePrepAddition`. Inner F-10.8 names restaurant fat residual on prototype cases 1/4/9. | Outer soak = Q-8.6 one Log Meal. |
| **F-9.5** | **Shipped.** App poller + LogChat submit use `JobStore.apply`. `inFlightTurnAt` flags remain as fallback. | Do not mix a Q-9 App.tsx rewrite with this. |
| **Q-7** | Policy in QUALITY.md §1.4. | Fold `golden_g1` later. Do not `npm test`. |
| **Q-9 / Q-10** | Later steps only. Website file/patch consolidation; then dependency audit. | Q-8.2 is green so unblocked, but still later — not a rewrite binge. Serialize vs R-9 `App.tsx`. |
| **Track B** | B0 Apply smoke, Modal wiring, and C1–C7 unified pipeline cutover COMPLETE. B7.4–B7.6 verified. | G-B1 green or next open Track B. |
| **F-1/F-2 USDA** | Parked. | Do not reopen. |
| **Review 2026-09-05** | USDA + curator VERIFIED LIVE (db_search hot path, gaps curator, M30 green) — do NOT remove. `pg` kept (dynamic import in schema-reload). Removed `@toon-format/toon` (zero refs), 12 root one-shots/placeholders, dead curator import in server.ts. Fixed corrupt chat index → welcome reset (was stale view). F-4: alias hit_count now increments on hits + gate; live baseline 412 rows / 0 hits. Q-7 executable parts green (G1 6/6, fixture refs relative); ghost-doc cites need human per AGENTS §3. Playwright browsers present (~/Library/Caches); dialog-inventory 3/3 green warm (one cold-start flake, no code change). | Roadmap remainder needs live/human/Grok (below). |
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
