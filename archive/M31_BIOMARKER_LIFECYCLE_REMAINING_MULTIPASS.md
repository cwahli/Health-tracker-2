# M31 — Biomarker lifecycle remaining work (MULTIPASS AUTONOMOUS)

**Plan (frozen architecture):** `plan/BIOMARKER_LIFECYCLE_PLAN.md` — especially **§13 Remaining work**.  
**Laws:** `docs/agent/domains/biomarkers.md`  
**Gates map:** `docs/agent/DOMAIN_REGRESSION_MAP.md` → Biomarkers  
**WIP board:** `AI_HANDOVER.md`  
**Kind:** MULTIPASS AUTONOMOUS / PRE-APPROVED. One master gate. Do not stop for “continue.”

This pack implements **everything still open** in plan §13. Do not invent a new architecture. Do not start food work.

---

## A. Paste this as the AI Studio chat prompt

```text
PRE-APPROVAL (waives AGENTS.md L11 Stage-1 wait and L3 “ask before multi-file”).
This message is approval to execute studio/M31_BIOMARKER_LIFECYCLE_REMAINING_MULTIPASS.md
end-to-end in one continuous stream (AGENTS.md L13).

Do the whole remaining biomarker list in plan/BIOMARKER_LIFECYCLE_PLAN.md §13.
Read first: AGENTS.md, docs/agent/domains/biomarkers.md, plan §10 + §13, this pack.
Then implement P0→P8 in order without asking me to say continue.

Laws you must not violate:
- Flag, do not silent-rewrite lab numbers (no sanitize convert, no /38.67, no sodium→143).
- Convert only via ANALYTE_CONVERSIONS in src/utils/biomarkerLifecycle.ts.
- Relabel XOR convert — never both unless the user chose convert.
- Do not restore Home Auto-Fix / Inspect Card / Review in Medical History.
- Do not restore Dictionary Auto-Calibrate / Auto-Fill Defaults / Quick Approve /
  Approve / Approve Selected / Save & Approve.
- Do not invent ethnicity customRanges (especially "< 0").
- Do not concatenate specialist novels into Review. Instruction packs stay.
- Do not delete server.ts / custom_system_instruction_* blocks.
- Do not clone food kcal tables for labs.
- Do not change the expected convert numbers below.
- Gemini / this agent must not declare COMPLETE unless the master gate exits 0.

Expected converts (lock these; do not “improve” them):
  hdl 50 mg/dL → 1.293 mmol/L
  triglycerides 125 mg/dL → 1.411 mmol/L
  ldl 130 mg/dL → 3.362 mmol/L
  creatinine 0.9 mg/dL → 79.56 umol/L
  total_bilirubin 0.8 mg/dL → 13.68 umol/L
  bili 13 (already SI) is NOT converted.

After each phase: run that phase’s tests, update AI_HANDOVER.md checkpoint, IMMEDIATELY start the next phase.
If context is tight: write RESUME at the checkpoint and continue from there — do not re-audit the repo.
You may git commit and push (AI Studio only). Local Grok/Cursor/Claude must not push.

COMPLETE only when node scripts/assert-biomarker-lifecycle-m31.mjs exits 0
AND the named vitest files exit 0 AND every STATUS row is PASS with evidence.
Forbidden phrases until then: all done / fully verified / nothing left.
```

---

## B. Anti-miss / honesty

1. Happy-path-only = FAIL. Each STATUS id needs a unique test or assert string.  
2. Import without call site = FAIL.  
3. Detect without repair = FAIL when the row says repair.  
4. Grep theater = FAIL (matching a comment is not a call site).  
5. Do not rebuild §C.  
6. Do not weaken a gate to force pass.  
7. Do not edit `AGENTS.md` except if you only add the M31 assert row to `DOMAIN_REGRESSION_MAP.md` (listed in-scope).  
8. `customBiomarkers` stays the synced bag until P3 lands a real Pending store — do not invent a third pipeline.  
9. One sync writer. Tombstones win. Newer-wins for `needsApproval` already landed — do not revert to OR-either-side.  
10. Prompt line budget (L12): if you touch Review / Parser prompts, net-zero lines. Prefer TypeScript over English.

