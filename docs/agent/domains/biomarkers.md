# Domain rulebook: Biomarkers

**Load when:** dictionary, medical extract/review, agents 1–5 / data_review, calibration, combine/dedupe, biomarker logs, MedicalHistory, ranges.

**WIP status:** `AI_HANDOVER.md` · **Gates:** `DOMAIN_REGRESSION_MAP.md` → Biomarkers.

**How to use this book:** Alignment guide so dictionary / agents / logs / sync do not drift.  
**Evolution allowed:** new agents, combine UX, key migrations — with IMPACT, tests, and protected-doc update if invariants change (`AGENTS.md` §3 before→after). Do not “simplify” by deleting tombstone or identity paths without scope.

---

## 1. Mental model (layers)

```text
Sources (labs / photos / manual)
  → extract / review agents
  → dictionary identity (canonical key + aliases)
  → log entries (BiomarkerLog) + profile customs
  → calibration / ranges (demographics, agent5 / data_review)
  → UI (Home, MedicalHistory, dictionary modal, combine)
  → sync/tombstones (see sync.md)
```

Changing **one** layer without checking the next is the usual cascade.

---

## 2. Agent roles (do not collapse or rewire casually)

From `src/utils/agentConfig.ts` (names can drift; **ids** matter):

| Id | Role (intent) | Typical output |
|----|----------------|----------------|
| `medical_extract` | Parse reports → structured readings | raw structured values |
| `data_review` | Batch calibration / accuracy on a batch | reviewed batch + ranges context |
| `agent1` | Standardize terms → **master dictionary** | normalized keys / naming |
| `agent2` | Clinical context (groupings, risks, conditions) | ontology-ish fields |
| `agent3` | Harmonize synonyms / buckets | consolidation, fewer duplicates |
| `agent4` | Planning (retest, gaps, confounders) | plan fields |
| `agent5` | Personalized ranges / holistic review | range calibration signals |
| `biomarker_review` | Single-biomarker review | apply path must not auto-send wrongly |
| `medical` / `front_desk` | Broader medical / routing | must not invent dictionary keys freely |

**Laws:**

1. **Pipeline order matters.** Do not have agent N overwrite agent N−1 identity fields without an explicit merge policy.  
2. **Dictionary is source of truth for keys.** Agents propose; dictionary + approval gates own permanence.  
3. **One canonical key per analyte.** Aliases map → key; do not create parallel keys for the same lab concept without combine flow.  
4. **Hallucinated values:** agents must not invent numeric lab results the user did not provide; ranges/context ≠ fabricated readings.  
5. Changing one agent’s schema ⇒ audit **apply/onAgentFinish** paths and any batch approval flags on profile.
6. **Food agent biomarker intake:** Out-of-range biomarkers passed into food analyze must be filtered through `filterLogsByTombstone` and `getMappedBiomarkerKey` (no tombstoned or unapproved keys).
7. **Read-only meal badging:** Food agents compute transient `dangerBadges` and `biomarkerStatus` on the meal envelope; they are strictly forbidden from mutating `profile.customBiomarkers` or creating phantom dictionary keys.

---

## 3. Dictionary & identity

| Store | Role |
|-------|------|
| `biomarkerDefinitions` (`src/utils/biomarkers.ts`) | Built-in catalog |
| `biomarker_dictionary_store` (localStorage via `biomarkerStore.ts`) | User/runtime dictionary, pending approval |
| Profile `customBiomarkers` | User customs (sync-sensitive) |
| Tombstones | `deletedCustomBiomarkerKeys`, `deletedNotUsedBiomarkerKeys`, `notUsedBiomarkers` |

**Invariants:**

- **Stable keys:** renaming a key is a **migration**, not a string swap — update logs, customs, tombstones, calibrations, UI maps together.  
- **Pending approval:** `isPendingApproval` / approve helpers must not be bypassed by silent auto-write from agents.  
- **Combine / dedupe:** use existing combine flows (`CombineBiomarkersModal` etc.); do not half-merge by overwriting one key and leaving orphan logs.  
- **Not-used flags:** respect not-used + deleted-not-used maps; do not resurrect without user action.

---

## 4. Calibration

| Piece | Notes |
|-------|--------|
| `agentCalibration.ts` | Reads `batch_analysis_results` / reviewed biomarkers |
| `data_review` / agent5 messaging | Demographic-aware ranges |
| Range evaluation | `evaluateStructuredRange` + custom ranges/filters |

**Laws:**

- Calibration **contextualizes ranges**; it does not replace raw logged values.  
- Profile filters (age/gender/ethnicity) on custom ranges must keep working if range builder changes.  
- Do not store free-text ranges in three formats without a single parse path — prefer existing helpers.

---

## 5. Logs vs dictionary vs profile

| Data | Identity |
|------|----------|
| `BiomarkerLog` | `id` + `date` + `biomarkers` map of keys → values |
| Delete log | `sync_state: 'delete'` **and/or** profile `deletedBiomarkerLogIds[id] = timestamp` |
| Display filter | Exclude deleted; respect tombstone **timestamps vs `updated_at`** |

