# Biomarker ingest router — how agent work changes

**Pillar:** 1 — Biomarkers. Map: `plan/README.md`. Execute: `BIOMARKER_IMPLEMENTATION_ROADMAP.md`.

**Status:** Design from 2026-08-16 review. Not started.  
**Parent:** `plan/BIOMARKER_LIFECYCLE_PLAN.md` (layers, roles, laws). This file does **not** replace that plan. It specifies the missing front door: how raw user input becomes observations, and what Lab Parser / Review actually see.  
**Build plan (class-first goldens + slices, debug):** `plan/BIOMARKER_INGEST_AND_GOLDENS_PLAN.md`  
**Rulebook:** `docs/agent/domains/biomarkers.md`  
**Do not implement this as one PR.** Implement via the build plan I0–I9, not §9 here alone.

---

## 0. Why this exists

Today every add-biomarker path dumps the raw payload into Lab Parser (`agent1_step1` / `medical`). The model:

- Re-reads the same CSV in `Chat History:` **and** `USER RAW DATA:`
- Echoes unparsed rows back as `remainingText` (22k output chars on the diagnostic job)
- Carries symptom-diary rules (HDSS / GERD / multi-day) on lab reports
- Invents `updated_at`
- Does identity, chunking, and qualitative judgement in one call

That is why a clean 115-row NHS/EMIS table costs 15–25s and three 50-item chunks.

The lifecycle plan already says the right order:

```text
parse → identity → clean → approve → overlay → use
```

Code still asks the LLM to do all five. This plan puts a **deterministic ingest router** in front of the agents so they only do the work that actually needs a model.

---

## 1. Target shape

```text
User input (text / table / photo / PDF / chat / Health Connect / UI)
        │
        ▼
┌───────────────────────────────────────┐
│  0. Source classifier (no LLM)        │
│     table | prose | image | structured│
│     | symptom | bypass                │
└──────────────────┬────────────────────┘
                   │
     ┌─────────────┼──────────────┐
     ▼             ▼              ▼
  bypass        table          image/PDF
  (Health       lexer          vision extract
   Connect,     (no LLM)       → same row
   Home UI,                    contract
   Dictionary)
                   │              │
                   ▼              ▼
        ┌──────────────────────────────────┐
        │  1. Row contract                 │
        │  printedName, date, rawValue,    │
        │  rawUnit, printedRange, comment, │
        │  sourceKind, sourceRowIndex      │
        └──────────────────┬───────────────┘
                           ▼
        ┌──────────────────────────────────┐
        │  2. Identity + unit-family gate  │
        │  catalog key / alias / custom    │
        │  name+unit family+plausibility   │
        └──────────────────┬───────────────┘
                           │
           ┌───────────────┼────────────────┐
           ▼               ▼                ▼
     high-confidence   flagged          unmatched
     (write obs,       (Review on       (Lab Parser
      no LLM)           that subset)     on that subset)
           │               │                │
           └───────────────┴────────────────┘
                           ▼
              pending new keys → Dictionary
              learned aliases  → proposal only
              stale overlay    → Calibrator (unchanged)
```

**Hard rule:** high-confidence rows are invisible to every agent. There is no `approve_all` over 90 pre-parsed items.

---

## 2. How each agent's job changes

Agent **ids stay**. Instruction packs stay. What changes is *when they run, what they are given, and what they are allowed to emit*.

### 2.1 Lab Parser (`medical` / `agent1_step1` / `medical_extract`)

| | Today | After |
|---|---|---|
| Trigger | Any medical paste, photo, or “continue” | Only `unmatched` + `prose` + `symptom` + vision leftovers |
| Input | Full raw report + history + remaining text + 11k system prompt (labs **and** HDSS/GERD) | Compact pack for **this source kind only**. Rows already structured. No matched rows. |
| Job | Character-level extract of everything, invent keys, echo remainder | Map leftovers to a key **or** a pending suggestion. Extract value/unit/date verbatim. |
| Output | `extractedData[]` for the whole report + `remainingText` copy of the tail | `new_mappings[]` + `pending[]` only. **No `remainingText`.** Server owns the cursor. |
| Forbidden | Math, unit conversion (already law) | Same, plus rewriting a high-confidence row, inventing `updated_at` |

Two instruction packs, never concatenated:

- **`lab_extract`** — structured / leftover lab rows. No symptom-diary rules.
- **`symptom_diary`** — HDSS / GERD / joint pain, score 0–3, multi-day expansion. Only when the classifier says `symptom` or Front Desk routed a diary line.

Chunking moves off the model. If leftovers still exceed a token budget, the **server** slices by `sourceRowIndex` and calls Parser again. The model never copies unparsed text.

### 2.2 Review (`biomarker_review`)

