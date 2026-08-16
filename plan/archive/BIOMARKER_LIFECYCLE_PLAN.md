# Biomarker lifecycle — architecture plan

**Pillar:** 1 — Biomarkers. Map: `plan/README.md`. Execute: `BIOMARKER_IMPLEMENTATION_ROADMAP.md`.

**Status:** Design agreed 2026-08-14. Slices 0–3 **core** landed. 2026-08-14 late session: Home auto-fix / dictionary auto-calibrate+approve removed; pending = explicit `needsApproval` only; Review synthesizes convert commands when the model writes an essay. **Remaining work is §13 — do not start new agents until that list is walked.**  
**Rulebook (laws while coding):** `docs/agent/domains/biomarkers.md`  
**Ingest front door (2026-08-16):** `plan/BIOMARKER_INGEST_ROUTER_PLAN.md` — what Lab Parser / Review see after the deterministic router. Does not replace this file.  
**Gates:** `docs/agent/DOMAIN_REGRESSION_MAP.md` → Biomarkers  
**Do not implement this file as one PR.** Slices below. Instruction packs stay; agent *ids* stay until a dedicated migration.

---

## 0. Why this exists

Food is one-shot (scout → catalog → dietitian). Biomarkers are a **living catalog + dated observations** over months. The current app treats them like “another chat agent team”: 10+ personas write one bag (`customBiomarkers` + unitless log numbers). Result: ghosts, dups, invented keys, deletes that bounce, unit change that rewrites the number, Home/coach steered by dirty values.

This plan is the clean slate: **layers, roles, dispatcher, goldens** — reviewed against lab-informatics practice.

---

## 1. Literature / best practice (what we copy)

Not a hospital LIS. We still follow the same *shapes*.

| Practice | Source | What we do |
|---|---|---|
| **One code per analyte** | LOINC — identity so two labs do not file the same test as two concepts | Catalog `key` + `aliases[]`. `getMappedBiomarkerKey` on every ingest |
| **Value and unit are one pair** | FHIR Observation `valueQuantity` (value + UCUM unit); referenceRange is separate | Store `rawValue`+`rawUnit` and `canonicalValue`+`canonicalUnit`. Relabel ≠ convert |
| **Observation vs report** | FHIR Observation vs DiagnosticReport | One dated observation row; a PDF is a *source*, not a value |
| **Reference range vs this patient** | FHIR `referenceRange` + interpretation; lab “default” vs clinical overlay | Catalog = population default. Overlay = this profile. Calibrator writes overlay only |
| **Pre → analytical → post** | Lab medicine lifecycle | Source lock → extract → identity → clean → gate → use |
| **Completeness, conformance, plausibility, concordance, currency** | Weiskopf & Weng (JAMIA 2013); Kahn et al. harmonized DQ (2016) | Completeness = pending vs approved; conformance = legal unit pair + ISO date; plausibility = flag 15× / impossible pair; concordance = Field Compare; currency = as-of / profile fingerprint on overlay |
| **DQ loop** | HL7 PIQI-style assess → remediate → monitor | Flagger (code) → Review → goldens. Sanitize must **not** silent-rewrite |
| **Provenance** | LOINC/FHIR mapping literature (keep source names) | Never drop printed name/unit. Conversion is an event |

**We do not copy:** full LOINC codes in v1 (keys + aliases are enough); a hospital LIS; race-based eGFR coefficients as catalog medicine — Calibrator *cites* a named society, catalog stays generic.

### 1.1 Binding laws (from literature — Slice 0+)

These are **invariants**, not ideas. Code that contradicts them is a bug.

