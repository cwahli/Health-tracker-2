# Roadmap — start here

**This is the only execute file.** Four architecture files sit beside it. Do not add a sixth plan.

| File | What it is |
|---|---|
| **This file** | What to do, in order, across all pillars |
| [BIOMARKER_LIFECYCLE.md](./BIOMARKER_LIFECYCLE.md) | Pillar 1 architecture (product model + ingest router) |
| [FOOD.md](./FOOD.md) | Pillar 2 — pipeline + meal document (not a lifecycle) |
| [RELIABILITY.md](./RELIABILITY.md) | Pillar 3 — infra / quotas |
| [QUALITY.md](./QUALITY.md) | Pillar 4 — how we test (class-first) |

Laws: `docs/agent/domains/{biomarkers,food-calc,sync}.md`  
WIP: `AI_HANDOVER.md` · Studio: `studio/` · Completed/abandoned: `archive/`

```text
                    ┌─────────────────────┐
                    │  4. Quality loop     │
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
   1. Biomarkers         2. Food              3. Sync
```

**Standing rules (every task)**

1. Work item = **one class**, not a job id or “make EMIS all-green.”  
2. Inner loop = **vitest, no Gemini.** Outer = one frozen example.  
3. Allowed files only (`QUALITY.md` playbooks).  
4. Two burned hypotheses → STOP.  
5. Honest residual (pending / unmatched / flagged / MISS) is success.  
6. Local agents do not `git push`. IMPACT before coding.

---

## Which track now

| If you are… | Do |
|---|---|
| **Default this week** | **Track B** Wave 0 (live Apply smoke), then B1 |
| Food goldens still red | **Track F** one class (`FALSE_FRIEND` first) |
| Quota / egress spike | **Track R** R-1 measure, then only the matching R-id |
| Adding a golden | `QUALITY.md` then one example |

Do **not** start Track B Wave 7, Track R D1, or a new agent rewrite to “help” another track.

---

# Track B — Biomarkers (active)

**Architecture:** `BIOMARKER_LIFECYCLE.md`  
**Test method:** `QUALITY.md`  
**Laws:** `docs/agent/domains/biomarkers.md`  
**Gate always:** `node scripts/assert-biomarker-lifecycle-m31.mjs`

```text
B0  live Apply smoke                         (human)
B1  ingestTrace + G-B1 pin            I0
B2  prompt hygiene + lexer            I1–I2   (no Home writes)
B3  identity + unit family            I3      (G-B4 must pass)
B4  NHS aliases + leftover Parser     I4–I5
B5  flagged Review + staged apply     I6–I7
B6  remaining classes + inbox         I8–I9   ← ingest v1
B7  lifecycle leftovers               §13     (after B6)
```

**Do not** start B7 Calibrator/Pending-store to make B4 look done.  
**Do not** add NHS aliases (B4) if G-B4 false-friend is red.

### B0 — Prove landed apply (do first)

| # | Task | Done when |
|---|---|---|
| 0.1 | Reopen `job_medical_1786666223594` | Five convert rows on the card, not only the essay: HDL 50→**1.293**, TG 125→**1.411**, LDL 130→**3.362**, creat 0.9→**79.56**, bili 0.8→**13.68** |
| 0.2 | Click Apply | History + Home updated; `observationMeta` raw kept; banner drops those keys |
| 0.3 | Older SI rows | HDL 1.43, creat 100/72, bili 16/13 untouched |
| 0.4 | Forbidden UI gone | No Home Auto-Fix / Inspect / Review in Medical History; no Dictionary Auto-Calibrate / Quick Approve |
| 0.5 | If Apply misses | Fix hydrate / `enrichReviewModificationCommands` only — class `APPLY_MISS` |

Do not start B1 until 0.1 is true **or** 0.5 has a failing `APPLY_MISS` test.

### B1 — Debug spine (I0)

