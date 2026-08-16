# Biomarker implementation roadmap

**Pillar:** 1 — Biomarkers. Map: `plan/README.md`. **This is the execute file.**

**Status:** Ready to execute. 2026-08-16.  
**Architecture:** `plan/BIOMARKER_LIFECYCLE_PLAN.md`  
**Ingest / handoff:** `plan/BIOMARKER_INGEST_ROUTER_PLAN.md`  
**How we test (class-first):** `plan/BIOMARKER_INGEST_AND_GOLDENS_PLAN.md`  
**Laws:** `docs/agent/domains/biomarkers.md`  
**Landed gates:** `studio/M31_BIOMARKER_LIFECYCLE_REMAINING_MULTIPASS.md`  
**WIP board:** `AI_HANDOVER.md`

This file is the **order of work**. It does not replace the three plans. If a slice fights a class law, stop and fix the class — do not paint G-B2 green.

```text
Wave 0  live smoke + freeze locks          (human + tiny code)
Wave 1  debug spine + class scaffold       I0
Wave 2  cheaper Parser, no new writes      I1–I2
Wave 3  identity + unit family (dangerous) I3
Wave 4  aliases + leftover-only Parser     I4–I5
Wave 5  flagged Review + staged apply      I6–I7
Wave 6  remaining classes + inbox          I8–I9
Wave 7  lifecycle leftovers (not ingest)   §13.2–13.3
```

Waves 0–6 are the ingest + golden track. Wave 7 is remaining product hygiene. Do **not** start Wave 7 Calibrator/Pending-store work to “help” ingest.

---

## Standing rules (every wave)

1. **Work item = one class** (or one I-slice that names its class). Not “the EMIS file.”  
2. **Inner loop = vitest, no Gemini.** Outer = one frozen example.  
3. **Allowed files only** (playbook firewall in the build plan §5).  
4. **M31 must stay exit 0** after every wave that touches apply/convert/Home/Dictionary.  
5. Locked converts never change: `1.293` / `1.411` / `3.362` / `79.56` / `13.68`.  
6. IMPACT pasted before coding (`docs/agent/TEMPLATES.md`).  
7. Same change: tests + assert row + rulebook write map if a writer moved.  
8. Local agents do not `git push`. No Auto-Fix / Auto-Calibrate restored.  
9. Two burned hypotheses → STOP, human.  
10. Honest residual (pending / unmatched / flagged) is success.

**Always run at wave end:**

```bash
npx tsc --noEmit
node scripts/assert-biomarker-lifecycle-m31.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts
```

Plus that wave’s new tests / `assert-biomarker-ingest.mjs` once I0 created it.

---

## Wave 0 — Prove landed work (do this first)

**Why:** Ingest Review (I6) reuses apply. If live Apply is still essay-only, later waves lie.

| # | Task | Owner | Done when |
|---|---|---|---|
| 0.1 | Reopen Review job `job_medical_1786666223594` (refresh). Apply card shows **five** convert rows, not only the essay | Human | HDL 50→1.293, TG 125→1.411, LDL 130→3.362, creat 0.9→79.56, bili 0.8→13.68 |
| 0.2 | Click Apply | Human | History + Home show converts; `observationMeta` raw kept; telemetry banner drops those five keys |
| 0.3 | Check older SI rows | Human | HDL 1.43, creat 100/72, bili 16/13 untouched |
| 0.4 | Confirm forbidden UI gone | Human | No Home Auto-Fix / Inspect / Review in Medical History / Edit Logs; no Dictionary Auto-Calibrate / Quick Approve / Save & Approve |
| 0.5 | If Apply still misses | Code | Fix hydrate / `enrichReviewModificationCommands` only — class `APPLY_MISS`. Do not start ingest. |

**Gate:** 0.1–0.4 checked, or 0.5 landed + lifecycle tests green.  
**Do not start Wave 1 until 0.1 is true or explicitly broken with a failing `APPLY_MISS` test.**

---

## Wave 1 — Debug spine (I0)

**Goal:** Every later wave is replayable. No extract behaviour change.

