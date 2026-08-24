# AGENTS.md — Always-on rules (keep short)

**Updated:** 2026-08-21  

**Token rule:** Read **this file first**. Load domain rulebooks (`docs/agent/**`) **only when the table below says so**. (Investigating application source code, debug logs, and relevant functions is always permitted and encouraged; do not dump unneeded rulebook docs).

---

## 0. Document roles (where context lives)

| Doc family | Role | Agents may freely update? |
|------------|------|---------------------------|
| **`AI_HANDOVER.md`** | **WIP board:** status so far, what’s in progress, next focus, multi-agent handoff notes | **Yes** — preferred place for session progress |
| **`plan/`** | **Architecture & planned design** (modal, food-calc, hybrid storage, bugs…) | Only when design actually changes; keep architecture durable |
| **`AGENTS.md` + `docs/agent/**`** | **Process laws + domain rulebooks + regression map** | **No — protected** (see §3) |
| **`studio/`** | One active Studio pack | Yes when authoring packs |
| **`archive/`** | Completed packs | Move on COMPLETE; do not re-upload as current |

```text
plan/          = what we designed / still intend (architecture)
AI_HANDOVER.md = where we are now (status, WIP, handoff)
AGENTS + docs/agent = how we work without breaking each other (stable process)
```

**Multi-agent context** goes in **`AI_HANDOVER.md`** (short “Session notes” / WIP rows), **not** by rewriting laws mid-flight.

- **Zero-Code-Change Exemption (Token-Saving Law):** Run tests, `tsc`, and regression gates **ONLY when application source code is modified** (`src/`, `server.ts`, `server_*.ts`, `agents/`, `supabase/`). For doc updates, explanations, question answers, folder mirroring/sync ops, or file reviews where NO application code changed, **STRICTLY SKIP running test suites and gate verification runs** to eliminate token and context waste.

---

## 1. Load map (do not open everything)

| Task involves… | Read |
|----------------|------|
| Status / WIP / handoff | `AI_HANDOVER.md` |
| Architecture / planned design | matching file under `plan/` |
| Writing a Studio pack | `docs/agent/PACKS.md` |
| Food-calc | `docs/agent/domains/food-calc.md` |
| Biomarkers | `docs/agent/domains/biomarkers.md` |
| Multi-device sync | `docs/agent/domains/sync.md` |
| Which tests to run | `docs/agent/DOMAIN_REGRESSION_MAP.md` |
| IMPACT / SELF-CHECK / GATE paste | `docs/agent/TEMPLATES.md` |
| Active Studio pack name | `studio/ACTIVE_STATUS.md` |
| User says **work bug** / **next bug** / **work 11** | **L15**. Not a bare “continue” or “work”. |

**Default loop:** board (`AI_HANDOVER`) → domain rulebook if needed → implement → domain gates → COMPLETE format → update board.

---

## 2. Coding Laws (every session)

### L1 — Blast radius (anti-random-deletion)
Touch **only** files required for the task. No drive-by refactors, renames, or “cleanup.”  
Do not remove branches, error handlers, fallbacks, or **mode-tagged / gate-used logs** unless listed in scope.

### L2 — Contracts
No breaking signature/API/prop changes without updating **all** call sites in the same task. Prefer optional params + defaults.

### L3 — Full autonomous execution
Perform comprehensive deep investigation across all relevant files and execute durable solutions without pausing mid-investigation. 

### L4 — Full implementation
No placeholders or stub delivery. Import without **correct-path call site** = FAIL.

### L5 — Sibling paths
One path fixed ≠ feature done. Shared helper + all call sites, **or** explicit known-broken in `AI_HANDOVER.md`.

### L6 — Data field preservation
Do not drop existing merge/construct fields unless scoped + consumers audited.

### L7 — Detect AND repair
Detection-only is incomplete when repair is in scope.  
Repair = fix the **class** (ranker refuse, restore a dropped dish, stop a silent scale).  
It does **not** mean paint a meal green (catalog `includes()`, alias, `expected.json`, `POST /loop`). See L14.

### L8 — Prefer extract over god-file rewrites
Hot pure logic → small modules + tests; thin call sites in `server.ts` / `App.tsx`.

### L9 — Domain rulebooks: guide, don’t fossilize
If the task hits food-calc / biomarkers / sync: **read** that domain file.

- Default: follow invariants (they prevent the regressions we already paid for).  
- **Product evolution is allowed:** if the app intentionally changes a pipeline, key scheme, or store role, update the rulebook **with confirmation** (§3) **in the same change**, and update tests/gates.  
- Do **not** invent a silent alternate pipeline “just for this bug.”  
- Do **not** treat rulebooks as a ban on new features — only as a checklist against accidental breakage.

