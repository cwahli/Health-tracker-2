# M20 — Agent governance + domain regression foundation (ship to GitHub)

**Status:** ACTIVE — human uploads this pack (+ already-prepared tree or multi-file upload) to **AI Studio**.  
**Who commits:** **AI Studio only** (not Grok/Claude/Cursor on Desktop).  
**Repo:** https://github.com/cwahli/Health-tracker-6  

---

## A. User prompt (copy-paste to AI Studio)

```text
Follow studio/M20_AGENT_GOVERNANCE_AND_REGRESSION.md only.

You are AI Studio. You alone may git commit and push to origin after the gate exits 0.

1. Ensure the governance docs + regression code listed in §E are present in the working tree
   (human may have multi-uploaded AGENTS.md, docs/agent/**, tests, and related code).
2. Do not rebuild product features outside §E.
3. Do not weaken assert scripts to force green.
4. Run the machine gate in §F — exit 0 required.
5. Then git add only the listed paths, commit with the message in §G, push to origin/main
   (or open PR if your environment requires it — prefer push main if that is the project workflow).
6. Update AI_HANDOVER.md STATUS row for M20 → DONE and move this pack note if instructed.

COMPLETE only if gate exit 0 + commit/push succeeded.
Forbidden until then: "all done", "fully verified".
Local agents elsewhere are NOT allowed to push — you are the ship path.
```

---

## B. Anti-miss / honesty

- Import without call site = FAIL (not applicable if docs-only rows).  
- Do not edit protected process meaning without keeping AGENTS §3 (confirmation was given by this pack listing those files).  
- Do not delete domain rulebooks or regression tests.  
- Do not include junk `* 2.md` / duplicate archive copies in the commit.  
- Rulebooks guide evolution; do not “freeze” product by inventing new bans beyond this pack.

---

## C. Already DONE (do not rebuild)

| Area | Note |
|------|------|
| Food-calc hybrid / label truth product code | Mostly shipped earlier — not this pack’s job |
| Initiative K bug tracking | Done on Desktop earlier |
| Modal M1–M5 product paths | Not rebuilt here |

This pack ships **process + regression foundation** that was prepared locally.

---

## D. Goals (acceptance IDs)

| ID | Acceptance |
|----|------------|
| G1 | `AGENTS.md` short always-on: load map, laws, protected docs, **commit via AI Studio only**, evolution-friendly domain laws |
| G2 | `docs/agent/**` present: PACKS, TEMPLATES, DOMAIN_REGRESSION_MAP, domains food-calc/biomarkers/sync, README |
| G3 | Sync helpers exported: `mergeDeleteMaps`, `filterLogsByTombstone` (+ tests) |
| G4 | Biomarker identity tests + clean slug mapping |
| G5 | Food-calc behavioral tests: mergeScoutItems preserve soft cal/components; budget/portion/aggregation extensions |
| G6 | `node scripts/assert-agent-governance.mjs` exit 0 + vitest smoke exit 0 |

---

## E. Files that must be in the tree / commit

### Process (protected — in scope for this pack)

- `AGENTS.md`
- `AI_HANDOVER.md` (roles + M20 pointer; WIP board)
- `docs/agent/README.md`
- `docs/agent/PACKS.md`
- `docs/agent/TEMPLATES.md`
- `docs/agent/DOMAIN_REGRESSION_MAP.md`
- `docs/agent/domains/food-calc.md`
- `docs/agent/domains/biomarkers.md`
- `docs/agent/domains/sync.md`
- `plan/README.md` (doc roles + freshness note)
- `studio/M20_AGENT_GOVERNANCE_AND_REGRESSION.md`
- `studio/00_README.md` / `studio/ACTIVE_STATUS.md` (point at M20)
- `scripts/assert-agent-governance.mjs`

### Code / tests (regression foundation)

- `src/utils/syncUtils.ts` (exports + mergeDeleteMaps usage in mergeProfiles)
- `src/utils/syncUtils.regression.test.ts`
- `src/utils/biomarkers.ts` (getMappedBiomarkerKey clean fallback)
- `src/utils/biomarkerIdentity.test.ts`
- `server_vision_scout.ts` (components + estimatedCalories preserve)
- `server_vision_scout.test.ts` (extended cases)
- `server_budget_reconcile.test.ts` (extended cases)
- `server_nutrient_aggregation.test.ts` (field preserve case)
- `server_portion_clarify.test.ts` (new)