| | Today | After |
|---|---|---|
| Trigger | User opens Review on 1–5 keys, or a later hygiene pass | Auto on **flagged ingest subset** (unit-family miss, implausible value, caveat comment). Still the destination for manual “fix this key”. |
| Input | Scoped current + history for those keys (already partly done) | Same, plus the pre-parser flag (`why_flagged`: unit mismatch, 15× range, comment mentions formula change, composite parse). |
| Job | Relabel xor convert; `modificationCommand` | Unchanged. Still the **only** agent that may rewrite a stored number. |
| Must not | Rubber-stamp 90 good rows | Same. If a row is not flagged, Review is not invoked. |

Parser and Review stay opposite packs: Parser **no math**; Review **may convert** via the per-analyte table.

### 2.3 Range Calibrator (`data_review`)

No change to role. Still overlay only. Still auto-runs when `rangeVariesBy` intersects a stale fingerprint.

Ingest change: Calibrator is **not** in the extract path. A 115-row CSV must not pull the 8.8k calibrator novel. After observations land, the existing gate decides whether a silent one-key or batch overlay run is needed.

### 2.4 Categoriser / Name Deduper / Unit Relabel

No change to role. They remain dictionary-hygiene specialists (n≥20), not part of first ingest.

Parser must not categorise. A new pending key does not get `riskCategories` from the extract call.

### 2.5 Front Desk (`front_desk`)

Stays a router. **Still must not write lab rows.**

New duty: classify intent and hand off.

| User says / does | Front Desk does |
|---|---|
| Pastes a table or “here is my bloods” | Route to Lab Parser **after** the ingest router (so a clean CSV may never reach an LLM) |
| “Blood in stool the last few days” | Route to `symptom_diary` pack |
| Photo of a report | Route to vision extract → same row contract |
| “Change my height to 163” | Profile update, not a lab observation |
| “What does my ALT mean?” | Answer / send to Coach. No extract. |

### 2.6 Dictionary (human)

Unchanged owner of permanence.

New queue items the ingest path may create:

- **Pending key** — printed name we have never seen.
- **Proposed alias** — Parser mapped `HbA1c levl - IFCC standardised` → `hba1c`. Shown as “add this print name as an alias?” not silently written.

Agents never auto-promote aliases. One wrong silent write (urine albumin → albumin) poisons every later upload.

### 2.7 Health Coach / Test Planner / Literature

No ingest change. They still read **approved + unflagged** observations only. Faster extract must not put pending or unit-flagged values on Home.

### 2.8 Work that disappears

These jobs stop existing as model work:

- Re-extracting `Serum sodium 143 mmol/L` when `serum_sodium` + `mmol/L` is already known
- Copying 80 unparsed CSV lines into JSON
- Inventing Unix timestamps
- Deciding whether “Renal profile” is a biomarker (empty Result + known panel header → skip, keep comment as a note)
- 50-item “continue?” loops on a well-formed table

---

## 3. Shared row contract

Every source that can produce observations must emit the same object **before** identity. Agents never see raw CSV characters if a lexer already succeeded.

```ts
type IngestRow = {
  sourceKind: 'table' | 'prose' | 'image' | 'structured' | 'symptom';
  sourceRowIndex?: number;          // table / leftover cursor
  sourceReportId: string;           // job id; upsert identity
  printedName: string;              // never drop
  date: string | null;              // per-row ISO; inherit previous table date if blank
  rawValue: number | string | null; // verbatim; 0 is a value
  rawUnit: string;                  // verbatim; '' if none
  qualitativeValue?: string;        // NEGATIVE, TRACE, '109 / 53'
  printedRange?: string;
  labFlag?: string;                 // H / L / from comment if explicit
  comment?: string;
  excerpt?: string;                 // short source snippet for Review
};
```

Identity output (code, not LLM):

```ts
type IdentityDecision =
  | { bucket: 'high_confidence'; key: string; reason: 'exact_key' | 'alias' | 'custom_name' }
  | { bucket: 'flagged'; key?: string; why: FlagReason }
  | { bucket: 'unmatched' }
  | { bucket: 'skip'; why: 'panel_header' | 'empty' | 'tombstoned' };
```

**High-confidence requires all three:** name match (see §4) **and** unit family match **and** value not implausible (`isBiomarkerValueImprobable` / convert-table pair).

Store on write: `rawValue` + `rawUnit` + `printedRange` + `printedName`. Canonical value is filled only when the convert table knows the pair. Otherwise leave canonical empty and flag — do not guess `/38.67`.

Observation identity stays `(canonicalKey, date, sourceReportId)`. Same calendar day from the **same** extract upserts. Two labs on 13 Aug stay two rows.

---