| # | Task | Files | Class |
|---|---|---|---|
| 1.1 | `ClassId` enum + `IngestTrace` types (`version: 1`) | `src/utils/biomarkerIngestTrace.ts` (new) | — |
| 1.2 | Attach empty/passthrough trace on medical / `agent1_step1` jobs | `MedicalAgentExecutor.ts`, `server.ts`, `debugPayload.ts` | — |
| 1.3 | Scaffold `tests/Golden_biomarker/` (`classes/`, `examples/G-B1_unit_mix_review/`, `inbox/`) | fixtures | `SILENT_REWRITE`, `APPLY_MISS` |
| 1.4 | Wire G-B1 to **existing** `enrichReviewModificationCommands` locks (do not copy numbers by hand) | `tests/golden_biomarkers.test.ts` | same |
| 1.5 | Create `scripts/assert-biomarker-ingest.mjs` with N1–N3 only | scripts | — |
| 1.6 | Golden inbox: **Food \| Biomarkers** tab stub that can render G-B1 (even if ingest rows empty) | `GoldenInboxPanel.tsx` | — |
| 1.7 | `AI_HANDOVER.md` checkpoint | — | — |

**Gate:** M31 0; `golden_biomarkers.test.ts` G-B1 green; a medical job debug JSON has `ingestTrace.version === 1`; assert N1–N3 pass.  
**Stop if:** G-B1 numbers drift. That is Wave 0/apply, not a matcher problem.

---

## Wave 2 — Cheaper Parser, no new Home writes (I1–I2)

**Goal:** Diagnostic token waste dies. Matcher still does not auto-write.

### I1 — Prompt hygiene

| # | Task | Class |
|---|---|---|
| 2.1 | One raw injection; delete double `Chat History:` prefix | `WRONG_DOOR` / hygiene |
| 2.2 | Drop `updated_at` from extract schema; server stamps time | — |
| 2.3 | Replace `remainingText` echo with server `lastProcessedIndex` (chunking may remain until I5) | — |
| 2.4 | Split packs: `lab_extract` vs `symptom_diary`. Table header ⇒ lab pack (no HDSS) | `WRONG_DOOR` |
| 2.5 | Prompt-builder unit tests + assert N4–N5 | — |

### I2 — Lexer

| # | Task | Class |
|---|---|---|
| 2.6 | RFC 4180 + header sniff (Date / Test Name / Result / Range / Comment, TSV, pipe) | `CONFORMANCE_SHAPE` |
| 2.7 | UK `5.7 109/L`, `3 /12`, `109 / 53`, `09-Jun-2026` | same |
| 2.8 | Panel-header skip list; freeze G-B2 `source.csv` (140 rows) | `COMPLETENESS` |
| 2.9 | All parsed rows **unmatched** (no high-confidence writes yet) | — |
| 2.10 | G-B3 rotated-columns fixture (`shiftedColumnSuspect`) | `CONFORMANCE_SHAPE` |
| 2.11 | Assert N6 | — |

**Gate:** G-B2 lexer: 140 rows, 14 ISO dates, PSA comment one field. G-B3 suspect true. Table path prompt has no HDSS. Home unchanged (no new keys).  
**Stop if:** lexer writes observations. Wave 2 must not call `handleLogMedical` for high-confidence.

---

## Wave 3 — Identity + unit family (I3) — first dangerous wave

**Goal:** Shared identity. Conservative buckets. **No production auto-write yet** (stage-only / tests only) until G-B4 is green.

| # | Task | Class |
|---|---|---|
| 3.1 | Extend `getMappedBiomarkerKey` (custom key/name, UK/US spelling, longer-token wins). Apply + ingest call this only | `IDENTITY_PARALLEL_KEY` |
| 3.2 | Specimen guard (urine/serum/free/total/adjusted/non-hdl) | `IDENTITY_FALSE_FRIEND` |
| 3.3 | Unit-family gate + `isBiomarkerValueImprobable`; **no new multiply** — use `convertViaTable` existence | `CONFORMANCE_UNIT`, `PLAUSIBILITY` |
| 3.4 | `decideRow` → high_confidence / flagged / unmatched / skip + `class` tag | — |
| 3.5 | G-B4 urine vs serum albumin | `IDENTITY_FALSE_FRIEND` |
| 3.6 | G-B2 without NHS aliases: trig/LDL/Hct **flagged**; creat/ALT/BMI may hit | `CONFORMANCE_UNIT` |
| 3.7 | Assert N7–N8 | — |

**Gate:** G-B4 pass. Trig 1.7 mmol/L is **not** high-confidence. No second slugger. M31 0.  
**Stop if:** G-B4 fails. Do **not** ship apply. Do **not** add NHS aliases to hide false friends.

---

## Wave 4 — Aliases + leftover Parser (I4–I5)