### Optional if already modified together (include if present and related)

- Other food/job/header fixes only if they are required for gate green on this tree — **prefer not** bundling unrelated product WIP. Prefer a clean governance commit; product WIP can be a later Studio pack.

**Exclude from commit:** files named `* 2.md`, `* 2.mjs`, `* 2.ts`, scratch `task-*.txt`, `node_modules`, secrets.

---

## F. Machine gate (exit 0 required)

```bash
node scripts/assert-agent-governance.mjs
npx vitest run \
  src/utils/syncUtils.regression.test.ts \
  src/utils/biomarkerIdentity.test.ts \
  src/utils/biomarkerSanitize.test.ts \
  server_vision_scout.test.ts \
  server_budget_reconcile.test.ts \
  server_portion_clarify.test.ts \
  server_nutrient_aggregation.test.ts
node scripts/assert-biomarker-flow.mjs
```

If `tsc` is quick and clean on the tree, also:

```bash
npx tsc --noEmit
```

If tsc fails on pre-existing unrelated errors, note them in STATUS; do not mass-fix the app in this pack. Prefer governance gate + vitest green.

---

## G. Commit + push (AI Studio only)

```bash
git status
git add AGENTS.md AI_HANDOVER.md plan/README.md docs/agent \
  scripts/assert-agent-governance.mjs \
  studio/M20_AGENT_GOVERNANCE_AND_REGRESSION.md studio/00_README.md studio/ACTIVE_STATUS.md \
  src/utils/syncUtils.ts src/utils/syncUtils.regression.test.ts \
  src/utils/biomarkers.ts src/utils/biomarkerIdentity.test.ts \
  server_vision_scout.ts server_vision_scout.test.ts \
  server_budget_reconcile.test.ts server_nutrient_aggregation.test.ts \
  server_portion_clarify.test.ts

# Only add other paths if required for green gates and clearly part of this foundation.

git commit -m "$(cat <<'EOF'
Add agent governance docs, domain rulebooks, and regression foundations.

Short AGENTS.md with protected-doc policy and AI-Studio-only commits; food/biomarker/sync
rulebooks; sync tombstone helpers and identity/merge/budget behavioral tests.
EOF
)"

git push origin HEAD
```

If branch is behind origin: rebase/merge carefully; **prefer Desktop/full modules over stubs** for portion/refine if conflicts. Do not force-push unless human explicitly orders it.

---

## H. STATUS template

| ID | Result | Evidence |
|----|--------|----------|
| G1 | PASS/FAIL | AGENTS.md present + §4 Studio-only |
| G2 | PASS/FAIL | docs/agent tree |
| G3 | PASS/FAIL | mergeDeleteMaps + regression test |
| G4 | PASS/FAIL | biomarkerIdentity + mapping |
| G5 | PASS/FAIL | vision/budget/portion tests |
| G6 | PASS/FAIL | assert-agent-governance + vitest exit 0 |
| Ship | PASS/FAIL | commit sha + push |

**COMPLETE only if every row PASS.**

---

## I. Out of scope

- Full App.tsx agent1 key unification refactor  
- Multi-device E2E soak  
- Unrelated product bugs in dirty tree  
- Deleting or rewriting plan architecture docs wholesale  
- Local agent push from Desktop Grok/Claude  

---

## J. After COMPLETE (human or Studio)

1. Mark M20 DONE in `AI_HANDOVER.md`.  
2. Move `studio/M20_AGENT_GOVERNANCE_AND_REGRESSION.md` → `archive/studio/completed-2026-08/` (or dated folder).  
3. Set `studio/ACTIVE_STATUS.md` next pack if any.

---

## K. Human upload checklist

You may upload **all at once** to AI Studio:

1. This pack file  
2. `AGENTS.md`  
3. Entire `docs/agent/` folder  
4. `AI_HANDOVER.md`, `plan/README.md`  
5. Changed code/test files listed in §E  
6. `scripts/assert-agent-governance.mjs`  

Paste **§A user prompt** as the session instruction. Studio runs §F then §G.