## 4. Identity matcher (what “recognised” means)

`getMappedBiomarkerKey` today is exact-slug against the 29 built-ins only. It does **not** read `customBiomarkers`. A probe of the NHS list got **10 / 65** unique names. The matcher has to grow or the router does almost nothing.

Match order (first hit wins; longer printed name wins over a shorter token):

1. Exact catalog key / name (punctuation-stripped, UK/US spelling fold: haemoglobin→hemoglobin).
2. Exact alias on the catalog **or** `CUSTOM_KEY_ALIASES`.
3. Exact custom key / custom display name / custom alias on **this profile**.
4. Whole-token contains of a catalog key (`hba1c` inside `hba1c levl ifcc standardised`; `egfr` inside `egfrcreat ckd-epi`). Reject if a **longer** catalog token also matches (`cholesterol/hdl ratio` beats `cholesterol`).
5. Stop. Do not Levenshtein-auto-approve.

Specimen / matrix guard: `urine` / `serum` / `saliva` / `free` / `total` / `adjusted` / `non-hdl` in the printed name must agree with the candidate key. `Serum albumin` ≠ future urine albumin. `Serum calcium` ≠ `Serum adjusted calcium`.

Unit family (examples, not exhaustive):

| Family | Members |
|---|---|
| count_e9 | `10^9/L`, `109/L`, `K/uL`, `x10^9/L` |
| count_e12 | `10^12/L`, `1012/L`, `M/uL` |
| fraction_or_pct | `L/L` hematocrit 0.48 ↔ `%` 48 — convert table, not string equality |
| lipids_molar | `mmol/L` for chol / HDL / LDL / trig |
| lipids_mass | `mg/dL` for the same |
| hba1c | `%` vs `mmol/mol` — IFCC formula only, already in `unitConversion.ts` |

Name match + wrong family → `flagged`, not high-confidence. That is how `triglycerides 1.7 mmol/L` against catalog `mg/dL` avoids being stored as 1.7 and marked Optimal.

---

## 5. Source classifier — whole input range

Classifier is code. It runs before any agent. Mixed payloads are split, not forced into one path.

### 5.1 Decision table

| # | What the user does | Classifier | Deterministic work | Agent? |
|---|---|---|---|---|
| 1 | Pastes NHS/EMIS CSV (`Date,Test Name,Result,Normal Range,Comment`) | `table` | RFC 4180 lexer, per-row date, alias match | Parser **only** on unmatched / qualitative-in-comment / questionnaires. Review **only** on unit/plausibility flags. |
| 2 | Pastes TSV / pipe / another portal table (Quest, LabCorp, private UK) | `table` if headers sniff; else `prose` | Same lexer + header map | Fail-open: unparseable lines → Parser |
| 3 | Pastes a table **plus** a sentence (“the ALT is the one I care about”) | split: `table` + `prose` | Table as (1). Sentence is overlay, not a second full extract | Parser on the sentence only if it contains a new reading |
| 4 | Photo / screenshot of a report | `image` | none yet | **Vision extract** to the row contract, then the **same** matcher. No CSV lexer on pixels. |
| 5 | Multi-page PDF / several photos | `image` | page/image list | Vision per page → rows → matcher. Server concatenates rows; no `remainingText`. |
| 6 | Chat one-liner: “ALT was 41 last Tuesday” | `prose` | date parse if explicit | Lab Parser `lab_extract` on that sentence. Tiny prompt. No diary pack. |
| 7 | Symptom diary: “blood in stool the last few days” | `symptom` | none | `symptom_diary` pack only (score + multi-day). Must not run on (1). |
| 8 | Mixed: photo + “also I have heartburn” | `image` + `symptom` | matcher on vision rows | Vision leftovers → `lab_extract`. Heartburn → `symptom_diary`. Two small calls, not one mega-prompt. |
| 9 | “continue” on a long paste | n/a | server advances `lastProcessedIndex` | Same agent as the original leftover bucket. Model does not search the previous JSON inside the raw file. |
| 10 | Google / Apple Health steps (or later vitals) | `structured` **bypass** | write `steps` (etc.) as observations | **No Lab Parser.** Already a key+value. |
| 11 | Manual Home / dictionary add or edit | `structured` **bypass** | write / overlay via UI | No extract agent. |
| 12 | Front Desk general chat | bypass | route only | Front Desk. No lab rows. |
| 13 | User opens Review on one key | n/a | load that key’s logs | Review as today. |
| 14 | User runs Calibrator / Categoriser / Deduper | n/a | batch keys | Unchanged specialist packs. |
| 15 | Nutrition label paste | **not this pipeline** | `parseMenuNutritionPaste` | Food catalog. Do not invent a second biomarker path. |
| 16 | FR / ZH / ID lab text | `prose` unless table headers recognised | English/NHS token matcher will mostly miss | Parser gets the unmatched rows. Do not fuzzy-match across languages in v1. |
| 17 | Same file spanning 2020–2026 | `table` | **per-row** dates; no file-level date | — |
| 18 | Empty panel headers, GPPAQ names-as-answers, infection tests with blank Result | `table` | skip headers; qualitative tokens from Comment; GPPAQ → unmatched | Parser for GPPAQ / AUDIT items / HIV-in-comment. |