1. **Three ranges, never smashed.** Printed (on the observation, from the report) · catalog default · user overlay. Field Compare may show all three. No writer copies one onto another.
2. **Convert only via a per-analyte table.** Units must be comparable (UCUM idea). Unknown pair → flag, do not guess (`/38.67` on “whatever is large” is forbidden). HbA1c `%` ↔ `mmol/mol` is its own rule, not a multiply.
3. **Observation identity** is `(canonicalKey, date, sourceReportId)` (or excerpt hash). Re-parse of the same report is an **upsert**, not a second row.
4. **Same calendar day ≠ average.** Merge on ingest only when it is the same extract of the same source. Two labs on 13 Aug stay two observations.
5. **Overlay fingerprint uses age band** (e.g. 20–29), plus sex and ethnicity — not exact birthday. Re-run Calibrator when the **band** (or sex/ethnicity) changes.
6. **Keep `printedRange` and `labFlag`** (H/L/critical) on the observation when the report has them. Concordance: lab flag vs our overlay status is a check, not an LLM rewrite.
7. **No race coefficient in the catalog.** `rangeVariesBy: ethnicity` means “a published interval might differ.” Overlay may cite a society. Catalog defaults stay generic.

---

## 2. Target model (four records)

Do not merge these again.

```text
Catalog (admin dictionary)     population default: name, aliases, unit, range, category
        ▲ approve / alias-map
Pending extract (this user)    unknown names + raw observations
        │
Observations (logs)            dated value+unit+source on an approved key
        │
User overlay                   this person's range / optimal / notes
        ▼
Home + Health Coach            approved + unflagged only
```

### 2.1 Catalog (admin)

One row per analyte. Seed from `biomarkerDefinitions`. Status: `draft | approved | retired`.

Required: `key`, `aliases[]`, `displayName`, `canonicalUnit`, `usUnit`, `defaultRange`, `defaultDescription`, `grouping`, `defaultPopulation`, **`rangeVariesBy: ('age'|'sex'|'ethnicity')[]`**.

Only Dictionary UI (human) creates or **approves** a key. Agents **propose**.

### 2.2 Pending

Extract of a name that is not an approved key/alias → raw row in **this user’s** Medical History → Pending. No `customBiomarkers[new_slug]`. Not on Home. Not in coach.

### 2.3 Overlay

`profileAdjustedNormalRange`, `optimalValue`, `rangeBrackets`, description override. Keyed by catalog key + **profile fingerprint** (**age band**, sex, ethnicity). Does not change the catalog. If a Calibrator run equals the catalog default, store `same_as_catalog` and skip next time.

### 2.4 Observation

`{ id, key, date (ISO), rawValue, rawUnit, canonicalValue, canonicalUnit, sourceJobId, excerpt, printedRange?, labFlag? }`.  
Identity for upsert: `(key, date, sourceJobId)`.  
`key` is live only if catalog-approved. Grow = append dates.

**Today:** `BiomarkerLog.biomarkers` is `{ key: number }` with unit only on the dictionary. That is the US/SI class of bugs. Migration is Slice 2.

---

## 3. What “used” means

A key may appear in Medical History **categories**, Home, food badges, and `health_baseline` nutrient targets **only if**:

1. Catalog `status === approved` (not “has five fields”)  
2. Latest observation is **not flagged**  
3. Value+unit pair is legal  
4. Overlay range (if any) uses the same unit as the canonical value  

Otherwise: Pending or “Needs review.”

---

## 4. Agents — names, keep/fold, instructions

Internal **ids stay** (`agent1`, `data_review`, …) until a storage migration. **Say the new names.** Instruction text in `server.ts`, `FullScreenInstructionViewer`, `custom_system_instruction_*` is **not deleted**. Retired *picks* **alias** to the owner pack.

### 4.1 Names

| Say | Id / menu today | Fate |
|---|---|---|
| **Lab Parser** | `medical`, `medical_extract`, extract half of `agent1` | Keep as parse-only |
| **Review** | `biomarker_review` | Generalist for **1–5 keys** |
| **Name Deduper** | Name Consolidation (`agent3` folded) | Specialist 20+ |
| **Categoriser** | Medical Categorisation (`agent2` folded) | Specialist 20+ |
| **Unit Relabel** | Standardize Units | Specialist 20+; **relabel only** |
| **Field Compare** | Data Accuracy | Specialist 20+ |
| **Range Calibrator** | `data_review` (menu “Standardize Biomarkers” folded) | Overlay only; 20+ or silent one-key |
| **Health Coach** | `health_baseline` | Approved + unflagged only |
| **Test Planner** | `agent4` | Untouched |
| **Literature** | `agent7` | Untouched |
| **Front Desk** | `front_desk` | Route / profile; **no lab rows** |
| **Dictionary** | Dictionary UI | Human gate |

