# Locked-spec development process

**Human protocol:** [`JOURNEY.md`](./JOURNEY.md) — Planner / Builder / Guard. One sentence, then **go**. You do not fill this file.

**What this is:** packet format the *agent* writes. After **go**, that packet is frozen memory so the next session cannot overwrite finished work.

**What this is not:** a product architecture for the Meal Agent. Product graph stays in `plan/FOOD.md` / `BIOMARKER_LIFECYCLE.md`. This file is the **development graph**.

**Status:** process (protected to edit — same rule as this folder). Execute IDs still live on `plan/ROADMAP.md`.

---

## 0. The problem this solves

A new chat does not remember Session A. It re-reads `App.tsx` or `server_food_analyze_run.ts` and **rewrites** a path that already has an owner. You then spend a session recovering git.

Chat is not memory. `AI_HANDOVER.md` is status, not a contract. IMPACT pasted into a transcript dies with the window.

**Rule:** intent that must survive a new session lives in a **locked spec file in git**. The implementer may not edit that file. Diffs that touch files outside the spec fail.

Class S (copy/CSS) and questions skip this file. Class M may use a short spec. **L and X always lock before code.**

---

## 1. Roles (sequential, one writer)

| Role | Who | Tools | Must not |
|------|-----|--------|----------|
| **You** | human | lock / reject / serialize IDs | — |
| **Specify** | agent | read, grep; write only `specs/active/<ID>.md` as `draft` | edit `src/`, `server*.ts`, tests, asserts |
| **Implement** | agent | patch **Allowed files** only | edit the spec; rewrite Frozen files; `edit_mode: rewrite` unless the spec says so |
| **Verify** | agent (different pass) | `tsc`, named vitest, `assert-spec-diff.mjs` | edit the spec; weaken `scripts/assert-*.mjs` |

Do **not** run Specify and Implement as a swarm on the same files. Do **not** run Studio and Grok on the same Allowed-file set. Antigravity Teamwork is not the default.

Skills (load one): `specify` · `food-calc` · `biomarkers` · `sync-jobs` · `debug-contract` · `verify`. Domain text already lives in `docs/agent/domains/*`. Load that file when the spec’s `skill:` says so — not all of them.

---

## 2. Files

```text
specs/
  TEMPLATE.md              # copy this
  examples/F-8.12.md       # teaching copy (not executable)
  active/<ID>.md           # draft → locked (implement reads this)
  done/<ID>.md             # moved after COMPLETE
scripts/assert-spec-diff.mjs
```

`<ID>` = ROADMAP id (`F-8.12`) or class (`STALE_TURN`, `APPLY_MISS`). One locked spec at a time per worktree.

---

## 3. The graph

```text
you: one ROADMAP ID or one class
        │
        ▼
  SPECIFY  → specs/active/<ID>.md  status: draft
        │
        ▼
  YOU LOCK → status: locked        (spec is now frozen)
        │
        ▼
  IMPLEMENT  (one skill, patch only, Allowed files)
        │
        ▼
  VERIFY     tsc + named gate + assert-spec-diff
        │
   pass → commit spec+code → HANDOVER one line → move spec to specs/done/
   fail → classify → one repair against the same spec (not a new architecture)
```

If Specify wants to rewrite `App.tsx`, that is a **spec bug**. Reject it before any code.

---

## 4. Spec fields (required)

See `specs/TEMPLATE.md`. The gate script reads the YAML frontmatter.

| Field | Meaning |
|-------|---------|
| `id` / `status` | `draft` \| `locked` \| `done` |
| `class` | `BIND_MISS`, `STALE_TURN`, `ALWAYS_SECOND_AGENT`, … |
| `skill` | which domain file to load |
| `edit_mode` | `patch` (default) or `rewrite` (you must type this) |
| `allowed_files` | only these may change (plus the spec itself while `draft`) |
| `frozen_files` | must have empty diff |
| `gate` | exact commands from `DOMAIN_REGRESSION_MAP.md` |
| Goal / in / out | stops silent task substitution |
| Invariants | e.g. agent never emits kcal; SI locks `1.293` / `1.411` / `3.362` / `79.56` / `13.68` |
| Prior art | existing owners — do not reimplement |

**Lock:** you set `status: locked` (or tell the agent “lock F-8.12”). After that, Verify fails if the spec file itself changed.