### 5.2 Worked example — the NHS list from the review

This is the file that triggered the diagnostic. Expected **first** ship (after an NHS alias table, not with today’s 29-key slugger):

| Bucket | Approx. rows | Who works |
|---|---|---|
| Skip (panel / empty / point-of-care) | ~12 | Code. Keep comments as notes when they carry clinical text (“Raised — diet advice”). |
| High-confidence labs (Na, K, creat, ALT, AST, lipids in mmol/L matching catalog family, HbA1c mmol/mol, BMI, …) | majority, **after** aliases exist | Code only. 0 tokens. |
| Flagged | triglycerides/LDL if catalog unit is still `mg/dL`; hematocrit `0.48 L/L` vs `%`; any 15× outlier | Review on **those keys only** |
| Unmatched | GPPAQ, AUDIT items, FAST, HIV/COVID qualitative, QRISK/QDiabetes if not yet in catalog, PSA, pulse, BP composite | Lab Parser `lab_extract` on this short list |
| Dropped by apply today | `weight` / `height` | Fix apply (`handleLogMedical` currently ignores them). Matcher must not pretend they landed. |

Do not quote “91 rows, 0 tokens” until a golden of this file says so. Day-one without the alias table still sends most rows to Parser — the prompt is just smaller because the lexer already split columns.

### 5.3 Image / PDF path (the other high-volume input)

```text
photo/PDF
  → vision model: "return IngestRow[] only. no keys. no remainingText."
  → same identity gate as a CSV
  → high-confidence write
  → leftovers to Lab Parser (already rows, not pixels)
```

Vision is allowed to **segment** a page into rows. It is not allowed to choose canonical keys if the matcher can. If vision returns garbage columns, those rows are `unmatched`, not silently stored.

### 5.4 Symptom path (must stay separate)

Classifier cues: no table headers, first-person symptom language, no numeric lab shape, or Front Desk tag.

Parser here **may** quantify 0–3 and expand “the last few days” using `CURRENT DATE`. That pack is forbidden on sourceKind `table` / `image` leftovers. A CSV must never create HDSS rows.

### 5.5 Structured bypass

Google Health steps, later Health Connect vitals, and typed Home fields already have a key. Running Lab Parser over them is how you get duplicate `steps` keys and invented dates. Router writes the observation and stops.

---

## 6. What the agent is actually sent

### 6.1 Lab Parser (`lab_extract`) — leftover only

```text
EXISTING KEYS: canonical built-ins + approved custom keys
  (no metric_01…metric_60, no duplicate aliases)

UNMATCHED ROWS:
  [ { i: 14, date: "2026-06-09", printedName: "Chlamydia DNA detection",
      rawValue: null, comment: "NEGATIVE" }, ... ]

FLAGGED (context only, do not re-extract):
  [ { i: 41, printedName: "Serum triglycerides", rawValue: 1.7,
      rawUnit: "mmol/L", catalogKey: "triglycerides",
      catalogUnit: "mg/dL", why: "unit_family_mismatch" } ]
```

Flagged rows are listed so Parser does not invent a parallel key. Parser does **not** convert them. Review does.

Response schema (delta):

```json
{
  "text": "string",
  "new_mappings": [
    {
      "sourceRowIndex": 14,
      "biomarker": "chlamydia_dna",
      "display_name": "Chlamydia DNA",
      "numeric_value": null,
      "qualitative_value": "NEGATIVE",
      "unit": "",
      "date": "2026-06-09",
      "explanation": "qualitative in comment"
    }
  ],
  "proposed_aliases": [
    { "printedName": "HbA1c levl - IFCC standardised", "key": "hba1c" }
  ]
}
```

Removed from the schema: `updated_at`, `remainingText`, `hasMoreMarkers`, `estimatedTotalMarkers`. Server stamps time. Server knows if more leftover rows exist.

### 6.2 Review — flagged only

Same `modificationCommand` + optional `proposal` as today. Input is the flagged subset plus `why_flagged`. Empty `corrections` is still not a no-op when commands exist (existing law).

### 6.3 Prompt construction bugs that this plan also kills

Independent of the matcher; do these even if identity ships later:

1. Raw payload lives in **one** place (`USER RAW DATA` or the unmatched-row JSON). Never also inside `Chat History:`.
2. Stop prepending `Chat History:` twice.
3. `Chat History` for extract jobs is routing/intent only — not the 115-row paste.

---

## 7. Apply path (after agents, still code)

`handleLogMedical` / `onAgentFinish` stay the write hub. Router writes must go through the same hub so tombstones, same-day upsert, and pending stamps stay consistent.

Fixes required so the router is not lying:

| Bug | Effect on this plan |
|---|---|
| Apply drops `weight` / `height` / `age` | Biometric rows from EMIS never land. Either stop dropping or route them to profile fields **explicitly**, not silently. |
| Apply merges any same calendar day | Correct for LFT+bone albumin on one draw. Wrong for two labs, same date, different `sourceReportId`. Gate merge on source id (lifecycle law §2.1.4). |
| New extract slugs skip `getMappedBiomarkerKey` on the custom bag | Parallel keys (`serumsodium` vs `serum_sodium`). Router + apply must share one identity function that **includes** custom names. |

Pending: unknown printed name → this user’s Medical History Pending. Not `customBiomarkers[new_slug]` as an approved Home key. `needsApproval` remains explicit.

---

## 8. Laws this plan must not break

Copied so implementers do not “simplify”:

1. Parser **no math**. Review **may convert**. Calibrator **no log numbers**.
2. Dictionary owns keys. Agents propose aliases; humans approve.
3. Three ranges never smashed (printed / catalog / overlay).
4. Convert only via the per-analyte table. Unknown pair → flag.
5. `0` is a value.
6. Do not silent-rewrite history on set.
7. Coach / Home see approved + unflagged only.
8. Front Desk writes no lab rows.
9. Instruction packs stay; do not concatenate Parser + Calibrator + Deduper into Review.
10. Food nutrition paste stays on the food pipeline.

---

## 9. Implementation slices

Not one PR. Each slice is independently shippable and golden-tested.

| Slice | What lands | Agent-visible change |
|---|---|---|
| **A** | Prompt hygiene: single raw injection, no double `Chat History:`, drop `updated_at`, replace `remainingText` with server cursor | Parser cheaper even with no matcher |
| **B** | Split `lab_extract` vs `symptom_diary` packs; classifier chooses | Lab CSV no longer carries HDSS rules |
| **C** | Table lexer + row contract + skip panel headers | Parser receives rows, not a blob — still all unmatched until D |
| **D** | Identity function used by matcher **and** apply: built-ins + aliases + custom names; unit-family gate | First high-confidence auto-writes. Parser input shrinks. |
| **E** | NHS/EMIS alias table + qualitative-in-comment + BP / AUDIT composites | This diagnostic file becomes the golden |
| **F** | Vision extract emits `IngestRow[]` then D | Photos share the matcher |
| **G** | Flagged subset → Review automatically; proposed aliases → Dictionary queue | Reviewer-only-on-errors, without `approve_all` |
| **H** | Apply fixes: weight/height policy, `sourceReportId` upsert | Router results actually persist |

Slice A–B are the original Phases 1–3. They do not depend on a matcher. Ship them first.

**Out of v1:** fuzzy auto-approve, silent alias writes, sending matched rows to the model “just in case”, one engine for photos and CSVs, language-agnostic fuzzy names.

---

## 10. Acceptance

A change is done when:

1. Golden of the NHS/EMIS paste: lexer column-splits every well-formed row; high-confidence count is asserted; triglycerides `1.7 mmol/L` is **flagged**, not stored as 1.7 against `mg/dL`; GPPAQ/AUDIT items are unmatched, not skipped; panel headers are skip+note.
2. `agent1_step1` traces on that golden show **no** high-confidence printed names in the prompt, and **no** `remainingText`.
3. A one-sentence “ALT was 41 yesterday” still reaches `lab_extract` and produces one observation.
4. “Blood in stool the last few days” still reaches `symptom_diary` and expands days. The NHS CSV does not.
5. A lab photo still produces rows (vision) and then uses the same identity function.
6. Google Health steps do not call medical-analyze.
7. New keys are pending; Home/coach unchanged until Dictionary approve + unflagged.
8. `assert-biomarker-lifecycle` / identity tests still pass; `getMappedBiomarkerKey` (or its successor) is the single identity entry.

---

## 11. Key decisions