**Removed as destinations:** `agent3`, `agent5` (ranges lie), `medical_extract` as a second pick, Standardize Biomarkers label, front_desk-as-logger.  
**`agent5` range language** moves onto Calibrator. Blurb may feed Coach.  
**`agent1` / `agent2`** not user destinations; extract → Parser, ontology → Categoriser.

### 4.2 Role matrix (jobs stay even when names fold)

| Role | Owner | n=1–5 | n≥20 |
|---|---|---|---|
| Parse | Lab Parser | Composed into Review/Add | Parser only (chunked) |
| Identity | `getMappedBiomarkerKey` + catalog | Same | Same |
| Dedupe names | Name Deduper | Slice inside Review | Deduper only |
| Categorise | Categoriser | Slice inside Review | Categoriser only |
| Relabel unit | Unit Relabel | Mode on Review | Unit Relabel only |
| Convert / fix number | **Review only** | Review | Review on **flagged subset** |
| Field diff | Field Compare | Before/after in Review | Field Compare only |
| Overlay ranges | Range Calibrator | Auto if `rangeVariesBy` + overlay stale (silent or Review `proposal`) | Calibrator on that subset |
| Approve | Human Dictionary | One click | Queue |
| Coach / plan / literature | those agents | After clean | After clean |

### 4.3 Dispatcher

```text
scope = selected or flagged keys

n = 1–5:
  one Review (or Add) session
  composed slices — NOT concatenated specialist novels
  optional silent Calibrator on that key if overlay required (see §5)

n = 10–50 (one report):
  Lab Parser (chunks) → identity code → Pending leftovers
  Review on flagged only
  Calibrator on stale overlay ∩ rangeVariesBy

n ≥ 20–100 dictionary hygiene:
  exactly one specialist pack per run
```

### 4.4 Instruction law

- Do **not** paste Parser 8.8k + Calibrator 8.8k + Units + Deduper into Review.  
- Review core (~4.1k) + ~2k slices (alias, one category, relabel **xor** convert). One JSON: `modificationCommand` + `proposal`.  
- Full Calibrator 8.8k stays on `data_review`. Review `proposal.range` is the compact overlay.  
- Opposite rules stay in different packs: Parser **no math**; Review **may convert**; Unit Relabel **no numbers**; Calibrator **no log numbers**.  
- `custom_system_instruction_agent2` etc. remain valid via alias.

---

## 5. When to run Range Calibrator (you do not guess)

Catalog = standard definition + **standard** range.  
Calibrator = **this profile** (age, sex, ethnicity). A key already in the dictionary can still need it.

You cannot see “will the range move?” without a table or a model. **The user never chooses.**

| Gate | Action |
|---|---|
| `rangeVariesBy` empty | Use catalog default. Do not run Calibrator |
| Symptom / AUDIT scores | Never ethnicity-calibrate (baseline 0 / AUDIT cutoffs in pack) |
| Overlay exists and profile fingerprint matches | Skip |
| Overlay missing or fingerprint changed, and `rangeVariesBy` intersects the change | **Run** (n=1: silent one-key; n≥20: batch those keys only) |
| Untagged new key, n=1 | Run compact overlay once; write back `rangeVariesBy` or `same_as_catalog` |
| Untagged, n≥20 | Cheap yes/no preflight, then full pack on `yes` only |

Seed `rangeVariesBy` (code, not LLM): BMI/ethnicity; Hb/Hct/ferritin/creatinine/uric acid/hormones/sex; eGFR/age; lipids/ethnicity optional. Sodium/many enzymes = `[]`.