Cross-link: any UI edit path that “removes” a biomarker must use the **same** delete/tombstone rules as sync (`domains/sync.md`). Otherwise multi-device reappearance is guaranteed.

---

## 6. Cross-surface checklist (before COMPLETE)

When changing biomarker behavior, tick applicable rows:

- [ ] Dictionary key identity preserved or migrated  
- [ ] Agent apply path updates correct store (log vs dictionary vs profile)  
- [ ] No duplicate keys introduced for same analyte  
- [ ] Tombstones still filter history (`MedicalAgentExecutor`, App filters)  
- [ ] Calibration still keyed by same biomarker key  
- [ ] Combine / not-used / pending approval not bypassed  
- [ ] Sanitize path still runs where expected  
- [ ] `assert-biomarker-flow.mjs` still exit 0 if review/apply touched  

---

## 7. Anti-patterns

- “Clean the dictionary” by rewriting keys without log migration  
- Agent invents new keys every run (alias explosion)  
- Fixing agent3 harmonization by wiping agent1 standardized keys  
- UI delete that only hides locally (no tombstone)  
- Treating `biomarker_review` like auto-send food jobs  
- Claiming COMPLETE after one agent path when dictionary + logs + sync all touch the change  

---

## 8. Agent → store write map (audit 2026-08-09)

**Primary apply hub:** `App.tsx` `onAgentFinish` + `handleLogMedical`.  
**Executor is read-only for stores:** `MedicalAgentExecutor` filters tombstones then POSTs analyze only.

| Agent id | Durable writes | localStorage / side | Notes |
|----------|----------------|---------------------|--------|
| `medical_extract` / `agent1` | History + current biomarkers + `customBiomarkers`; batch may tombstone customs | `agent1_batch_results`, `approved_agent1_batches` | Flat vs batch paths differ; key slug **without** always calling `getMappedBiomarkerKey` |
| `data_review` | `customBiomarkers` ranges/defs + history corrections + normalize telemetry | `batch_analysis_results`, `approved_data_review_batches` | Uses LLM keys as-is — **parallel-key risk** vs agent1 |
| `agent2` | `customBiomarkers` bucket/risk/grouping fields only | approved analysis ids | No history values |
| `agent3` | Summary text only on finish | — | Real combine is dictionary modal → `handleCombineBiomarkers` |
| `agent4` | Planning summaries / gap tasks / may replace actions | — | No lab keys |
| `agent5` | Contextualizer summary | — | No dictionary writes despite “ranges” copy |
| `biomarker_review` | History + current via B5 / `handleLogMedical` | — | Dual apply paths; empty corrections no-op |
| `medical` | Via user Apply → `handleLogMedical` | pending chat until apply | Customs often `needsApproval: true` |
| `front_desk` | Profile + `onAddBiomarkerLogs` new rows | — | **No** same-day merge / alias map → easy dups |
| Dictionary UI agents | customs, approve, combine → tombstones | `dict_*` UI keys | True consolidate path |

**Shared writers:** delete/combine/sanitize (`deletedCustomBiomarkerKeys`, `deletedBiomarkerLogIds`), `mergeProfiles` / `mergeBiomarkerHistory` on sync.

### Runtime dictionary truth

| Store | Reality |
|-------|---------|
| `profile.customBiomarkers` | **Synced source of truth** agents/UI mutate |
| `biomarker_dictionary_store` (localStorage) | Mostly **dead dual path** — `approvePendingBiomarker` only; do not assume agents write it |
| `biomarkerDefinitions` | Built-in catalog |

### Identity rules (default — change with migration + tests)

1. Prefer **`getMappedBiomarkerKey`** before creating a new custom key (alias fan-in).  
2. Avoid parallel keys for the same analyte (e.g. unit-suffixed lab names).  
3. Delete dictionary key ⇒ **tombstone** + history migration; not UI hide alone.  
4. Agent apply must not invent numeric lab values without source evidence.  
5. Changing key slug logic across agent1 / handleLogMedical / front_desk is **class X** — align helpers or document divergence in `AI_HANDOVER`.

### Tests

```bash
npx vitest run src/utils/biomarkerIdentity.test.ts src/utils/biomarkerSanitize.test.ts src/utils/dataSanitize.test.ts
node scripts/assert-biomarker-flow.mjs
```

### Remaining backlog (not done)

1. Extract pure `slugifyBiomarkerKey` / agent1 apply merge from `App.tsx` + goldens.  
2. Wire agent1 + data_review apply through `getMappedBiomarkerKey`.  
3. Front desk same-day merge + alias map.  
4. Remove or wire dead `biomarker_dictionary_store`.  
5. Hallucination guards on apply.
6. Fix `biomarker_review` missing historical context payload in `serverJobs.ts` and `LogChat.tsx`