1. **Router in front of agents, not a smarter Lab Parser.** Agents keep their ids and packs. Work is removed by not calling them.
2. **High-confidence rows never go to an LLM.** `approve_all` is rejected — it recreates token cost and yes-bias.
3. **One row contract for table, vision, and prose leftovers.** Identity is shared. Sources differ only in how they produce rows.
4. **Two Parser packs.** Symptom diary must not ride on lab extract.
5. **Unit family is part of identity.** Name-only match is how this exact CSV would poison lipids and hematocrit.
6. **Aliases are proposed, not learned silently.** Matches the Dictionary-owns-keys law.
7. **Bypass structured sources.** Health Connect and typed UI are not “reports”.
8. **Ship prompt cuts (A–B) before the matcher (D–E).** They pay down the diagnostic immediately; the matcher is worthless if apply still drops height/weight and identity ignores custom names.

---

## 12. Open questions (product, not architecture)

1. **Weight / height from a lab file:** write as observations, write to profile, or both? Today apply drops them. Need an explicit choice before slice H.
2. **Panel-header comments** (“Raised — repeat in 3 months” on `Serum lipids`): store as a note on the next lipid observation, a pending free-text, or drop?
3. **Blood pressure:** two keys (`systolic` / `diastolic`) vs one qualitative `109 / 53`. Recommend two keys; confirm before the composite extractor lands.

These do not block slices A–C.

---

## 13. Failure modes and the Layer-1 ↔ Parser handoff

This is the dangerous boundary. Layer 1 (classifier + lexer + identity) can **write without a model**. If it is wrong, Parser never sees the row and cannot save you. If it is unsure, Parser must get a structured leftover — not a guess, and not a dropped line.

### 13.1 Bias

| Error type | Who pays | Rule |
|---|---|---|
| **False high-confidence** (wrong key or wrong number written, Parser never called) | Patient / Home / Coach | **Forbidden.** Name + unit family + plausible, or do not write. |
| **False unmatched / flagged** (good row sent to Parser) | Tokens / latency | **Allowed.** This is the safe direction. |
| **Silent drop** (row had signal, neither layer saw it) | Lost clinical data | **Forbidden.** Skip only for known empty panel headers. Everything else is skip-with-note, unmatched, flagged, or reject. |
| **Parser invents a number** for an incomplete row | Same as false high-confidence | **Forbidden.** Parser maps names and reads qualitative tokens. It does not fill blanks. |

Layer 1 is therefore **conservative**. Parser is a **name/qualitative resolver**, not a second extractor of rows Layer 1 already committed.

### 13.2 Handoff object (every ingest)

Layer 1 always produces a batch, even when it writes nothing:

```ts
type IngestBatch = {
  classifier: {
    sourceKind: 'table' | 'prose' | 'image' | 'structured' | 'symptom' | 'reject';
    confidence: 'high' | 'low';
    why: string;
  };
  rows: IngestRow[];                 // every line that had any signal
  decisions: IdentityDecision[];     // parallel to rows
  highConfidence: IngestRow[];       // staged, not Home-live until user confirms batch
  flagged: { row: IngestRow; why: FlagReason }[];
  unmatched: IngestRow[];            // Parser input
  skipped: { row: IngestRow; why: string }[];
  rejected: { reason: string; excerpt: string };
  lexerHealth: {
    parsedFraction: number;          // rows with ≥ date|name|value
    shiftedColumnSuspect: boolean;
  };
};
```

**Abort table path** (treat the whole paste as `prose`, **zero** high-confidence writes) when any of:

- classifier confidence is `low`
- `parsedFraction < 0.6`
- `shiftedColumnSuspect` (dates in Result, names that look like units, >20% rows with value-in-name-column)
- sourceKind was forced to `reject` (see §13.5)

Parser then receives either structured `unmatched[]` or, if the lexer itself is untrustworthy, the **original text** under `lab_extract` with instruction: *do not invent rows; return `new_mappings` only for readings you can quote*. That is the fail-open hatch. It is still smaller than today’s dual-injected blob because history/profile/diary packs stay off.

**Parser must not** receive `highConfidence[]` for re-approval. It may receive a **count** (“82 rows already staged as standard labs”) so it does not recreate `serum_sodium` from a leftover comment.

**Flagged[]** is sent as context only: “these keys exist, do not invent a parallel key.” Parser does not convert them.

### 13.3 Incomplete input