BMI Asian cutoffs already exist in Home — they belong on catalog/overlay, not a one-off in the UI.

---

## 6. Unit vs value (non-negotiable)

Every unit edit is exactly one of:

- **`relabel`** — change catalog/display unit (and range *text* if it only names the unit). Numbers stay.  
- **`convert`** — rewrite canonical numbers with a named factor; keep `rawValue`/`rawUnit`. Review only.

Standardize Units = relabel. Ignore `conversionFactor` for writes.  
`setBiomarkerHistory` must **stop** remapping, same-day-merging, and `normalizeHistoricalTelemetryErrors` rewrites. Flagger stays. Sodium→143 and silent cholesterol `/38.67` go away as side effects.

---

## 7. Add-one-biomarker (user sees one session)

Example: “ApoB 90 mg/dL on 13 Aug.”

1. **Review/Add** extracts raw row (verbatim).  
2. Catalog hit → write observation; relabel **or** convert if unit fights dictionary.  
3. Catalog miss → **Pending** + suggested key/unit/category/default range. **Human approve.** No Categoriser chat.  
4. If `rangeVariesBy` and overlay stale → silent one-key Calibrator (or `proposal`).  
5. Home/coach only after approved + unflagged.

Two **model** calls possible (Review + silent Calibrator). Not five agents.

Whole PDF → Lab Parser (chunks), not this path.

---

## 8. Current code (honest)

| Symptom | Cause |
|---|---|
| Ghost / rematerialize | Current map last-write-wins; alias not tombstoned; built-ins always exist; dead `biomarker_dictionary_store` |
| Duplicates | Writers skip `getMappedBiomarkerKey`; front_desk always `push`; date `DD-MM-YYYY` vs ISO |
| Hallucinated keys/values | No source guard; agent1 invents slugs; sodium sanitize → 143 |
| Can’t delete | Locked bmi/weight/height logs; built-in rematerialize; sync union on equal `updated_at` |
| Deleted wrongly | agent1 fuzzy score≥40; `isValEmpty` treats `0` as empty; same-day merge last-wins |
| Number moves alone | `setBiomarkerHistory` → sanitize rewrite |
| Unit change also changes number | Relabel then sanitize/Review/US-save convert; no mode |
| Approval is fake | `isBiomarkerApproved` = five fields; agents auto-clear `needsApproval` |
| Home/coach on junk | No approval/flag gate |
| Review apply miss | `onAgentFinish` wants `corrections`; model emits `modificationCommand` |

Write map (today) stays in `docs/agent/domains/biomarkers.md` § write map until slices land.

---

## 9. Goldens (after Slice 0–2)

**Taxonomy:** lifecycle stages are UX/dispatch. Goldens group by **class** (Weiskopf DQ + auto-bugs), not by job. Build plan: `BIOMARKER_INGEST_AND_GOLDENS_PLAN.md` §1.2.

Inbox: **Food | Biomarkers**. Do not clone meal kcal tables. Group the biomarker tab by **class**, then example.

Pin: `domain=biomarkers`, `class`, `agentId`, `lifecycleStage`, `jobId`, `scopeKeys`, `asOf`, history+def slice, fingerprint.

Board: observation table (key, date, raw, canonical, unit) + events + definition + batch cursor + **class**.

First fixture: `job_medical_1786660190499` (HDL/TG/LDL/bili unit mix) — example of `SILENT_REWRITE` + `APPLY_MISS`. Auto-bugs: impossible pair, 15× shift, apply didn’t land, silent sanitize would rewrite, pending on Home.

Replay = class unit test first, then frozen example. Not food NEW Analyze. Work item is the class, not “make this job all-green.”

---

## 10. Implementation slices

Do not delete instruction files. Goldens are Slice 4 — they are now unblocked for the HDL/TG unit-mix case, but the inbox itself is not built.

Status key: **landed** = in Desktop tree · **partial** = code exists, product gap remains · **open** = not done.

### Slice 0 — Contract (no new UI) — **landed, one leftover**