---

## 5. Session start (every L/X implement)

1. Read **this file** only if you have not this session.
2. Read `AGENTS.md` §1 load map.
3. Read **`specs/active/<ID>.md`**. If none, or `status: draft`, **do not edit application code** — run Specify or stop.
4. Load only the domain file named in `skill:`.
5. Patch Allowed files. Stop.

Do not dump `plan/FOOD.md` Part A/B. Do not `npm test`.

---

## 6. Gates (COMPLETE)

```text
npx tsc --noEmit
<exact vitest / assert from the spec>
node scripts/assert-spec-diff.mjs <ID>
```

`assert-spec-diff.mjs` fails when:

- a changed file is not on `allowed_files`
- a `frozen_files` path has a diff
- `edit_mode: patch` but a listed file is a near-full rewrite (>30% of lines, or the tool wrote the whole file)
- no locked spec exists for that ID (when an ID is passed)

The spec file may share the COMPLETE commit. After lock, do not change its **body** (Allowed / Frozen / invariants). That is a review fail.

SELF-CHECK from `TEMPLATES.md` still applies. IMPACT **is** the spec file — do not paste a second IMPACT block into chat.

Forbidden until gates are green: “all done” / “fully verified.”

---

## 7. Failure classes (repair, do not rewrite)

| Class | Meaning | Repair |
|-------|---------|--------|
| `WRONG_FILE` | diff outside Allowed | revert extra files |
| `REWRITE` | whole-file replace on `patch` | restore file, surgical patch |
| `DROPPED_INVARIANT` | kcal from LLM, SI factor invented, Dietitian on every create | restore owner; do not add a second path |
| `GATE_RED` | named test failed | fix the class; do not paint `expected.json` |
| `SPEC_DRIFT` | implementer edited the locked spec | revert spec; fix code instead |

Two burned hypotheses → STOP that ID (`AGENTS.md` L14).

---

## 8. What not to do

- Spec-as-source (humans edit only markdown, regen the app).
- Spec Kit / Conductor ceremony on Class S.
- Antigravity `/teamwork-preview` as default.
- Parallel workers on `App.tsx` / `LogChat.tsx` / `server_food_analyze_run.ts`.
- Implementer editing the spec when tests fail.
- `POST /loop` until goldens look green.
- A 5,000-line spec.

---

# Worked example — F-8.12 packaged label lock

This ID is still open on `plan/ROADMAP.md`. The walkthrough is how a **locked-spec session** would run. Teaching copy of the spec: `specs/examples/F-8.12.md`.

**Done when (from ROADMAP):** Hemaviton-class drink: vitamin C / labelled kcal from **brand or printed OCR** when those facts exist. Bind-attempt + `BIND_MISS` stays honest. F-10 does not replace catalog bind.

**Do not:** invent 1000 mg vitamin C; add a Dietitian create pass; touch `App.tsx`.

---

### Turn 0 — you

```text
work F-8.12
```

That means: Specify first. Not “start patching finalize.”

---

### Turn 1 — Specify (read-only except the spec file)

Specify loads:

- `plan/ROADMAP.md` F-8.12 row only
- `docs/agent/domains/food-calc.md` §1–1d (Truth Hierarchy: OCR → Brand → estimate)
- existing bind helpers (`src/server/food/server_food_scout_source.ts`, `server_dish_finalize.ts`)
- `docs/agent/DOMAIN_REGRESSION_MAP.md` food-catalog / finalize rows

It does **not** open `App.tsx`, `JobStore.ts`, or `plan/FOOD.md` Part A/B.

It writes `specs/active/F-8.12.md` with `status: draft`. Full text of that draft (after a realistic Specify pass):

```yaml
---
id: F-8.12
status: draft
class: BIND_MISS
skill: food-calc
edit_mode: patch
allowed_files:
  - src/server/food/server_food_scout_source.ts
  - src/server/food/server_food_scout_source.test.ts
  - server_dish_finalize.ts
  - server_dish_finalize.test.ts
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - src/jobs/JobQueueRunner.ts
  - src/mealBuild/shouldExpandMealAgent.ts
  - server_meal_gate.ts
  - server_derivation.ts
  - AGENTS.md
  - scripts/assert-f10-pr1.mjs
  - scripts/assert-biomarker-lifecycle-m31.mjs
gate:
  - npx vitest run src/server/food/server_food_scout_source.test.ts server_dish_finalize.test.ts server_derivation.test.ts
  - node scripts/assert-spec-diff.mjs F-8.12
---
```