| What arrived | Layer 1 | Parser |
|---|---|---|
| Name + empty Result + empty Comment (`Renal profile`) | `skip` known panel, or `unmatched` if unknown header | Only if unmatched. Must not invent a value. |
| Name + empty Result + qualitative in Comment (`NEGATIVE`) | `unmatched` (or high-confidence if that qualitative token is in a tiny allow-list **and** the name already maps) | Map name; copy `NEGATIVE` verbatim. |
| Name + empty Result + answer in the name (GPPAQ, SARS-CoV-2 “…negative”) | `unmatched` | May read the name. Must not invent a numeric score. |
| Value + unit, no name | `unmatched`, printedName `""` | **Refuse to guess the analyte.** Return pending or drop with explanation. |
| Name + number, no unit (`4.3` or `4.3 n/a`) | Match name; **flag** if catalog has a unit. High-confidence only for unitless scores we already know (ratios). | Does not invent `mmol/L`. |
| Name + unit, no number (`mmol/L` only, or `pending`, `insufficient sample`) | `unmatched` or `skip-with-note` | No numeric_value. May create a pending note, not a 0. `0` is only a value when the print is `0`. |
| No date on a table row | Inherit previous row’s date if the file is sorted; else `flagged` `missing_date` | Must not default to “today” for a lab table. Prose/symptom may use `CURRENT DATE`. |
| Truncated comment / cut-off CSV line (PSA, LDL in the diagnostic file) | Parse the columns that closed; rest stays in `comment` / `excerpt` | Do not complete the English sentence. |
| `<5`, `>90`, `undetectable` | Store as qualitative, or numeric bound + flag. Not a float 5. | May keep `qualitative_value: "<5"`. No math. |
| European `4,3 mmol/L` | Lexer tries `,` as decimal when there is no other comma-column; if ambiguous → unmatched | Quote as printed if still unmatched. |
| Half a paste (user selected 20 of 140 rows) | Process those 20. Do not assume missing FBC lines exist. | Same. |
| Header only, or 1–2 junk lines | `reject` or prose with no mappings | Return empty `new_mappings`. |
| Photo cropped, missing the Result column | Vision rows with empty rawValue → unmatched | Same as empty Result. Do not OCR-guess a number from a smudge. |

Incomplete is **not** “ask the model to finish the spreadsheet.” It is “stage what is printed, flag what is missing, never fill.”

### 13.4 Wrong-but-lab-shaped (the matcher’s real risk)

These look like rows. Layer 1 is tempted to write.

| Failure | Example | Layer 1 must | Parser |
|---|---|---|---|
| **False friend name** | `Urine albumin` vs serum albumin; `Free T` vs total; `Cholesterol/HDL ratio` vs cholesterol; `MCH` vs haemoglobin | Longer-token wins + specimen guard. Unit family: mg/L urine ≠ g/L serum → **flag or unmatched**, never high-confidence | Sees unmatched/flagged with `candidateKey` and `why: specimen_or_token_conflict` |
| **Shifted columns** | User re-saved CSV; Result is in Comment; dates in Test Name | `shiftedColumnSuspect` → abort table path, **zero** auto-writes | Gets original text or raw lines. Better a slow parse than 80 wrong numbers. |
| **Wrong unit, right name** | Triglycerides `1.7 mmol/L` vs catalog `mg/dL`; hematocrit `0.48 L/L` vs `%` | **Flagged**, not high-confidence | Context only. Review converts. |
| **Impossible value** | ALT `10000`, Na `14`, HbA1c `400` | **Flagged** `implausible` even if name+unit match | Context only. Review or user. |
| **User typed the wrong number** in an otherwise perfect row | ALT really 14, they typed 41 | Undetectable. High-confidence will write 41. | Does not second-guess a clean row. Mitigation is **batch confirm**, not a second LLM. |
| **Someone else’s EMIS export** / demo file | Perfect 140-row table, wrong patient | Looks high-confidence. Matcher cannot know. | Never sees it. **Batch confirm** required before Home: “Log 82 readings (2020–2026) into *this* profile?” |
| **Same file pasted twice** | Second job, same `sourceReportId` hash | Upsert `(key, date, sourceHash)`. No duplicate points. | Leftovers upsert the same pending keys. |
| **Edited row in a good file** | User changed one ALT before paste | That row writes the edited number if it still passes gates | Not a Layer-1 problem. |
| **US and UK mixed in one paste** | Hb 14.5 g/dL next to Hb 166 g/L | Each row gated separately. g/dL vs catalog g/L → flagged | No silent ×10. |
| **Qualitative vs numeric dual-use** | Protein `Negative` one day, `15 mg/dL` the next | Both legal. Different value kinds on same key. | Must not coerce `Negative` to 0. |

### 13.5 Completely wrong input (not a lab report)