**Protected docs in-scope for this pack only:**

- `docs/agent/domains/biomarkers.md` — update write map when P3/P5/P6 change an invariant (before→after in the same change).  
- `docs/agent/DOMAIN_REGRESSION_MAP.md` — add M31 assert + vitest row.  
- `scripts/assert-biomarker-lifecycle-m31.mjs` — create / extend (acceptance meaning lives here).

---

## C. Already DONE — do not rebuild

| Item | Where |
|---|---|
| Convert table + `convertViaTable` | `src/utils/biomarkerLifecycle.ts` |
| `enrichReviewModificationCommands` fills omitted `newValue` | same |
| `buildReviewCommandsFromHistory` synthesizes commands when Review writes an essay | same |
| Review apply uses `modificationCommand` + `toYYYYMMDD` | `App.tsx` `handleLogMedical` |
| Job hydrate keeps commands + synthesizes on empty | `LogChat.tsx`, `App.tsx` job success |
| Home: no Auto-Fix / Inspect / Medical History buttons | `HomeTab.tsx` |
| Dictionary: no Auto-Calibrate / one-click Approve | `BiomarkerDictionaryModal.tsx` |
| Pending count = explicit `needsApproval` only | `isPendingCatalogApproval` |
| Built-in + alias-mapped keys are not pending | same + extract skip |
| Sync does not resurrect stale `needsApproval` | `syncUtils.ts` |
| Sanitize-on-set does not rewrite numbers | `biomarkers.ts` |
| `0` is a value | `isValEmpty` |
| Home / coach / food skip pending + flagged on **new** payloads | `filterHistoryForUse` / `isLiveForUse` |
| `observationMeta` on **new** extract / log writes | `attachObservationMeta` |
| Display names (Review, Lab Parser, …) | `AGENT_DISPLAY_NAMES` |
| Retired destinations redirect | `resolveAgentDestination` |

If a DONE item is missing in *this* tree, restore it from the plan/tests — do not invent a parallel helper.

---

## D. Path matrix (every cell PASS or explicit N/A)

| Path | Must remain true |
|---|---|
| Review n=1–5 | Essay-only model output still yields apply rows; Apply writes only dated outliers |
| Lab Parser | Raw observations; no new catalog keys; mapped names use `getMappedBiomarkerKey` |
| Dictionary | Human approve / alias / reject only; no dummy Auto-Calibrate |
| Sync merge | Tombstone wins; newer-wins for `needsApproval`; no 131-pending OR-flag |
| Home | Approved + unflagged only; telemetry banner → Review only |
| Health Coach / food badges | `filterHistoryForUse` / `isLiveForUse` |
| Unit Relabel | Label only |
| Range Calibrator | Overlay only; no log numbers; no invented `< 0` ranges |
| Golden replay | Frozen medical log or same-agent slice — **not** food NEW Analyze |

---

## E. Phases (implement in order)

### P0 — Lock landed behavior (no product change)

Extend tests; create `scripts/assert-biomarker-lifecycle-m31.mjs`.

Must fail the gate if any of these strings return in UI:

- Home: `Auto-Fix Historical Scaling`, `Inspect Card`, `Review in Medical History`, `Edit Logs in Medical History`
- Dictionary: `Auto-Calibrate`, `Auto-Fill Defaults`, `Quick Approve`, `Approve Selected`, `Save & Approve`

Must pass:

```text
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/syncUtils.regression.test.ts
```

Fixture (already in lifecycle test; keep numbers exact):

```text
14-08-2026: hdl 50, triglycerides 125, ldl 130, creatinine 0.9, total_bilirubin 0.8
02-08-2026 / 05-06-2026: SI cluster (1.43 / 1.07 / 4.2 / 100 / 16)
03-04-2024: bili 13 and creat 72 stay SI
```

`enrichReviewModificationCommands([], history, catalogUnits)` must emit exactly those five converts on 14-08-2026.

### P1 — Review Apply actually writes