**Goal:** G-B2 outer counts meaningful. Parser sees leftovers only.

### I4 — NHS print-name aliases

| # | Task | Class |
|---|---|---|
| 4.1 | Alias table for G-B2 print names (HbA1c levl, eGFRcreat, Haemoglobin estimation, Haematocrit, Serum HDL… ) | identity (examples) |
| 4.2 | Qualitative-in-comment tokens (NEGATIVE) | `COMPLETENESS` |
| 4.3 | G-B2 `expected_trace.json` as **class counts**, not “% matched” | — |
| 4.4 | Assert N9 | — |

### I5 — Handoff

| # | Task | Class |
|---|---|---|
| 4.5 | Parser payload = `unmatched[]` + flagged **context**. No high-confidence rows | `HALLUCINATED_KEY` |
| 4.6 | `shouldAbortTablePath` → 0 high-confidence, original text as prose | `CONFORMANCE_SHAPE` |
| 4.7 | Schema: `new_mappings` + `proposed_aliases` only; no `remainingText` required | — |
| 4.8 | Freeze `examples/G-B2/parser.json` from **one** captured run | — |
| 4.9 | G-B5 food-in-medical reject | `WRONG_DOOR` |
| 4.10 | Assert N10 | — |

**Gate:** G-B2 outer class counts green. G-B3 writes 0. Parser snapshot does not include `Serum sodium`. Prompt chars ≪ diagnostic job.  
**Stop if:** Parser emits a mapping for a high-confidence index — class `HALLUCINATED_KEY`, fix handoff, do not enlarge the prompt.

---

## Wave 5 — Review + staged apply (I6–I7)

**Goal:** Flagged unit rows use the **same** apply hub as G-B1. Good rows stage, then user confirms.

### I6 — Flagged → Review

| # | Task | Class |
|---|---|---|
| 5.1 | Auto Review on flagged indexes only | `CONFORMANCE_UNIT` |
| 5.2 | Commands via `enrichReviewModificationCommands` / `convertViaTable` | `APPLY_MISS` |
| 5.3 | G-B2 trig: `observationMeta.rawValue === 1.7`, `rawUnit === 'mmol/L'` | `SILENT_REWRITE` |
| 5.4 | Re-run G-B1 — numbers exact | `SILENT_REWRITE` |

### I7 — Apply hub

| # | Task | Class |
|---|---|---|
| 5.5 | Staged batch → `handleLogMedical` with `sourceReportId` (hash) | `UPSERT_IDENTITY` |
| 5.6 | Same-day merge **only** if same source hash | same |
| 5.7 | UI: “Log N staged readings (dates …) into this profile?” | wrong-patient |
| 5.8 | New keys pending; `homeLiveKeys` ⊆ approved ∩ unflagged | `USE_SURFACE_LEAK` |
| 5.9 | Proposed aliases → Dictionary queue, not matcher writes | `HALLUCINATED_KEY` |
| 5.10 | Weight/height → `droppedByApply` until product decision | — |
| 5.11 | G-B8 re-paste; assert N11–N12 | `UPSERT_IDENTITY` |

**Gate:** G-B1 still exact. G-B8 observation count unchanged. Pending infection/GPPAQ not on Home.  
**Stop if:** SI history moves, or Auto-Fix comes back as “confirm matcher.”

---

## Wave 6 — Remaining classes + inbox (I8–I9)

| # | Task | Class |
|---|---|---|
| 6.1 | G-B6 symptom pack (no table writes) | `WRONG_DOOR` |
| 6.2 | G-B7 incomplete (`41` no name refuse; `insufficient sample` ≠ 0) | `COMPLETENESS` |
| 6.3 | G-B9 vision: N/A if no extractor; do not fake | — |
| 6.4 | Inbox grouped by **class**, then example; auto-bugs from build plan §4 | all |
| 6.5 | `golden-from-medical-debug.mjs` (not food’s script) | — |
| 6.6 | Assert N13; rulebook write map: Parser writes via ingest batch | — |
| 6.7 | DOMAIN_REGRESSION_MAP + handover | — |

**Gate:** Class inner tests exist for every id in build plan §1.2 (except `CURRENCY` = Wave 7). Capture loop: debug.md → inbox → class red → fix allowed file → class green, no Gemini.  
**Ingest track is shippable here** for table + prose + leftover Parser.

---

## Wave 7 — Lifecycle leftovers (after ingest ships)

Do **not** pull these forward to make ingest look done.

