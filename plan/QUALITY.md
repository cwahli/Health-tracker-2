# Quality — class-first goldens

**Pillar:** 4 — Quality. **Start work from:** [ROADMAP.md](./ROADMAP.md).

A **test method**, not a product lifecycle. Class-first goldens (not meal-green). Was `BIOMARKER_INGEST_AND_GOLDENS_PLAN.md` — full text kept. Food uses the same method (`FALSE_FRIEND`, `DISH_DROP`, `OPENING_WRONG`, `SILENT_REPAIR`).

Ingest architecture stays in `BIOMARKER_LIFECYCLE.md` Part B. Wave order stays in `ROADMAP.md`.

**Status:** Landed through Waves 0–7. All core gates passing (exit 0).

---

## 0. Why we consolidate (do not become meal log)

Food goldens looped because the **control loop was wrong**:

```text
Work item  = latest meal case
Reward     = replay all_green
Action space = whole tree (catalog, aliases, expected.json, prompts)
Inner loop = Gemini / USDA / NEW Analyze
```

Every new red was another constraint. Studio searched for a way to paint the meal green (alias, scale, edit expected numbers). Harder gates made the door smaller without changing the reward. That is endless bugs.

Biomarkers will do the same if we implement “make the 140-row EMIS file green.”

**Previous session (2026-08-14)** already said:

- Lifecycle (`identify → clean → tailor → use`) is **good for UX and dispatch**, **not** the golden taxonomy.
- Goldens group by **data-quality / bug class** (Weiskopf completeness, conformance, plausibility, concordance, currency + auto-bugs in lifecycle §9).
- Food follow-up (2026-08-15) named the solver: **class-first playbooks** — work item is the class; the job is only a regression example after the class is green.

**Today (2026-08-16)** designed the ingest router (lexer + leftover Parser + flagged Review) and a case list G-B1…G-B9.

This file **keeps both**. Class is the spine. Ingest is how n=10–50 reports enter. G-B1/G-B2 are pinned **examples**, not folders we “turn green.”

```text
Classify the red  →  one class
     ↓
Playbook (finite tree, STOP leaves)
     ↓
Inner loop = one unit test file, one allowed file set
     ↓
Hypothesis burned if the predicted test does not change
     ↓
Outer check = one frozen example (G-B1 or a G-B2 slice)
     ↓
Honest residual is a valid terminal (pending / unmatched / MISS)
```

Reward flips from `EMIS all_green` to `class tests pass`.

---

## 1. Two maps (do not collapse them)

### 1.1 UX / dispatch (lifecycle — keep)

How a human and an agent move. How Front Desk and the router choose a pack.

```text
source → parse → identity → clean → approve → overlay → use
         Lab Parser   getMapped…   Review     Dictionary  Calibrator  Home/coach
         leftover-    + unit       flagged    human       rangeVariesBy
         only         family
```

n=1–5 → one Review session.  
n=10–50 (one report) → **ingest router** (this plan).  
n≥20 hygiene → one specialist pack.

This map must not become `tests/Golden_biomarker/parse/`, `…/identity/`, etc. One paste hits every stage.

### 1.2 Testable map (class — this is how we gold)

Weiskopf & Weng / Kahn DQ from lifecycle §1, plus the auto-bugs from §9 and today’s ingest failures.