- Apply path: `applyModificationCommands` only. Keep `rawValue`/`rawUnit` on `observationMeta`.  
- SI rows unchanged.  
- Add vitest: apply the five commands → history values match §A; older dates unchanged.  
- If `onLogMedical` / job hydrate still drop `modificationCommand`, fix the sibling path (L5).  
- Do not re-enable Home Auto-Fix.

### P2 — Leftover profile junk (code repair)

Implement a **single** cleanup helper (e.g. `cleanupInventedBiomarkerCatalog(profile, history)`) that:

1. Remaps custom keys through `getMappedBiomarkerKey`; tombstones the alias key (`deletedCustomBiomarkerKeys`).  
2. Drops `metric_N` / empty-name / `needsApproval` with no history and no unit (reuse `dataSanitize` kinds).  
3. Deletes `needsApproval` on catalog-mapped keys.  
4. Strips `customRanges` whose parsed bounds are `< 0` or otherwise invented-empty. Does **not** invent replacements.

Wire it to the existing Data Sanitize approval modal (user confirms). **Do not** silent-run on profile load (that would be another silent writer).

### P3 — Stop inventing catalog keys

Target plan §2.2.

- Add `profile.pendingObservations?: { printedName, suggestedKey, date, rawValue, rawUnit, sourceJobId, printedRange?, labFlag? }[]` (or equivalent — one store, typed in `src/types.ts`).  
- Lab Parser / `App.tsx` extract / `LogChat` / `InsightsTab` / Front Desk:  
  - mapped → write observation on canonical key, **no** new `customBiomarkers`  
  - unknown → append pending observation only  
- Dictionary pending list reads this store, not “missing 5 fields.”  
- `isPendingCatalogApproval` stays explicit.  
- Update `docs/agent/domains/biomarkers.md` write map in the same change.

### P4 — Observation identity + unit backfill

- Backfill `observationMeta` on historical rows: if missing, set `rawValue` from the stored number and `rawUnit` from catalog/custom **only as `inferredUnit`**, never pretend it was printed.  
- Identity `(canonicalKey, date, sourceReportId)`: re-parse upserts.  
- Same-day merge **only** when `sourceReportId` matches. Two labs same day stay two rows.  
- Ingest dates → ISO; UI may still show DD-MM-YYYY.  
- Delete or hard-disable `normalizeHistoricalTelemetryErrors` as a writer (detect flagger stays). Grep must show no remaining call sites that mutate history.

### P5 — Relabel XOR convert

- Any unit-edit UI (Dictionary, Review card unit field, Unit Relabel agent apply) requires `mode: 'relabel' | 'convert'`.  
- Relabel: change label / catalog unit; **numbers unchanged**.  
- Convert: Review + `convertViaTable` only; refuse unknown pairs; keep raw.  
- Tests: relabel HDL unit does not change 1.43; convert 50 → 1.293.

### P6 — Overlay + silent Calibrator

- Overlay record: range / optimal / brackets + `overlayFingerprint` (age **band** + sex + ethnicity).  
- `shouldRunCalibrator` already exists — wire a **silent one-key** run when `rangeVariesBy` intersects and fingerprint is stale. n≥20 = batch those keys only.  
- Calibrator writes overlay only. No log numbers. No Home/Dictionary Auto-Calibrate button.  
- `ensureCustomRanges` stays a no-op inventor.  
- Food / coach / nutrient targets: only `filterHistoryForUse` / `isLiveForUse`. Grep leftover readers that skip the filter.

### P7 — Dispatcher

Use `resolveAgentDestination` + `scopeKeys.length`:

| n | Destination |
|---|---|
| 1–5 | Review (`biomarker_review`) only |
| one report / 10–50 | Lab Parser then Review on **flagged** only |
| ≥20 hygiene | exactly one specialist (`agent3` name / `agent2` category / unit relabel / `data_review`) |

Do not open five agents for “add one marker.” Do not paste Calibrator 8.8k into Review.

### P8 — Slice 4 Biomarkers golden inbox

Follow `plan/BIOMARKER_INGEST_AND_GOLDENS_PLAN.md` (class-first). Do **not** make “job all-green” the reward (that is the meal-log loop).