- Types: catalog / pending / overlay / observation (additive; logs can stay unitless until Slice 2) — **landed (additive)**  
- Approval = catalog flag, not five fields — **landed** (`isBiomarkerApproved` / `isPendingCatalogApproval`)  
- `setBiomarkerHistory`: **no** remap/merge/sanitize rewrite (flag only) — **landed**  
- Unify Review apply: `modificationCommand` + `toYYYYMMDD` — **landed** (plus synthesize-from-history when the model omits the array)  
- Relabel vs convert enum on unit apply — **open**  
- Display names in `agentConfig` + dictionary menu (ids unchanged) — **landed**

**Gate:** identity + sanitize tests updated so sanitize-on-set no longer *must* rewrite; Review apply test for `modificationCommand`.

### Slice 1 — Dictionary is the gate — **partial**

- Seed catalog from built-ins + `rangeVariesBy` — **partial** (built-ins exist; `rangeVariesBy` seeded in code, not a first-class catalog row)  
- Extract → pending if unknown; `getMappedBiomarkerKey` if hit — **partial** (mapped hits no longer become pending; unknown names still write `customBiomarkers[new_slug]`)  
- Parser/agent1/front_desk **stop** creating catalog keys — **partial** (built-ins skipped; unknown slugs still created)  
- Dictionary: approve / alias-map / reject — **partial** (one-click Approve / Auto-Calibrate **removed**; Save still edits the blended bag)  
- Hide `agent1`/`agent2`/`agent3`/`agent5`/`medical_extract` as destinations — **partial** (redirects exist; Insights may still open Lab Parser for report extract — intentional)  
- Alias instruction keys — **landed**  
- Kill writes to `biomarker_dictionary_store` (read once to migrate pending) — **landed** (writes stopped; migrate-then-drop still open)

### Slice 2 — Clean without destroying numbers — **partial**

- Per-log unit **or** conversion event — **partial** (`observationMeta` on **new** writes only; historical rows still bare numbers)  
- Unit Relabel does not convert — **open** as a dedicated UI/agent path  
- Review only number writer — **landed** for the Review apply path; `normalizeHistoricalTelemetryErrors` still exists in code (Home button removed)  
- ISO dates on ingest; same-day merge **on ingest only** if same `sourceReportId` — never average two labs — **partial**  
- `isValEmpty`: `0` is a value — **landed**  
- Extend flagger (HDL/LDL/TG/bilirubin) — **do not** auto-convert them — **landed** (flag + Review table convert; no silent `/38.67`)

### Slice 3 — Overlay + use surfaces — **partial**

- Calibrator writes overlay only — **partial** (data_review overlay-only path landed; Insights/dictionary still have leftover overlay-adjacent UI)  
- Auto-run policy §5 — **open** (helper `shouldRunCalibrator` exists; no silent one-key product)  
- Home, coach, food: approved + unflagged — **landed** for new payloads  
- Nutrient objectives rebuilt only from that set — **partial**

### Slice 4 — Goldens + Biomarkers inbox — **open**

- Domain pack, G-B1 from the medical debug job  
- Dispatcher by `scopeKeys.length`

---

## 11. Out of scope (this plan)

- Renaming storage ids (`agent4` → `test_planner`)  
- Deleting `server.ts` instruction blocks  
- Full LOINC/UCUM adoption  
- Rewriting Insights accordion in Slice 0  
- Food pipeline changes  

---

## 12. Doc map (after this plan)

| File | Role |
|---|---|
| **This file** | Architecture, literature, slices, **§13 remaining** |
| `docs/agent/domains/biomarkers.md` | Laws + current write map (protected) |
| `docs/agent/DOMAIN_REGRESSION_MAP.md` | Which tests |
| `AI_HANDOVER.md` | WIP / which slice is active |
| `studio/M31_BIOMARKER_LIFECYCLE_REMAINING_MULTIPASS.md` | **AI Studio pack** — paste §A; implements §13 P0–P8 |
| `plan/BIOMARKER_INGEST_ROUTER_PLAN.md` | Front door: classifier / leftover Parser / failure modes |
| `plan/BIOMARKER_INGEST_AND_GOLDENS_PLAN.md` | **Build** — class-first goldens (UX lifecycle ≠ test taxonomy) + ingest router. Does not replace §13. |
| `plan/BIOMARKER_IMPLEMENTATION_ROADMAP.md` | **Order of work** — Waves 0–7 + PR cut. |