### L11 — Autonomous Continuous Execution Protocol
When addressing tasks, bug fixes, or feature plans, agents execute end-to-end in a single continuous turn:
1. **Autonomous Deep Investigation**: Perform thorough multi-file inspection across all relevant files without pausing mid-turn.
2. **Durable Implementation**: Apply pure TypeScript middleware / code modifications directly (anti-patch guarantee). Never use stubs or placeholders.
3. **Automated Verification**: Run tests, type checks (`tsc`), and regression gates to verify zero cascade breakages. Any live AI tests, mock evaluations, or script runs MUST use the `gemini-3.5-flash-lite` model by default.
4. **Mandatory Executive Response Format (Zero Code Dumps)**:
   All completion responses MUST strictly adhere to this format:
   - **Root Cause & Diagnosis:** (1–2 concise sentences)
   - **Key Changes Applied:** (2–4 high-level architectural bullets; no code blocks or diffs)
   - **Verification:** (Pass/Fail status for build, `tsc`, tests, and gates)
   *(Pasting raw code blocks, file contents, or diffs in chat is strictly prohibited).*

### L12 — Strict Prompt Line-Budget & Anti-Bloat Rule
- **Strict Copy Length & Line Ceiling**: When updating agent instructions (system prompts in `server_vision_scout.ts`, dietitian instructions, biomarker agents), the total copy length/word count must by default remain equal to or less than before. Content MUST be consolidated instead of adding more (net-zero line/word growth). Adding more content than existing requires explicit human approval first.
- **Default Test & Runtime Model**: Any test, benchmark, or prototype call should be executed using the `gemini-3.5-flash-lite` model by default.
- **No Prompt-Based Code**: Business logic, math, unit conversions, brand overrides, and data sanitization MUST live in pure TypeScript middleware, NEVER in English prompt instructions. Prompts are strictly for classification and schema extraction under 200 words.

### L13 — Multipass Epic Continuation (Anti Early-Stop)
When executing multi-phase plans (e.g. `studio/M*.md` or `plan/*.md`):
- After each phase's tests pass, the agent **must immediately start the next phase in the same continuous stream**.
- Ending a turn with only “ready for Phase N when you say continue” (or similar) while checklist IDs remain = **FAIL**. Pack/phase **continue** is L13, not L15.
- On context pressure: write `AI_HANDOVER.md` multipass checkpoint + RESUME line, then continue from checkpoint without re-auditing the whole repo.
- L10 COMPLETE requires the named master gate to exit code 0.

This law does **not** waive protected-doc confirmation (§3) unless the pack lists those files as in-scope.

### L14 — Multi-job OK, retry-loops forbidden
When asked to fix bugs (one ticket or a whole registry):

1. **Split into independent jobs.** A 7-row table is several jobs, not one meal-green search. Run them in the **same turn** when files do not collide. Do not stop after job 1 and ask the human to continue.
2. **Work item = class, not meal `all_green`.** Classify first: `FALSE_FRIEND` · `DISH_DROP` · `OPENING_WRONG` · `SILENT_REPAIR` · `CALL_BUDGET` · `INFRA_LATENCY`. One class per job. Other reds on that meal are out of session.
3. **Inner loop = named vitest, never `/loop`.** Forbidden as the way you work:
   - `POST /api/golden/cases/:id/loop`
   - Replaying the same meal until `all_green`
   - Adding another `includes()` / hard-pass and retrying
   - Grepping a ghost (e.g. a Chat Router that is not on the food path) past one failed hypothesis
4. **Hypothesis budget.** Each job: `class` + hypothesis + predicted test + one allowed file. Predicted test does not flip → hypothesis **burned**. Two burns → **STOP that job** (`blocked_human`) and start the next independent job. Do not invent a third cheat.
5. **Forbidden unless the class names them:** `server_food_db.ts`, `food_aliases`, golden `expected.json`, dietitian prompt bloat. Exact `expectFdcId` is **not** the reward.
6. **Honest residual is done.** `MISS` / cannot resolve / needs human is a valid terminal. Do not bind a false friend to paint green. Do not steal a sibling component’s row. A **meal trial-balance miss** (backend/dietitian correction, narrative ≠ table) stays red and classifies `SILENT_REPAIR` / `DISH_DROP` — do not “repair” the books to green.
7. **Durable test:** the inner test must fail on a *new* food of the same class (query-scoped pool, not “G8 sugar”). If the test only mentions one FDC, it is a patch.
8. **Parallel is required, retry-loop is not.** Different classes / different files = do them now. Same-file collision = serialize those two only. Human only at `blocked_human`.

This law **overrides L11 / L13** when they would mean “keep `/loop`-ing or grepping until the meal is green.” Continuous execution = the next **job**, not the next **replay**.

### L15 — Bug queue (all agents)

**Triggers (only these):** `work bug` (current in-progress card) · `next bug` (the following card) · `work 11` / `work #11` (that number) · a **Hand off** paste that starts with `AGENTS.md L15`.

**Not L15:** a bare **continue** or **work** (pack phase / L13 / current task). The JSON field `continue` on `/api/bugs/next` is the ticket object, not a user phrase.