- Golden UI: **Food | Biomarkers** (existing `GoldenInboxPanel` — add a domain tab; do not clone meal kcal columns). Group biomarker rows by **class**, then example.  
- Pin G-B1: `job_medical_1786660190499` and `job_medical_1786666223594` as examples of `SILENT_REWRITE` + `APPLY_MISS`.  
- Board: class, key, date, raw, canonical, unit + events + definition.  
- Auto-bugs: impossible pair, 15× shift, apply didn’t land, silent sanitize would rewrite, pending on Home, Review essay with empty `modificationCommand`.  
- Replay = **class unit test first**, then frozen example. Not food NEW Analyze.  
- Gate: empty `modificationCommand` still yields the five converts; Apply lands; SI history unchanged.

---

## F. Machine gate

Create and keep green:

```bash
node scripts/assert-biomarker-lifecycle-m31.mjs
npx vitest run src/utils/biomarkerLifecycle.test.ts src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts src/utils/syncUtils.regression.test.ts
npx tsc --noEmit
```

After P8 also run whatever golden command you add (e.g. `npm run golden:inbox:biomarkers`) from `DOMAIN_REGRESSION_MAP.md`.

**Master assert must include (unique strings / call sites, not comments):**

| ID | Check |
|---|---|
| A1 | Home forbidden button strings absent |
| A2 | Dictionary forbidden approve/calibrate strings absent |
| A3 | `buildReviewCommandsFromHistory` + `enrichReviewModificationCommands` exported and called from LogChat + server biomarker_review + App apply |
| A4 | `isPendingCatalogApproval` used by Dictionary `checkKeyNeedsApproval` |
| A5 | `normalizeHistoricalTelemetryErrors` has no mutating call sites (after P4) |
| A6 | Convert fixture numbers locked (1.293 / 1.411 / 3.362 / 79.56 / 13.68) |
| A7 | Unknown extract does not write `needsApproval: !isBuiltIn` on a new custom key (after P3) |
| A8 | Relabel path does not assign converted numbers (after P5) |
| A9 | Calibrator / data_review does not write `biomarkers[key] =` history values (after P6) |
| A10 | Golden inbox mentions Biomarkers domain (after P8) |

Start the assert in P0 with A1–A4 + A6. Add A5/A7–A10 when those phases land — do not skip the phase and comment the check out.

---

## G. STATUS table

| ID | Phase | Acceptance | Evidence |
|---|---|---|---|
| S0 | P0 | Tests + assert A1–A4,A6 green; no UI regressions | |
| S1 | P1 | Apply fixture writes five values; SI dates unchanged | |
| S2 | P2 | Cleanup helper + Data Sanitize wiring; no load-time silent rewrite | |
| S3 | P3 | Unknown name → pendingObservations; mapped → no new custom key | |
| S4 | P4 | Historical `observationMeta`; upsert id; no telemetry writer | |
| S5 | P5 | Relabel XOR convert tests | |
| S6 | P6 | Overlay fingerprint; silent calibrator; no Auto-Calibrate UI | |
| S7 | P7 | Dispatcher by n; one specialist at a time | |
| S8 | P8 | Biomarkers inbox + G-B1 pin + replay gate | |
| S9 | Docs | Rulebook write map + DOMAIN_REGRESSION_MAP + AI_HANDOVER updated | |

COMPLETE only if every row PASS.

---

## H. Out of scope + order

**Out of scope:** food pipeline, lassi/picnic goldens, USDA Analyze hot path, renaming `agent4` storage ids, deleting instruction packs, full LOINC/UCUM, Insights accordion rewrite, i18n, Firestore kill-switch, inventing new agents.

**Order:** P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → docs/handover → master gate → Studio commit/push.

**Resume line** (if a new chat is required):

```text
RESUME M31 from phase Px (first FAIL STATUS id).
Plan §13 + studio/M31. Do not rebuild §C. Continue to master gate.
```

**Definition of done (plan §13.7):** Apply verified · unknown names never become catalog keys · every observation has a unit or `inferredUnit` · relabel cannot rewrite a number · G-B1 replay-green · Home/coach/food never consume pending or flagged values.