| Class id | Law | Inner test (no Gemini) | Honest residual |
|---|---|---|---|
| `IDENTITY_FALSE_FRIEND` | One code per analyte | urine albumin ≠ serum albumin; chol/HDL ratio ≠ cholesterol; MCH ≠ hemoglobin | unmatched or flagged, never high-confidence |
| `IDENTITY_PARALLEL_KEY` | `getMappedBiomarkerKey` on every write | `serumsodium` must not sit beside `serum_sodium` | map or tombstone |
| `CONFORMANCE_UNIT` | Value+unit pair; convert table only | trig 1.7 mmol/L vs catalog mg/dL → flagged; convert only via `convertViaTable` | raw kept on `observationMeta` |
| `CONFORMANCE_SHAPE` | Lexer / dates / columns | shifted CSV → `abortedTablePath`, 0 high-confidence; `09-Jun-2026` per row | prose leftover |
| `PLAUSIBILITY` | Flag 15× / impossible pair | Na 14, ALT 10000, Hct 48 vs 0.48 | Review, no silent scale |
| `COMPLETENESS` | Do not invent or drop signal | `insufficient sample` ≠ 0; bare `41` has no analyte; panel header skip-with-note | pending or omit |
| `SILENT_REWRITE` | Sanitize must not convert | G-B1: SI 1.43 / 13 / 72 untouched; no `/38.67`; no sodium→143 | flag only |
| `APPLY_MISS` | Review commands land | empty `modificationCommand` still yields five locked converts | — |
| `USE_SURFACE_LEAK` | Home/coach = approved ∩ unflagged | pending GPPAQ / infection keys absent from `filterHistoryForUse` | stay pending |
| `WRONG_DOOR` | Food ≠ labs ≠ diary | nutrition label → reject; “blood in stool last few days” → `symptom_diary` only | empty lab mappings |
| `UPSERT_IDENTITY` | `(key, date, sourceReportId)` | re-paste does not double ALT | same row |
| `HALLUCINATED_KEY` | Parser no new Home keys | leftover may propose; Dictionary owns approve | pending |
| `CURRENCY` | Overlay fingerprint | Calibrator **not** on extract path | later overlay-only |

A live job may trip several classes. **Only one class is in scope per session.** Other reds are listed “out of session.”

---

## 2. What already landed (do not rebuild)

From 2026-08-14 / M31. Ingest **calls** these.

| Piece | Where |
|---|---|
| `convertViaTable` + locked numbers | hdl 50→**1.293**, TG 125→**1.411**, ldl 130→**3.362**, creat 0.9→**79.56**, bili 0.8→**13.68** |
| Review apply | `modificationCommand` + `toYYYYMMDD` + `enrichReviewModificationCommands` + synthesize-from-history |
| `observationMeta` on **new** writes | `attachObservationMeta` |
| Sanitize flag-only | no rewrite on set |
| `0` is a value | `isValEmpty` |
| Approval explicit | `isPendingCatalogApproval` / `isBiomarkerApproved` (not five fields) |
| Home/coach/food gate | `filterHistoryForUse` / `isLiveForUse` |
| No Auto-Fix / Auto-Calibrate / one-click Approve | M31 A1–A2 |
| Display names + retired destinations | `AGENT_DISPLAY_NAMES` / `resolveAgentDestination` |
| Instruction packs stay | `server.ts` / `custom_system_instruction_*` |
| `customBiomarkers` still the synced bag | until lifecycle P3 Pending store |
| Shared medical cases | `job_medical_1786660190499`, `job_medical_1786666223594` |

**Still open from lifecycle §13** (not cancelled by ingest): Apply smoke on the live profile; historical `observationMeta` backfill; real Pending store; relabel XOR convert UI; silent one-key Calibrator; Name Deduper on leftover slugs; Slice 4 inbox.

If a slice breaks `node scripts/assert-biomarker-lifecycle-m31.mjs`, the slice is wrong.

---

## 3. Ingest router (today) — dispatcher for one report

Full failure-mode writeup: `BIOMARKER_INGEST_ROUTER_PLAN.md`. Summary only.

```text
classifier → lexer / vision / prose rows → identity + unit-family
  → high-confidence  staged (no LLM)
  → flagged          Review on that subset (convert table)
  → unmatched        Lab Parser leftovers only
  → reject           empty mappings
```

**Bias:** false high-confidence is forbidden. False unmatched is allowed. Silent drop is forbidden. Parser does not invent numbers or emit rows that were not in `unmatched[]`.

Well-formed **wrong patient** labs: batch confirm, not an LLM.

Layer 1 is a **pure function**. A sodium mapped to potassium is an identity test, not a prompt tweak.

---

## 4. Debug contract

Every medical ingest job writes `ingestTrace` (job result + R2 cold debug). Food has scout.json. Biomarkers have a **trace**, not a kcal board.

Each row carries `class` (from §1.2) plus `bucket` / `why`. Inbox groups by **class**, then job.

```ts
// additive fields on the trace in the router plan
row.class: ClassId
handoff.dualRawInjection: false
```

**How you debug**

1. Open job → see classes, not “82% green.”  
2. Pick **one** class.  
3. Inner: `npx vitest run src/utils/biomarkerIngest.test.ts -t IDENTITY_FALSE_FRIEND` (no API).  
4. If apply/convert: reuse `biomarkerLifecycle.test.ts` locks.  
5. Outer once: frozen example for that class (G-B1 or a G-B2 slice).  
6. If it cannot be reproduced from `ingestTrace` + frozen JSON, it is not closed.