1. **Live ticket** (`http://127.0.0.1:3000` then `localhost:3000`):  
   - `work bug` → `GET /api/bugs/next` (in-progress remaining, else first ready)  
   - `next bug` → `GET /api/bugs/next?mode=next` (skips the current card)  
   - `work 11` / `work #11` → `GET /api/bugs/next?n=11`  
   **No live API** (GitHub-only Claude): the **Hand off** clipboard is the ticket. Do not invent remaining from git.
2. `continue.stop` → quote `continue.say`, **one** summary. Auto checks green → **human to do** (visual/UI only). Do not Promote from chat.
3. Else **drain failing automatic tape checks**. Work **only** `continue.active_line` (one class, one file). After `POST /attempts`, `GET /api/bugs/next` (tape re-score). If `stop=false`, immediately work the new `active_line`. Do not wait for the human. Visual/UI remaining is human — skip it.
4. Named vitest must fail on a **new** food of that class (not this meal’s FDC list). Claimed `result=pass` does **not** paint remaining; remaining comes from the tape.
5. End every line: `POST /api/bugs/<tag_id>/attempts` `{ line: <active_line exactly>, hyp, file, test, result, burned, note }`. `burned=false` only if that test flipped. Two misses park that line. 409 paint/weak_test/paint_fdc/wrong_file does not advance.
6. One trigger = this card’s **auto** fails. Stop when auto checks are green or blocked (`stop=true`). Then human reviews screenshots / a11y / copy.
7. **Do not:** `POST /loop` · `PATCH remaining` to `[]` / `queue=done` · `CANONICAL_BASE_FOODS` `includes()` for this meal · `food_aliases` / `expected.json` paint · invent files · retry **DO NOT RETRY** · mark the card done from chat · ask the human to say continue between auto lines.

L15 **overrides L11** for those trigger phrases: drain automatic tape checks, not “green this meal from chat.” Pack **continue** stays L13. L14 class/test/catalog-paint rules still apply.

### L10 — COMPLETE
All of: IMPACT (L/X) · SELF-CHECK · (if code changed: `tsc` · domain regression map commands · pack assert if any; skip if doc/ops only) · paths verified or known-broken noted.

**Forbidden until then:** “all done” / “fully verified” / “nothing left.”  
**Auto FAIL:** import without call site · silent half-fix · detect without repair · simulated tool output / fake edit completion · dropped fields · gate weakened · drive-by scope · early-stop mid multipass epic while checklist IDs remain (L13) · `POST /loop` or meal-replay as the inner work method (L14) · claiming Fixed after a catalog/`includes()` paint.

---

## 3. Protected docs (confirmation + before/after required)

These files define how **all** agents work. Random edits dilute process and break multi-agent coordination.

**Protected set:**

- `AGENTS.md`
- `docs/agent/**` (rulebooks, PACKS, DOMAIN_REGRESSION_MAP, TEMPLATES, README)
- Gate scripts that encode pack acceptance (`scripts/assert-*.mjs`) **when changing acceptance meaning** (not when only adding a new assert file for a pack)

### Rules

1. **Do not edit protected docs** as part of an unrelated feature/bugfix.  
2. If a protected edit is needed (evolution, correction, new domain):  
   - **Stop and ask the human for confirmation** first, **or** only do it when a Studio pack explicitly lists that file as in-scope.  
   - Show a **concise summary of changes** when asking for confirmation (do NOT show full code unless it is a change to agent system instructions in prompt/modal).  
   - State **why** (product change / missing invariant / token fix).  
3. Prefer recording ephemeral status in **`AI_HANDOVER.md`**, not by rewriting laws.  
4. When product evolution changes an invariant: update domain rulebook + tests **together** so process stays honest — never leave stale laws that contradict code.

---

## 5. Change classes

| Class | Examples | Process |
|-------|----------|---------|
| **S** | Copy, CSS | light |
| **M** | One helper + tests | unit tests |
| **L** | Multi-mode food, biomarker pipeline | domain doc + regression map + IMPACT |
| **X** | Sync/tombstones, identity, protected docs | confirmation + IMPACT + second look |

---

## 6. Studio packs (summary)

1. One active pack under `studio/`.  
2. ≤6 acceptance IDs by default; FIND→REPLACE / small swaps; machine gate exit 0.  
   **Multipass exception (L13):** packs marked PRE-APPROVED / MULTIPASS AUTONOMOUS may exceed 6 IDs when closed by one master gate — see `docs/agent/PACKS.md`.  
3. **Commit/push allowed** from this workspace after COMPLETE (`tsc` + named gates). AI Studio remains a valid ship path, not the only one.  
4. After true COMPLETE: archive pack; update `AI_HANDOVER.md`.

---

## 7. Bug & Diagnostic Investigations
When investigating user bug logs, errors, or diagnostic reports, deep multi-file inspection and reading the provided diagnostic markdown file is expected and encouraged.
Spec: `plan/BUG_TRACKING_COMPREHENSIVE_PLAN.md`.  
**Queue work** (`work bug` / `next bug` / `work 11` / Hand off) follows **L15**.

---

## 8. Keep this file short

If always-on content grows past ~one screen of laws + index, **move detail out** (with §3 confirmation) — do not dilute context with pack templates or full domain tables here.