| # | Task | From | Class |
|---|---|---|---|
| 7.1 | One-time profile cleanup: alias slugs, `metric_N` ghosts, stale `needsApproval`, delete `< 0` ethnicity ranges | §13.2 | `IDENTITY_PARALLEL_KEY` |
| 7.2 | Relabel XOR convert as a first-class UI mode | §13.3 | `SILENT_REWRITE` |
| 7.3 | Backfill `observationMeta` on **historical** rows | §13.3 | `CONFORMANCE_UNIT` |
| 7.4 | Real Pending store (not `customBiomarkers[new_slug]`) | §13.3 / P3 | `COMPLETENESS` |
| 7.5 | Seed `rangeVariesBy` as catalog data; silent one-key Calibrator; overlay fingerprint | §13.3 / P6 | `CURRENCY` |
| 7.6 | Name Deduper on leftover unit-suffixed keys | §13.3 | `IDENTITY_PARALLEL_KEY` |
| 7.7 | Kill leftover `normalizeHistoricalTelemetryErrors` writers | §13.3 | `SILENT_REWRITE` |
| 7.8 | Migrate then drop `biomarker_dictionary_store` | §13.3 | — |

**Gate:** lifecycle §13.7 definition of done.

---

## Dependency graph

```text
0.1 Apply smoke ─────────────┐
                             ▼
                    Wave 1  I0 (trace + G-B1 pin)
                             │
                             ▼
                    Wave 2  I1 hygiene + I2 lexer
                             │
                             ▼
                    Wave 3  I3 identity   ◄── G-B4 must pass
                             │
              ┌──────────────┴──────────────┐
              ▼                             ▼
        Wave 4 I4 aliases              (do not skip to I7)
              ▼
        Wave 4 I5 leftover Parser
              │
              ▼
        Wave 5 I6 Review  ◄── G-B1 must stay green
              ▼
        Wave 5 I7 staged apply
              │
              ▼
        Wave 6 I8–I9 inbox + capture loop
              │
              ▼
        Wave 7 lifecycle leftovers (optional vs ingest)
```

**May overlap:** 7.1 profile cleanup can run in parallel with Wave 2 (data only, no architecture).  
**Must not overlap:** I4 aliases before I3 false-friend tests; I7 apply before I3; Wave 7 Pending-store rewrite during I5–I7.

---

## Suggested execution slices (PRs)

Each PR independently reviewable. Titles are the merge commit subjects.

| PR | Wave | Title |
|---|---|---|
| 1 | 0–1 | `biomarker: ingestTrace + G-B1 class pin (I0)` |
| 2 | 2 | `biomarker: extract prompt hygiene + pack split (I1)` |
| 3 | 2 | `biomarker: table lexer, unmatched-only (I2)` |
| 4 | 3 | `biomarker: shared identity + unit-family gate (I3)` |
| 5 | 4 | `biomarker: NHS aliases + leftover Parser handoff (I4–I5)` |
| 6 | 5 | `biomarker: flagged Review + staged upsert apply (I6–I7)` |
| 7 | 6 | `biomarker: class inbox + medical golden capture (I8–I9)` |
| 8+ | 7 | one PR per 7.x — do not bundle with ingest |

---

## Out of scope (entire roadmap)

- Food pipeline, lassi/picnic, USDA Analyze hot path  
- Renaming `agent4` storage ids; deleting instruction packs  
- Full LOINC/UCUM; Insights accordion rewrite  
- Fuzzy Levenshtein auto-approve; silent alias learning  
- `approve_all` over 90 pre-parsed rows  
- Requiring vision (G-B9) for ingest v1  
- New health-planning agents until Wave 0 + `USE_SURFACE_LEAK` are green  

---

## Definition of done (whole track)

**Ingest v1 (end of Wave 6)**

- Class inner tests exist; G-B1 outer green; G-B2 outer green as **class counts**  
- Parser prompt has no high-confidence names and no `remainingText`  
- Live job has `ingestTrace` with class tags  
- Inbox is Food \| Biomarkers, grouped by class  
- Re-paste upserts; batch confirm before Home  
- M31 still 0  

**Lifecycle done (end of Wave 7)** — still `BIOMARKER_LIFECYCLE_PLAN.md` §13.7: live Apply verified, unknown names never catalog keys, historical units, relabel cannot rewrite numbers, Home/coach never consume pending/flagged.

Until Wave 6: do not claim 90% token reduction in product copy.