Live job → `golden-from-medical-debug.mjs` → `tests/Golden_biomarker/inbox/<jobId>/` tagged with `class`. Promote only after the **class** file is green. Do not run medical debug through food `golden-from-debug.mjs`.

---

## 5. Playbooks (capability firewall)

Copy the food lesson: Studio must not be allowed to edit the catalog to paint a class green.

| Class | May edit | Must not edit |
|---|---|---|
| `IDENTITY_*` | `biomarkers.ts` (`getMappedBiomarkerKey` only), `biomarkerIngest.ts` decideRow, their tests | `ANALYTE_CONVERSIONS` numbers, `expected.json` locks, Review prompts, `customBiomarkers` seed |
| `CONFORMANCE_UNIT` / `SILENT_REWRITE` / `APPLY_MISS` | `biomarkerLifecycle.ts` apply path, Review enrich, tests | Matcher aliases, Parser prompts, Home buttons |
| `SECOND_MATH_PATH` | `ANALYTE_CONVERSIONS` + `convertViaTable` + callers | A new `compute*Multiplier` / second factor table |
| `CONFORMANCE_SHAPE` / `COMPLETENESS` | `biomarkerIngest.ts` lexer/handoff | Convert table, Dictionary approve |
| `PLAUSIBILITY` | `isBiomarkerValueImprobable` + flag wiring | Silent sanitize convert |
| `USE_SURFACE_LEAK` | `filterHistoryForUse` call sites | New Auto-Fix |
| `WRONG_DOOR` | classifier + pack split in `server.ts` | Lab Parser writing food |
| `UPSERT_IDENTITY` | `handleLogMedical` merge + `sourceReportId` | Same-day average |
| `HALLUCINATED_KEY` | Parser schema + pending stamp | Auto-approve |
| `CURRENCY` | `shouldRunCalibrator` after ingest | Extract path |

Each `/attempt` requires:

```text
class: IDENTITY_FALSE_FRIEND
hypothesis: <one sentence>
predicted: <named test goes red→green>
change: <one allowed file>
```

Predicted test does not change → hypothesis **burned**, cannot retry. Two burns → STOP, human. No “I added an alias, replay the CSV later.”

**Forbidden as COMPLETE:** editing G-B2 `expected_trace.json` to match a buggy matcher; calling Gemini inside Layer-1 tests; restoring Auto-Fix to “confirm” high-confidence rows.

---

## 6. Fixtures are examples, not work items

**Root:** `tests/Golden_biomarker/` (never under `Golden_meal/`).

```text
tests/Golden_biomarker/
  README.md                      # class index
  classes/
    IDENTITY_FALSE_FRIEND.test.ts
    CONFORMANCE_UNIT.test.ts
    SILENT_REWRITE.test.ts
    APPLY_MISS.test.ts
    …
  examples/
    G-B1_unit_mix_review/        # SILENT_REWRITE + APPLY_MISS + PLAUSIBILITY
    G-B2_emis_nhs_table/         # outer regression; assert by class counts
    G-B3_shifted_columns/        # CONFORMANCE_SHAPE
    G-B4_specimen_false_friend/  # IDENTITY_FALSE_FRIEND
    G-B5_food_in_medical/        # WRONG_DOOR
    G-B6_symptom_diary/          # WRONG_DOOR
    G-B7_incomplete/             # COMPLETENESS
    G-B8_repaste_upsert/         # UPSERT_IDENTITY
    G-B9_photo_plus_caption/     # later; no double ALT
  inbox/                         # live captures, each tagged class
```

### 6.1 G-B1 — example for `SILENT_REWRITE` + `APPLY_MISS`

Jobs `job_medical_1786660190499` / `1786666223594`.  
14-08-2026 US cluster vs older SI. Empty `modificationCommand` still yields the five locked converts. SI 1.43 / 1.07 / 4.2 / 100 / 16 / bili 13 / creat 72 **untouched**. `observationMeta.rawValue` kept.

**Ingest must not rewrite this fixture.** G-B2 flagged lipids use the **same** `convertViaTable` (inverse direction if needed).

### 6.2 G-B2 — outer regression for a full table (not a class)

