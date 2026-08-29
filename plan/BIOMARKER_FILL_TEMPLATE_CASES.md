# Fill-template prototype — remaining work to close C1–C7

**Status:** 2026-08-29. Prototype-only at `prototype/biomarkers/`.  
**Architecture:** catalog / pending / overlay / observations (`BIOMARKER_LIFECYCLE.md`, `docs/agent/domains/biomarkers.md`).  
**C2 evidence:** `prototype/biomarkers/reports/C2_live.md` (instruction + full payloads + model output).  
**Default model:** `gemini-3.5-flash-lite`.

> [!IMPORTANT]
> **MANDATORY GATE BEFORE IMPLEMENTATION:**  
> **All 7 prototype test cases (C1, C2, C3, C4, C5, C6, C7) MUST be completely passed and green in the prototype harness before ANY production implementation or modal wiring begins.**  
> Once all 7 cases are green, this entire suite will become the permanent automated baseline regression gate (`scripts/assert-biomarker-cases.mjs`) to safeguard the production pipeline against regressions.

This is the execute list for the **one chat modal** fill. It is not a sixth pillar; Track B architecture stays in `BIOMARKER_LIFECYCLE.md`.

---

## 0. What is already green (C2)

One user send of 30 June 2026 rows. Back-office identity **18 observation / 12 pending**. TypeScript continuation **2 agent turns** (insight pack 20, draft pack 12). Live score **PASS**.

| Already proven | How |
|---|---|
| Alias/key identity | `getMappedBiomarkerKey` + `normalizeBiomarkerName` (HbA1c IFCC, Haemoglobin, …) |
| Hit vs miss write targets | Hits never pending; misses never steal a catalog key |
| Agent continuation | User does not say continue; runner splits leftover |
| Status in TypeScript | TC 6.5 **Very High** (not Critical); eGFR 80 **Mildly Decreased (CKD G2)**; ALT 41 **Elevated** |
| Insight rule | Cite status; Optimal = 1 sentence; else profile + trend; no 20–41 lie |
| Overlay left null | Population brackets were not copied onto the user |

**C2 is not the finish line.** It does not cover units, OCR, onboarding, vague text, or delete/hide.

---

## 1. Definition of done (all use cases)

| Chat | User send | Done when | Depends on |
|---|---|---|---|
| **C1** | 2 known lines + “what does that mean” | Alias → `hba1c`/`ldl`; insight Elevated / Very High; no Critical; no “40 outside 20–41”; no practice/conditions slots | Same harness as C2, `--only C1` |
| **C2** | 14 known catalog hits (simple, 1 turn) | **PASS**. Known catalog markers, multi-date log trends, comments, US→SI unit conversion, single peak optimal values, full multi-bracket custom range overlays, and dictionary error detection/editing | Runner `--only C2` |
| **C3** | 10 uncataloged misses (simple, 1 turn) | **PASS**. Zero catalog hits; drafts `newCatalogDraft` schema (`suggestedKey`, `name`, `unit`, `aliases`, `normalRange`, `description`, `riskCategories`), personalized insights, single optimal values, and standardized logs | Runner `--only C3` |
| **C4** | Onboarding + US-looking numbers | Profile 43 / male / Chinese / 178 cm / 78 kg extracted. A1c `5.7` → catalog mmol/mol, LDL `130` → mmol/L via `convertViaTable` (raw kept). Agent never asks SI. eGFR overlay + fingerprint. ALT observation, no invented ethnicity overlay. All hits | Back-office convert + profile parse |
| **C5** | ~50 **known** FBC/U&E/lipid lines | One user send; zero pending; runner auto-continues until `remaining` empty | `fixtures/panel_50.json` from current catalog keys |
| **C6** | “Log these GP results” + 3 screenshots | OCR names/values/dates from pixels; printed ranges stay on the observation; UK spellings / `umol/L` / `10*9/L` / “HbA1c levl” still hit; known → observation; not-in-seed → pending; dates not collapsed; agent continuation | Vision front door + C2 scorer shape |
| **C7** | “sugar was high” | No invented glucose number, no pending draft | Refuse path in back-office |
| **C8** | Delete 5 June HbA1c; hide from Home; keep dictionary | Observation tombstone; `notUsed` hide; refuse catalog destroy | Seeded store + existing tombstone helpers |

**Strict Pre-Implementation Gate:**
- **Zero implementation before 100% green:** Production wiring into the medical chat modal (`LogChat.tsx` / `server_routes_medical_gemini.ts`) is strictly forbidden until **all cases pass 100% green** in the prototype runner.
- **Permanent baseline regression test:** Upon passing, this prototype harness becomes the official automated regression baseline test suite executed on every release gate (`scripts/assert-biomarker-cases.mjs`).

---

## 2. Ordered work (do in this sequence)

### P0 — Harness can run every chat id

`runner.ts` currently exits unless `--only C2`. Add `fixtures/cases/C1.json` … `C7.json`, `--only`, and per-case scorers (C2 gold stays `C2.expected.json`).

### P1 — C1 insight honesty (small, same path as C2)

Fixture message:

> Hi, I got my bloods back. Haemoglobin A1c (IFCC) on 5 June 2026 was 40, and LDL 4.3. What does that mean for me?

Score: two hits; HbA1c cites Elevated + must not claim outside 20–41; LDL Very High; no Critical.

### P2 — C3 silent US → catalog units + profile

Back-office, not the prompt:

1. Parse age/sex/ethnicity/height/weight from the user sentence onto `ProfileFixture`.
2. Infer printed unit when the user omitted it (`5.7` HbA1c → `%`, `130` LDL → `mg/dL`) then `convertViaTable` to catalog unit. Keep raw.
3. Fail the case if values land as `5.7 mmol/mol` or `130 mmol/L`, or if the model asks which unit system.
4. eGFR overlay for this fingerprint; ALT must **not** get a fake ethnicity overlay.

### P3 — C6 refuse + C7 tombstones (no OCR)

- C6: no analyte → empty apply set, no draft, no invented log.
- C7: seed June HbA1c 40; apply delete log id + hide (`notUsed`); dictionary key `hba1c` remains.

### P4 — C4 scale

Build `fixtures/panel_50.json` from **existing** `biomarkerDefinitions` only (do not invent 50 new keys). Same hit insight path; packer already holds 20 hits/turn so this is 3 turns unless the budget is raised. Zero pending.

### P5 — C5 OCR (the hard remaining chat)

Images already at:

```text
prototype/biomarkers/image/
  nhs_gp_results_p1_hba1c_renal_lft.png
  nhs_gp_results_p2_bone_fbc.png
  nhs_gp_results_p3_qrisk_lipids.png
```

Add a vision extract step (Flash Lite, constrained JSON of printed name/value/unit/date/printedRange) **before** `classifyRows`. Lab Parser is this front door; the fill agent still only writes insight/draft. Score: mixed dates (03-Jun lipids vs 05-Jun HbA1c vs 04-Jun QRISK); printed 20–41 stays on the HbA1c observation; “HbA1c levl” still maps.

### P6 — NHS catalog seed (after C2/C5 gold exists)

Twelve C2 misses are real NHS panel rows (Na, K, Ca, adj. Ca, phosphate, ALP, globulin, non-HDL, ferritin, Lp(a), homocysteine, PSA). Seeding them is product-correct and **changes C2 expected** (pending → observation). Do it as its own change: add definitions + aliases + ranges, update `C2.expected.json`, re-run live C2, then C5 has fewer drafts.

Highest-value seeds first: **non-HDL**, **ferritin**, **sodium/potassium**, **ALP**.

### P7 — Quality leftovers (do not block C3–C5)

- Near-bound band so ALT 41 / protein 81 are not the same stamp as LDL 4.3.
- Score pending drafts (`suggestedKey` vs `draftSuggestedKey`; invented ranges).
- Panel-level wrap (“lipids are the story; FBC is fine”) — extra TS-assembled summary, not 18 essays.
- `rangeVariesBy` actually set on catalog keys C3 needs (eGFR/lipids), so overlay has a catalog signal.
- Persist instruction + user payload on every live run (now in the runner).

### P8 — Production wire & Automated Baseline Gate

- **Prerequisite Gate:** ALL 7 prototype cases (**C1 through C7**) must be 100% green and verified in `runner.ts`. Zero production changes to `LogChat.tsx`, `MedicalAgentExecutor.ts`, or `server_routes_medical_gemini.ts` are permitted before this gate is completely satisfied.
- **Wire to Production:** Port the exact proven instruction, back-office classifier, and template schema into the medical chat modal. Identity, status calculations, and unit conversions remain pure TypeScript. Do **not** concatenate Lab Parser + Calibrator + Review prompts.
- **Permanent Baseline Regression Test:** Convert the proven `runner.ts` prototype test suite into the official automated release gate script (`scripts/assert-biomarker-cases.mjs`). Any future agent prompt revisions, catalog dictionary additions, or schema adjustments will be strictly gated against this baseline suite to guarantee zero regression.

---

## 3. Agent instruction (verbatim, C2 live)

```
You fill USER slots only.

HIT: dictionary locked. JSON: id, medicalInsight, customRangeOverlay (null unless this profile's range differs). Cite status. Optimal: 1 sentence. Else ≤2 sentences (profile + trend). HbA1c 40 in 20-41 can still be Elevated. Never write Critical.

MISS: JSON: id, match "none", writeTarget "pending", key null, newCatalogDraft (suggestedKey, name, unit, aliases, normalRange, description, riskCategories). Not Home.

No status field. No unit math. This batch only. JSON { "rows": [...] }.
```

Source: `prototype/biomarkers/instruction.ts`. L12: keep this at or under current word count when editing.

---

## 4. Full payload sent (C2 live)

Reconstructed with the same builders used at call time (`buildTurnUserMessage` in `call_agent.ts`) from the classified C2 rows + `fixtures/profile.json`. Live model output is unchanged.

**Turn 1** = 18 hits, 4039ms. **Turn 2** = 12 misses, 5437ms.

The complete user contents for both turns (user message + turn header + JSON batch) are in:

`prototype/biomarkers/reports/C2_live.md` → section **Agent turns (full payload sent + model output)**.

JSON sidecar: `prototype/biomarkers/reports/C2.json` fields `instruction`, `turns[].user`, `turns[].payload`.

Do not treat a later live run’s wording as this baseline unless the score is still PASS and this file’s date is updated.

---

## 5. Out of scope until the chats are green

- Production `LogChat` / `MedicalAgentExecutor` swap
- Concatenating retired agent prompts into this instruction
- Painting C2 green by adding `food_aliases` / catalog `includes()` for this meal-style panel
- Changing batch size again (packer already 2 turns on C2)

---

## 6. How to run

```bash
./node_modules/.bin/tsx prototype/biomarkers/runner.ts --only C2 --dry-run
./node_modules/.bin/tsx prototype/biomarkers/runner.ts --only C2
./node_modules/.bin/tsx prototype/biomarkers/runner.ts --rebuild-report   # instruction + payloads into C2_live.md
# after P0:
./node_modules/.bin/tsx prototype/biomarkers/runner.ts --only C1
# …
```