```markdown
# F-8.12 — Packaged printed kcal / micronutrient lock

## Goal
When a packaged drink has a printed nutrition panel or a brand-menu row,
labelled kcal and labelled vitamin C bind from that evidence.
If bind fails, the item stays `BIND_MISS` (honest residual), not a guessed 1000 mg.

## In scope
- Infer packaged bind chain from label text already on the scout item
- Prefer OCR / brand printed kcal over Meal Agent estimate
- One new fixture: Hemaviton-class drink with printed kcal + vitamin C

## Out of scope
- USDA / FDC workstream (F-1 / F-2 parked)
- Curator rebuild (M30 stays)
- F-10 expand gate (already shipped — do not rewrite)
- F-9.5 job poller / App.tsx
- Dietitian as a required create stage
- Inventing micros that are not on the label or brand row

## Invariants
- `finalizeDishLedger` is the only kcal writer
- Agent schema still has no `calories`
- `shouldExpandMealAgent` stays TypeScript; model does not pick COMPLETE/DELEGATE
- Locked SI converts untouched: 1.293 / 1.411 / 3.362 / 79.56 / 13.68
- Gate `evaluateMealGate` still refuses 0-kcal-with-macros

## Prior art (do not reimplement)
- F-10.1 `shouldExpandMealAgent.ts`
- F-10.2 `server_derivation.ts` (`calculateDerivedNutrients`)
- F-10.7 adaptive create cutover in `server_food_analyze_run.ts`
- M30 curator; brand/OCR hard lock already wins over estimate

## Done when
1. Fixture: packaged drink with printed 180 kcal + vitamin C on panel → those values locked on the dish
2. Fixture: same shape with no panel and no brand row → `BIND_MISS`, no invented vitamin C
3. `git diff --name-only` ⊆ allowed_files
4. Named vitest + `assert-spec-diff.mjs F-8.12` exit 0
```

Specify **stops**. No application edits.

---

### Turn 2 — you lock

You read the draft. Two edits you might make:

1. Add `server_food_analyze_run.ts` to **Frozen**, not Allowed — F-8.10/F-10.7 own that file; this ID must not re-split it.
2. Keep `edit_mode: patch`. If Specify had put `rewrite` on `server_dish_finalize.ts`, change it back.

You (or you tell the agent) set `status: locked`.

**After lock, the spec is durable memory.** A new chat tomorrow must read this file. It must not invent a new plan.

---

### Turn 3 — Implement (food-calc skill)

Implementer session start:

```text
Read specs/active/F-8.12.md (locked).
Load docs/agent/domains/food-calc.md §1–1d only.
Patch allowed files. Do not rewrite frozen files.
```

**Illegal (this is the overwrite you are trying to kill):**

- Replace all of `server_dish_finalize.ts` with a new “packaged pipeline”
- Open `App.tsx` “to show vitamin C on the card”
- Re-introduce Scout → Dietitian on every create “so packaged drinks get a second look”
- Write kcal onto the Meal Agent schema
- Edit `specs/active/F-8.12.md` to add `App.tsx` to Allowed after the fact

**Legal:**

- Extend `inferPackagedBindChains` to copy printed kcal / vitamin C onto the bind attempt
- Add two fixtures in the existing test files
- In finalize, when a printed/brand lock exists, use it (already the truth hierarchy — fill the gap, don’t fork a second kcal book)

Worked patch shape (illustrative, not the commit):

```ts
// server_food_scout_source.ts — extend existing helper, do not replace the file
if (printedKcal != null) {
  item.lockedNutrientKeys = [...(item.lockedNutrientKeys || []), 'calories'];
  item.labelNutrientsPerServing = {
    ...(item.labelNutrientsPerServing || {}),
    calories: printedKcal,
    vitaminC: printedVitaminC, // only if present on panel / brand row
  };
}
```

```ts
// server_food_scout_source.test.ts
it('locks printed kcal and vitamin C on a Hemaviton-class panel', () => { /* … */ });
it('stays BIND_MISS when there is no panel and no brand row', () => { /* … */ });
```