140-row NHS/EMIS paste. Outer check **after** identity + conformance class tests are green.

Assert **counts and class tags**, not “91 deterministic matches”:

| Class | Must show up |
|---|---|
| skip / completeness | panel headers; Sample site; CHLAMYDIA/GC PCR |
| identity high-confidence | Na, K, creat, ALT, AST, … after alias table (I4) |
| `CONFORMANCE_UNIT` | trig 1.7/2.2/1.07 mmol/L; LDL mmol/L vs mg/dL; Hct 0.48 L/L vs % |
| `IDENTITY_FALSE_FRIEND` never | ratio → cholesterol; MCH → hemoglobin; adj-Ca → calcium |
| unmatched / completeness | GPPAQ, AUDIT items, infection qualitative, PSA, QRISK, BP |
| `USE_SURFACE_LEAK` | pending keys not in `homeLiveKeys` |
| `HALLUCINATED_KEY` | Parser prompt contains **no** high-confidence printed names |

Weight/height: `droppedByApply` until the product question is answered.

### 6.3 Replay commands

```bash
# Inner (class) — no network
npx vitest run src/utils/biomarkerLifecycle.test.ts   # SILENT_REWRITE / APPLY_MISS locks
npx vitest run src/utils/biomarkerIdentity.test.ts
npx vitest run src/utils/biomarkerIngest.test.ts -t IDENTITY_FALSE_FRIEND

# Outer (one example)
npx vitest run tests/golden_biomarkers.test.ts -t G-B1
npx vitest run tests/golden_biomarkers.test.ts -t G-B2   # only after class tests

node scripts/assert-biomarker-lifecycle-m31.mjs
node scripts/assert-biomarker-ingest.mjs
```

Replay **never** calls `/api/gemini/medical-analyze`.

---

## 7. Code shape

Lifecycle files stay the write/convert/use layer.

| File | Owns |
|---|---|
| `src/utils/biomarkerIngest.ts` | classify, lex, decideRow, abort table, class tags |
| `src/utils/biomarkerIngest.test.ts` | class inner tests |
| `src/utils/biomarkerIngestTrace.ts` | trace + one-line logs + markdown board |
| `src/utils/biomarkers.ts` | **extend** `getMappedBiomarkerKey` only identity entry |
| `src/utils/biomarkerLifecycle.ts` | convert, apply, observationMeta, filter-for-use |
| `src/utils/debugPayload.ts` | ingest board in cold debug |
| `server.ts` | pack split; no dual injection; leftover-only prompt |
| `src/jobs/MedicalAgentExecutor.ts` | pass trace |
| `src/App.tsx` `handleLogMedical` | staged batch; `sourceReportId` upsert |
| `scripts/assert-biomarker-ingest.mjs` | call-site gate (M31 style) |
| `scripts/golden-from-medical-debug.mjs` | medical capture |
| `tests/Golden_biomarker/**` | classes + examples |

No new agent id.

---

## 8. Slices (class-gated)

Each slice: IMPACT → code → **its class tests** → M31 still 0 → handover. Do not start I4 (aliases) to make G-B2 look better before I3 false-friend tests exist.

| Slice | Ships | Class it must turn green first |
|---|---|---|
| **I0** | `ingestTrace` passthrough; pin G-B1 example; inbox domain stub; class id enum | `APPLY_MISS` / `SILENT_REWRITE` (existing lifecycle tests, now also under `examples/G-B1`) |
| **I1** | Single raw injection; drop `updated_at`; split `lab_extract` vs `symptom_diary` | `WRONG_DOOR` (table must not load HDSS); `dualRawInjection === false` |
| **I2** | RFC 4180 lexer; UK `109/L`; panel skip; all rows unmatched until I3 | `CONFORMANCE_SHAPE` (G-B3 rotated columns); G-B2 row/date counts |
| **I3** | Shared identity + unit-family + specimen guard; buckets | `IDENTITY_FALSE_FRIEND` (G-B4); `CONFORMANCE_UNIT` (trig/LDL/Hct flagged, not high-confidence) |
| **I4** | NHS print-name aliases | G-B2 **outer** counts; high-confidence names absent from prompt snapshot |
| **I5** | Leftover-only Parser; abort table path; freeze `parser.json` | `HALLUCINATED_KEY`; `CONFORMANCE_SHAPE` abort writes 0 |
| **I6** | Flagged → Review via existing enrich/apply | `CONFORMANCE_UNIT` apply keeps raw; G-B1 still exact |
| **I7** | Staged batch confirm; `sourceReportId` upsert; pending not Home | `UPSERT_IDENTITY` (G-B8); `USE_SURFACE_LEAK` |
| **I8** | G-B5–B7; G-B9 N/A if no vision | `WRONG_DOOR`; `COMPLETENESS` |
| **I9** | Inbox grouped by class; master assert; rulebook write map | M31 A10 + ingest N-list |