| # | Task | Class |
|---|---|---|
| 1.1 | `ClassId` + `IngestTrace` types | — |
| 1.2 | Attach passthrough trace on medical jobs | — |
| 1.3 | Scaffold `tests/Golden_biomarker/` | `SILENT_REWRITE` |
| 1.4 | Wire G-B1 to existing convert locks (do not copy numbers) | `APPLY_MISS` |
| 1.5 | `scripts/assert-biomarker-ingest.mjs` N1–N3 | — |
| 1.6 | Inbox **Food \| Biomarkers** stub | — |

**Gate:** M31 0; G-B1 green; job debug has `ingestTrace.version === 1`.

### B2 — Cheaper Parser, no new writes (I1–I2)

| # | Task | Class |
|---|---|---|
| 2.1 | One raw injection; no double `Chat History:` | hygiene |
| 2.2 | Drop `updated_at` from extract schema | — |
| 2.3 | Server `lastProcessedIndex` (no `remainingText` echo) | — |
| 2.4 | Packs `lab_extract` vs `symptom_diary` | `WRONG_DOOR` |
| 2.6–2.10 | RFC 4180 lexer; UK `109/L`; panel skip; all rows **unmatched**; G-B3 shifted columns | `CONFORMANCE_SHAPE` |

**Stop if:** lexer writes observations.

### B3 — Identity + unit family (I3) — first dangerous wave

| # | Task | Class |
|---|---|---|
| 3.1 | Extend `getMappedBiomarkerKey` only (apply + ingest share it) | `IDENTITY_PARALLEL_KEY` |
| 3.2 | Specimen guard | `IDENTITY_FALSE_FRIEND` |
| 3.3 | Unit-family via `convertViaTable` existence — no new multiply | `CONFORMANCE_UNIT` |
| 3.5 | G-B4 urine vs serum | `IDENTITY_FALSE_FRIEND` |

**Stop if:** G-B4 fails. Do not ship apply. Do not add aliases to hide it.

### B4 — Aliases + leftover Parser (I4–I5)

| # | Task | Class |
|---|---|---|
| 4.1 | NHS print-name aliases | identity examples |
| 4.3 | G-B2 expected as **class counts**, not % matched | — |
| 4.5 | Parser sees `unmatched[]` only | `HALLUCINATED_KEY` |
| 4.6 | Abort table path → 0 high-confidence | `CONFORMANCE_SHAPE` |
| 4.9 | G-B5 food-in-medical reject | `WRONG_DOOR` |

**Stop if:** Parser maps a high-confidence row.

### B5 — Review + staged apply (I6–I7)

| # | Task | Class |
|---|---|---|
| 5.1–5.4 | Flagged → Review via existing enrich/convert; G-B1 stays exact | `CONFORMANCE_UNIT` |
| 5.5–5.11 | Staged confirm; `sourceReportId` upsert; pending not Home; G-B8 re-paste | `UPSERT_IDENTITY`, `USE_SURFACE_LEAK` |

Weight/height stay `droppedByApply` until product decision.

### B6 — Inbox + remaining classes (I8–I9)

G-B6 symptom, G-B7 incomplete, G-B9 vision N/A, `golden-from-medical-debug.mjs`, inbox by class.  
**Ingest v1 ships here.**

### B7 — Lifecycle leftovers (after B6)

From `BIOMARKER_LIFECYCLE.md` Part A §13:

| # | Task | Class |
|---|---|---|
| 7.1 | Profile junk: alias slugs, `metric_N`, stale pending, `< 0` ranges | `IDENTITY_PARALLEL_KEY` |
| 7.2 | Relabel XOR convert UI | `SILENT_REWRITE` |
| 7.3 | Historical `observationMeta` backfill | `CONFORMANCE_UNIT` |
| 7.4 | Real Pending store | `COMPLETENESS` |
| 7.5 | Silent Calibrator + overlay fingerprint | `CURRENCY` |
| 7.6 | Name Deduper leftovers | `IDENTITY_PARALLEL_KEY` |
| 7.7 | Kill `normalizeHistoricalTelemetryErrors` writers | `SILENT_REWRITE` |
| 7.8 | Drop `biomarker_dictionary_store` | — |