When a slice changes an invariant, update the rulebook **in the same change** (`AGENTS.md` §3).

---

## 13. Remaining work (2026-08-14)

Walk this list in order. Do **not** start another agent rewrite, Calibrator UI, or food work to “finish biomarkers.” Confirm Apply, then clean leftover data, then Slice 2 backfill, then Slice 4 so this class of bug cannot regress.

### 13.1 Smoke (do next — no new design)

- [ ] Reopen the existing Review job (refresh first). The apply card must show five convert rows, not only the essay:
  - HDL-C `50` → `1.293` mmol/L on 14-08-2026
  - Triglycerides `125` → `1.411` mmol/L
  - LDL-C `130` → `3.362` mmol/L
  - Creatinine `0.9` → `79.56` µmol/L
  - Total Bilirubin `0.8` → `13.68` µmol/L
- [ ] Click Apply. Confirm Medical History + Home show the converted numbers, raw is kept on `observationMeta`, and the Home telemetry banner drops those five keys.
- [ ] Confirm older SI rows are **untouched** (HDL 1.43, creat 100/72, bili 16/13).
- [ ] Confirm Home no longer shows Auto-Fix Historical Scaling, Inspect Card, Review in Medical History, or Edit Logs in Medical History.
- [ ] Confirm Dictionary no longer shows Auto-Calibrate, Auto-Fill Defaults, Quick Approve, Approve, Approve Selected, or Save & Approve.

### 13.2 Leftover data on this profile (cleanup, not new architecture)

These are already in `customBiomarkers` / history from older extract+sync. The **pending count** no longer inflates from missing fields, but the junk rows remain until cleaned.

- [ ] One-time cleanup of leftover pending slugs: map aliases (`hdl_c`, unit-suffixed names) onto catalog keys; tombstone the duplicate key.
- [ ] Drop empty ghosts (`metric_N`, `needsApproval` with no history and no unit). `dataSanitize` already proposes this — run / apply it.
- [ ] Clear stale `needsApproval` on catalog-mapped keys (built-in overlay leftover). Display already ignores them; stored flags should go.
- [ ] Delete invented ethnicity `customRanges` that became `< 0 U/L` (auto-calibrate leftover). Do not invent replacements.
- [ ] Stop Lab Parser / LogChat / Insights from writing `customBiomarkers[new_slug]` for unknown printed names. Target: Pending observation only (plan §2.2). Mapped hits already skip.

### 13.3 Slice leftovers (product gaps)

**Contract / units**

- [ ] Relabel XOR convert as a first-class mode on any unit edit (plan §6). Relabel never rewrites numbers. Convert is Review + named table factor + keep raw.
- [ ] Backfill `observationMeta` (rawValue, rawUnit, printedRange, labFlag) onto **all** historical rows, not only new extracts. Until this, US/SI mixups stay flag-only unless Review runs.
- [ ] Observation identity `(canonicalKey, date, sourceReportId)` — re-parse of the same report is upsert, not a second row.
- [ ] Same calendar day ≠ average. Ingest merge only when `sourceReportId` matches. Two labs on the same date stay two observations.
- [ ] ISO dates on ingest; display may stay DD-MM-YYYY.
- [ ] Remove or permanently disable `normalizeHistoricalTelemetryErrors` as a writer (Home button is gone; the function must not come back on another surface).

**Dictionary / pending store**