I0–I2 cannot poison Home. I3 is the first slice that can write a wrong key — G-B4 must pass before apply is live.

**Out of v1:** fuzzy auto-approve, silent alias writes, `approve_all`, vision required, historical `observationMeta` backfill (lifecycle §13), Pending-store split (P3).

---

## 9. Master ingest assert (add rows as slices land)

Never weaken a check. Always also run M31.

| ID | When | Check |
|---|---|---|
| N1 | I0 | `ingestTrace` on medical job result |
| N2 | I0 | G-B1 `expected.json` contains `1.293` |
| N3 | I0 | Class id enum used in trace types |
| N4 | I1 | No double `Chat History:`; `updated_at` not required on extract items |
| N5 | I1 | Table path does not include `self_reported_symptom_diary_rules` |
| N6 | I2 | `lexTable` / `buildIngestBatch` exported |
| N7 | I3 | `getMappedBiomarkerKey` is the only identity entry (ingest calls it) |
| N8 | I3 | Unit gate uses `convertViaTable` existence / `isBiomarkerValueImprobable`, not a new multiply |
| N9 | I4 | G-B2 example present; assertions are class counts, not a single “percent matched” |
| N10 | I5 | `remainingText` not required; `shouldAbortTablePath` before high-confidence write |
| N11 | I6 | Flagged apply calls enrich / `applyModificationCommands` |
| N12 | I7 | `sourceReportId` on ingest merge; `filterHistoryForUse` still Home/coach |
| N13 | I9 | Inbox mentions Biomarkers **and** class grouping |

---

## 10. Lifecycle §13 mapped (so we do not drop it)

| §13 item | Lives in | Class |
|---|---|---|
| Apply smoke five converts on live profile | still required | `APPLY_MISS` |
| Unknown name ≠ catalog key | I5–I7 | `HALLUCINATED_KEY` |
| Historical `observationMeta` backfill | **not ingest** | `CONFORMANCE_UNIT` residual |
| Relabel XOR convert UI | **not ingest** (I6 uses convert for flagged only) | `SILENT_REWRITE` |
| Upsert + no same-day average | I7 | `UPSERT_IDENTITY` |
| Real Pending store | lifecycle P3; I7 best-effort | `COMPLETENESS` |
| Silent Calibrator | after ingest, not on extract | `CURRENCY` |
| Dispatcher n=10–50 | this whole file | — |
| Slice 4 inbox | I0 + I9 | all classes visible |

---

## 11. Open product questions (do not block I0–I5)

1. Lab weight/height → observations, profile, or keep `droppedByApply`?  
2. Panel-header comments (“Raised — repeat in 3 months”) → note on next lipid row?  
3. BP → two keys or one qualitative string?

---

## 12. Definition of done

Not “the EMIS file is 90% auto-parsed.”

1. Every class in §1.2 has an inner vitest.  
2. G-B1 outer green; locked converts unchanged; M31 exit 0.  
3. G-B2 outer green **as class counts**; Parser prompt has no high-confidence names and no `remainingText`.  
4. A live job shows `ingestTrace` with class tags; one-line logs greppable.  
5. Inbox is Food \| Biomarkers, grouped by class.  
6. A failing medical debug.md → inbox → class test red → fix **allowed file only** → class green → outer example, **without Gemini**.  
7. Two burned hypotheses still STOP. Editing expected locks to match a bug is FAIL.  
8. Rulebook write map updated when I5/I7 change who writes observations.

Until then: do not claim token-reduction in product copy. The class tests say what happened.

---

## 13. Platform kit (UI / speed — same loop, not a fifth pillar)

Execute IDs: `ROADMAP.md` **Q-1…Q-5**, **B8**, **R-8…R-11**, **F-6/F-7**.  
This is the food-golden lesson applied to chrome: the reward was “it works,” so agents added a second button, a second convert table, and a 6,634-line modal. Change the reward.