7.1 may run in parallel with B2 (data only).

### Track B PRs

1. `biomarker: ingestTrace + G-B1 pin`  
2. `biomarker: extract prompt hygiene`  
3. `biomarker: table lexer unmatched-only`  
4. `biomarker: shared identity + unit-family`  
5. `biomarker: NHS aliases + leftover Parser`  
6. `biomarker: flagged Review + staged apply`  
7. `biomarker: class inbox + capture`  
8+. one PR per 7.x  

### Track B done

**Ingest v1 (end B6):** class tests exist; G-B1 green; G-B2 green as class counts; no high-confidence names in Parser prompt; no `remainingText`; batch confirm; M31 0.  
**Lifecycle done (end B7):** live Apply verified; unknown names never catalog keys; historical units; relabel cannot rewrite numbers; Home/coach never consume pending/flagged.

Locked converts never change: `1.293` / `1.411` / `3.362` / `79.56` / `13.68`.

**Out of Track B:** food pipeline, rename agent ids, delete instruction packs, fuzzy auto-approve, `approve_all`, vision required, new health-planning agents until B0 + `USE_SURFACE_LEAK` are green.

---

# Track F — Food identity quality

**Architecture:** `FOOD.md` (do **not** rebuild curator — M30 assert is green)  
**Method:** `QUALITY.md` + food classes `FALSE_FRIEND` / `DISH_DROP` / `OPENING_WRONG` / `SILENT_REPAIR`  
**Laws:** `docs/agent/domains/food-calc.md`

| ID | Item | Do not |
|---|---|---|
| F-1 | Self-heal KPI: same query still needs curator / live USDA | Rebuild curator |
| F-2 | Live USDA still on Analyze gaps; catalog-first not default | Ban USDA for research |
| F-3 | Golden meals red (picnic, lassi, ham…) | `POST /loop` until all-green |
| F-4 | Alias hit rate / duplicate active rows | Silent merge without gate |

F-5 TypeError `.calories` is **done**.  
Execute **one class** per session. Inner = vitest (`server_fdc_resolve` / scout merge). Outer = one golden example.

---

# Track R — Reliability (core done)

**Architecture:** `RELIABILITY.md`  
**Laws:** `docs/agent/domains/sync.md`  
**Core:** M23–M28 `assert-free-tier-complete.mjs` **PASS**. Do not re-migrate images or re-kill chat Firestore writes.

Start only if the trigger is true:

| ID | Item | Trigger |
|---|---|---|
| R-1 | Re-measure Firestore writes / Supabase egress | Quota or bill spike |
| R-2 | Cloudflare Pages for `dist/` | Static latency actually hurts |
| R-3 | Playwright E2E | After soak; not instead of class goldens |
| R-4 | Extract `server.ts` routes | Already touching the monolith |
| R-5 | D1 as primary SQL | **After** R-1 still fails free tier |
| R-6 | Job recovery soak | Interrupted jobs still orphan |

R-7 knip / `getBiomarkerStatus` memo as a reliability gate is **abandoned**.

---

# Track Q — Quality loop (how every track tests)

**Architecture:** `QUALITY.md`

| Rule | Meaning |
|---|---|
| Work item = class | Not job id |
| Inner = vitest | No Gemini |
| Outer = one example | After class green |
| Honest residual | pending / unmatched / MISS |
| Firewall | Class names which files may change |

Inbox: Food \| Biomarkers, grouped by class.  
Medical capture: `golden-from-medical-debug.mjs` (never food’s `golden-from-debug.mjs`).  
Session replay: **abandoned**.

Q work is usually **inside** B1/B6 or F-3, not a separate calendar.

---

## Always-run gates

```bash
npx tsc --noEmit
# Track B
node scripts/assert-biomarker-lifecycle-m31.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts
# Track F (when touching resolver)
node scripts/assert-food-curator-m30.mjs
# Track R (when touching sync)
node scripts/assert-free-tier-complete.mjs
npx vitest run src/utils/syncUtils.regression.test.ts
```