- [ ] Real Pending store (this user, unknown printed name + raw value/unit/date/source). Not `customBiomarkers[new_slug]`.
- [ ] Human Dictionary is the only approve / alias-map / reject path. Agents propose. No one-click dummy approve.
- [ ] Seed catalog rows with `rangeVariesBy` as data, not only a helper map.
- [ ] Migrate then drop `biomarker_dictionary_store`.
- [ ] Name Deduper pass on leftover unit-suffixed / alias duplicates after the one-time cleanup.

**Overlay / live surfaces**

- [ ] Overlay as its own record (range / optimal / brackets + age-band fingerprint). Stop smashing printed / catalog / overlay.
- [ ] Silent one-key Range Calibrator when `rangeVariesBy` is set **and** overlay fingerprint is missing/stale (§5). User does not pick Calibrator.
- [ ] Do **not** restore Auto-Calibrate or ethnicity-invented ranges.
- [ ] Nutrient objectives rebuilt only from approved + unflagged observations (finish any food-badge / target path that still reads flagged or pending keys).

**Dispatcher / agents**

- [ ] n = 1–5 → one Review/Add session (composed slices, not concatenated specialist novels).
- [ ] n = 10–50 (one report) → Lab Parser chunks → identity → Pending leftovers → Review on **flagged only**.
- [ ] n ≥ 20 dictionary hygiene → exactly one specialist pack per run.
- [ ] Keep instruction packs. Do not delete `server.ts` / `custom_system_instruction_*`. Do not paste Calibrator 8.8k into Review.

### 13.4 Slice 4 — Goldens + Biomarkers inbox (**not started**)

Do not clone food kcal tables.

- [ ] Food | Biomarkers inbox in the golden UI.
- [ ] Pin G-B1 from `job_medical_1786660190499` **and** the later `job_medical_1786666223594` (same HDL 50 / TG 125 / LDL 130 / creat 0.9 / bili 0.8 vs SI history).
- [ ] Board: observation table (key, date, raw, canonical, unit) + events + definition + batch cursor.
- [ ] Auto-list bugs: impossible pair, 15× shift, apply didn’t land, silent sanitize would rewrite, pending on Home, Review essay with empty `modificationCommand`.
- [ ] Replay = re-parse frozen medical log **or** re-run the same agent on the frozen slice. Not food NEW Analyze.
- [ ] Gate: Review with empty `modificationCommand` still produces the five convert rows; Apply lands; SI history unchanged.

### 13.5 Still true from §8 (not fully retired)

These symptoms are **reduced**, not gone. Treat each as a remaining bug until a golden says otherwise.

| Symptom | Still to do |
|---|---|
| Ghost / rematerialize | Tombstone aliases; stop built-in rematerialize via custom overlay |
| Duplicates | Every writer must call `getMappedBiomarkerKey`; Name Deduper on leftovers |
| Hallucinated keys | Parser must not invent slugs; unknown → Pending only |
| Can’t delete / bounce | Same tombstone rules on every remove; sync must not resurrect `needsApproval` (newer-wins landed — soak) |
| Number moves alone | Keep sanitize flag-only; no new silent writers |
| Unit change also changes number | Relabel XOR convert UI (still open) |
| Approval is fake | Pending count fixed; leftover flags + slug-as-catalog still to clean |
| Home/coach on junk | New payloads gated; soak old profile after cleanup |
| Review apply miss | Synthesize-from-history landed; **Apply smoke still required** |

### 13.6 Out of scope (do not put on this remaining list)

Unchanged from §11: renaming storage ids, deleting instruction blocks, full LOINC/UCUM, Insights accordion rewrite, food pipeline / lassi / picnic goldens, GitHub push (process, not this architecture).

### 13.7 Definition of done for this plan

The biomarker track is done when:

1. Apply of the five 14-08-2026 converts is verified on the live profile.  
2. Unknown extract names never become catalog keys.  
3. Every historical observation has a unit (or an explicit “unit unknown” flag).  
4. Relabel cannot rewrite a number.  
5. G-B1 golden is pinned and replay-green.  
6. Home / coach / food badges never consume pending or flagged values.

Until then, new health-planning agents stay blocked on dirty telemetry.