### 13.1 Classes (add to the spine; one per pack)

| Class id | Law | Inner test | Honest residual |
|---|---|---|---|
| `SECOND_MATH_PATH` | One convert table | New analyte with an `ANALYTE_CONVERSIONS` row converts via `convertViaTable`; without a row → `ok: false`, no `if (key === '…')` | Flag, do not guess |
| `CLONE_UI` | One control per job | `Check Biomarkers` / Auto-Fix / filter pills: one catalog id, N call sites | Extra label is a fail, not a feature |
| `EAGER_MOUNT` | No extra work on first paint | Named watcher / full hydrate / full audit not in `App` first turn; Health tab does not call `runGeneralizedBiomarkerAudit` until the user opens Audit | Defer is success |
| `PROMPT_GROWTH` | L12 as a gate | `server_vision_scout.ts` net-zero lines unless pack lists it | Logic in TS, not English |
| `KIT_DRIFT` | New chrome names a catalog id | New `*Modal.tsx` / `*Card.tsx` / `*Table.tsx` without `CATALOG.json` id fails `assert-budgets.mjs` | Extend primitive, or justify |
| `GOD_FILE_GROWTH` | Ceilings | `App.tsx` 7832 · Dictionary 6634 · `FoodCard` 3813 · `HomeTab` 3071 · `LogChat` 6688 · scout 1414 — net-zero unless in-scope **and** deletions ≥ additions | Extract only when Q-1 is red on that file |

`USE_SURFACE_LEAK` playbook still forbids **new** Auto-Fix. B8.0 decides whether the Flagged Telemetry modal is the one allowed surface or none.

### 13.2 Catalog (the reuse artifact)

Allowed primitive ids (do not invent `BiomarkerDataGrid` next to `AgentResultTable`):

```text
AppModal                      shell only (title, close, children, actions)
DataGrid                      sort / page / row select — no agent YAML
FilterPills                   one pill bar
ConfirmBar                    inline Yes/Cancel (no window.confirm)
NutritionLabelTable           keep
ComprehensiveNutrientsTable   keep
PortionClarifyCard            keep
convertViaTable               only math
lazyWithRetry                 keep
```

Each new primitive: ≤300 lines, own vitest, frozen props. Feature screens compose; they do not own focus-trap, pill styles, or unit factors.

**Inner-platform rule:** if a “shared” file grows past ~400 lines of `if (agentType === …)` (`AgentResultTable` today), it is **KIT_DRIFT**, not reuse. Split behavior out. Grok owns that split (Q-4).

### 13.3 Playbook firewall (platform)

| Class | May edit | Must not edit |
|---|---|---|
| `SECOND_MATH_PATH` | `ANALYTE_CONVERSIONS`, `convertViaTable` callers, their tests | New factor function, G-B1 lock numbers |
| `CLONE_UI` | Call sites to the one catalog control | A second button with the same job |
| `EAGER_MOUNT` | `App.tsx` mount effects, lazy imports (named pack) | New watcher on first paint |
| `PROMPT_GROWTH` | `server_vision_scout.ts` with net-zero | Unit math in English |
| `KIT_DRIFT` / `GOD_FILE_GROWTH` | Catalog primitive + tests, then thin call sites | God-file rewrite as the inner loop |

### 13.4 Who (Gemini large-token vs Grok)

Same table as `ROADMAP.md` “Who does which.” Packs are FIND/REPLACE + named assert. Gemini may hold a whole god file in context **only** to apply a Grok-authored range. Gemini must not design the catalog or choose a new primitive.

Audit (living): line counts, duplicate labels, second math path, eager imports. Grok regenerates it; Gemini does not “search `src/components/`” as a substitute.

---

## 13. Key decisions

1. **Lifecycle = UX/dispatch. Class = goldens.** Previous session stands.  
2. **Class-first playbooks**, same control loop we specified for food, so biomarkers do not inherit the meal-green search.  
3. **One identity function, one convert function, one apply hub.**  
4. **Debug first (I0).** Trace + class tags before the matcher can write.  
5. **G-B1 and G-B2 are examples.** Work item is never “green that job.”  
6. **Honest residual is success** (pending, unmatched, flagged). Filling blanks is a bug.  
7. **M31 stays on the critical path of every ingest slice.**