Implement **stops** when Allowed files are patched. It does not run `npm test`. It does not start F-8.10.

---

### Turn 4 — Verify (cannot edit the spec)

```text
npx tsc --noEmit
npx vitest run src/server/food/server_food_scout_source.test.ts server_dish_finalize.test.ts server_derivation.test.ts
node scripts/assert-spec-diff.mjs F-8.12
```

Example **pass**:

```text
PASS F-8.12 allowed_files
PASS F-8.12 frozen_files
PASS F-8.12 spec_ok
PASS F-8.12 patch_not_rewrite
```

Example **fail** (typical overwrite):

```text
FAIL F-8.12 extra_file: src/App.tsx
FAIL F-8.12 frozen_touched: src/App.tsx
FAIL F-8.12 rewrite: server_dish_finalize.ts changed 61% of lines (edit_mode=patch)
```

Repair: revert `App.tsx` and the rewrite. One bounded patch. Do not “try a new architecture.”

---

### Turn 5 — COMPLETE

```text
COMPLETE
spec: specs/active/F-8.12.md (locked, unchanged)
SELF-CHECK: all boxes
GATE LOG:
  tsc:    exit 0
  vitest: exit 0  (three named files)
  assert: exit 0  (assert-spec-diff.mjs F-8.12)
paths: packaged bind + finalize only
```

Commit **spec + code together**. Move `specs/active/F-8.12.md` → `specs/done/F-8.12.md` with `status: done`. One line on `AI_HANDOVER.md` **Now**: `F-8.12 packaged label lock — done`.

---

### Next week — Session B (the point of the lock)

New Grok/Studio chat, empty context:

> Packaged drinks are wrong. Always run Dietitian after Scout so vitamin C is correct. Also show it on the home card.

**Without a locked spec** the agent would: add a second LLM on create (`ALWAYS_SECOND_AGENT`, undoing F-10.7), emit micros from the model, and rewrite `App.tsx` / `HomeTab`.

**With this process** the implementer must find a locked or done spec. It reads `specs/done/F-8.12.md` and F-10 prior art:

- Out of scope: Dietitian as required create; inventing micros
- Frozen: `App.tsx`, `shouldExpandMealAgent.ts`
- Prior art: F-10.7 already cut over create; finalize owns kcal

Correct response: **stop and report**. Either (a) this is still F-8.12 bind (already done — show the fixture), or (b) a **new** ID is needed for Home chrome (`Class S` or a new spec with `HomeTab` in Allowed). It does not silently expand.

That is how you stop retrieving overwritten work: the next agent is not asked to remember the chat. It is asked to obey the file.

---

## 9. Two shorter examples

### Class S — leftover English on a button

No spec. Edit `src/utils/translations.ts` + `src/utils/i18n.test.ts`. IMPACT skip. Gate: `npx vitest run src/utils/i18n.test.ts`.

### Class X — `STALE_TURN` poller

Specify **must** list `src/App.tsx` / `LogChat.tsx` / job files explicitly, and `JobSession.contract.test.ts` in `gate` (`AGENTS.md` L1). Food-calc files are Frozen. Do not mix with F-8.12 or F-10 in the same spec (`8742686`).

If two IDs both need `App.tsx`, **serialize** (ROADMAP already says this for B0 / F-9.5 / R-9). Two locked specs that share a file is a process fail — you unlock one.

---

## 10. Mapping to the rest of the stack

| Layer | In this process |
|-------|-----------------|
| Task contract | locked `specs/active/<ID>.md` |
| Context compiler | AGENTS.md load map + one `skill:` |
| Tool gateway | Allowed / Frozen / `patch` |
| Durable state | spec in git; chat is ephemeral |
| Evidence | named gate on the spec |
| Trace / recover | failure class + one repair |
| Governance | you lock; agent cannot unlock |
| Graph | Specify → Implement → Verify |

Product runtime (meal gate, SI converts, Front Desk handoff) is unchanged. Those are **Frozen files** unless a spec names them.

---

## 11. First-time checklist

- [ ] Copy `specs/TEMPLATE.md` → `specs/active/<ID>.md` via Specify
- [ ] You lock
- [ ] Implement patches Allowed only
- [ ] `node scripts/assert-spec-diff.mjs <ID>`
- [ ] Commit spec + code
- [ ] Move spec to `specs/done/` on COMPLETE