| What they pasted / sent | Classifier | Layer 1 writes | Parser |
|---|---|---|---|
| Food / nutrition label | `reject` or hand to food pipeline (`parseMenuNutritionPaste`) | Nothing medical | Not called |
| “What’s for dinner” in medical chat | `reject` / Front Desk | Nothing | Not called, or Front Desk routes |
| Symptom sentence | `symptom` | Nothing yet | `symptom_diary` only |
| Random prose, no numbers, no symptoms | `reject` | Nothing | Optional one-liner: “I don’t see lab readings.” Empty mappings. |
| Photo of a clinic letter / invoice / ID | `image` → vision returns 0 rows or garbage | Zero high-confidence (lexerHealth on vision rows fails) | Empty or “this is not a results table” |
| HTML / email thread with a table buried in it | Try table extract on `<table>` / markdown; if messy → `prose` | No auto-write unless a clean table island is isolated | Prose pack on the island or full text |
| Another agent’s JSON dump | Looks structured but not Date/Test/Result | `prose` or `reject` | Do not treat keys as new biomarkers blindly |
| Empty, whitespace, or a single comma | `reject` | Nothing | Not called |
| Non-English paragraph | `prose` | Unmatched | Parser may map if it can; v1 no fuzzy cross-language identity |
| Profile chat (“I am 34, 163 cm”) | Front Desk, not Lab Parser | Profile fields only if Front Desk path | Lab Parser not invoked |

**Rule:** if Layer 1 cannot name at least one analyte **or** the classifier is `reject`/`low`, Parser’s success metric is **empty `new_mappings`**, not creativity.

### 13.6 Modality misfires (wrong door)

| Misfire | What goes wrong | Handoff |
|---|---|---|
| Photo sent, classifier thinks `prose` (caption only) | Miss the pixels | If `images[]` present, **always** run vision path in parallel. Caption is overlay prose, not a substitute. |
| Table pasted, classifier thinks `symptom` because “blood” appears | HDSS pack on a CBC | Table header wins over keyword. `Date,Test Name,Result` ⇒ `table`. |
| Symptom + accidental CSV snippet | Diary expansion on lab rows | Split: table island vs first-person sentences. Two packs. |
| Continue on a job whose lexer already finished | Old `remainingText` path re-sends the tail | Server: leftover cursor empty ⇒ “already done”, no model call. |
| User pastes labs into Front Desk | Front Desk must not write rows | Route to router. Same Layer 1. |
| User pastes labs into food chat | Food scout | Do not identity-match ALT into a meal. Reject/route. |
| Vision returns rows **and** Layer 1 also lexes the caption CSV | Duplicate observations | One `sourceReportId`. Dedup by `(printedName, date, rawValue)` before write. |

### 13.7 What Parser is allowed to do on leftovers

Allowed:

- Map `N. gonorrhoeae nucl acid detn` → suggested key + `NEGATIVE`
- Split `109 / 53 mmHg` into systolic/diastolic **or** keep qualitative
- Say “this line is a GPPAQ item, pending key `gppaq_cycling`”
- Return **no** mappings and a sentence when the leftover list is not medical

Forbidden:

- Emit a row that is not in `unmatched[]` (no “I also noticed sodium”)
- Change a flagged or high-confidence value
- Default missing dates to today on `sourceKind=table`
- Default missing values to 0, “normal”, or the printed range midpoint
- Convert units
- Auto-approve a new key onto Home

If Parser is unsure whether a leftover is a biomarker: **pending or omit**, never high-confidence.

### 13.8 User-visible recovery when Layer 1 or Parser was wrong

Auto-write is **staged** for the batch (see open question: confirm-before-Home). Recovery does not need a fourth agent:

1. Batch card lists staged high-confidence counts by date.
2. User can uncheck a date or a key before Save.
3. After Save, Review on one key still works (`modificationCommand`).
4. Re-paste of the same file upserts; it does not stack a second ALT on that day from the same hash.
5. A bad alias proposal is declined in Dictionary; it is not already in the matcher.

### 13.9 Failure goldens (add with slice D–E)

Each line is a test that must not high-confidence-write the wrong thing:

1. NHS file as-is (happy path + flags in §5.2).
2. Same file with columns rotated one to the right → **zero** auto-writes, Parser or prose.
3. `Urine albumin 12 mg/L` next to `Serum albumin 46 g/L` → two identities, no merge.
4. `Serum triglycerides 1.7 mmol/L` → flagged, not 1.7 against mg/dL.
5. Paste of a Yolk nutrition label into medical chat → reject / food route, 0 lab rows.
6. “blood in stool the last few days” → symptom pack, 0 table writes.
7. Photo + “ALT is the one I care about” → vision rows + one prose leftover; no double ALT.
8. Single cell `41` with no name → Parser refuses analyte.
9. `insufficient sample` on creatinine → no 0, no skip-without-note.
10. Re-paste identical file → upsert, observation count unchanged.

### 13.10 Key decision (handoff)

**Layer 1 may only commit when it is boring.** Anything incomplete, specimen-ambiguous, unit-mismatched, implausible, unparseable, or not-a-report goes to Parser as structured leftovers — or to reject. Parser may not invent analytes or numbers. Completely wrong *but well-formed* labs (wrong patient) are a **batch confirm** problem, not an LLM problem.

