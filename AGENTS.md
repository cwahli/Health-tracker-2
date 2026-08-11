# AGENTS.md — Always-on rules (keep short)

**Purpose:** Reduce cascade bugs from multi-agent AI work — without freezing product evolution.  
**Repo:** https://github.com/cwahli/Health-tracker-6  
**Updated:** 2026-08-09  

**Token rule:** Read **this file first**. Load other docs **only when the table below says so**. Do not dump all domain rulebooks into every session.

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

**Zero-Code-Change Exemption (Token-Saving Law):** Run tests, `tsc`, and regression gates **ONLY when application source code is modified** (`src/`, `server.ts`, `server_*.ts`, `agents/`, `supabase/`). For doc updates, explanations, question answers, folder mirroring/sync ops, or file reviews where NO application code changed, **STRICTLY SKIP running test suites and gate verification runs** to eliminate token and context waste.

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

**Default loop:** board (`AI_HANDOVER`) → domain rulebook if needed → implement → domain gates → COMPLETE format → update board.

---

## 2. Coding Laws (every session)

### L1 — Blast radius (anti-random-deletion)
Touch **only** files required for the task. No drive-by refactors, renames, or “cleanup.”  
Do not remove branches, error handlers, fallbacks, or **mode-tagged / gate-used logs** unless listed in scope.

### L2 — Contracts
No breaking signature/API/prop changes without updating **all** call sites in the same task. Prefer optional params + defaults.

### L3 — Scope honesty
- **S** (1 file): implement directly.  
- **M** (multi-file): ≤3-bullet plan then code.  
- **L/X** (multi-path, merge, sync, dictionary): paste **IMPACT** first (`docs/agent/TEMPLATES.md`). Scope grows → **stop and report**.

### L4 — Full implementation
No placeholders or stub delivery. Import without **correct-path call site** = FAIL.

### L5 — Sibling paths
One path fixed ≠ feature done. Shared helper + all call sites, **or** explicit known-broken in `AI_HANDOVER.md`.

### L6 — Data field preservation
Do not drop existing merge/construct fields unless scoped + consumers audited.

### L7 — Detect AND repair
Detection-only is incomplete when repair is in scope.

### L8 — Prefer extract over god-file rewrites
Hot pure logic → small modules + tests; thin call sites in `server.ts` / `App.tsx`.

### L9 — Domain rulebooks: guide, don’t fossilize
If the task hits food-calc / biomarkers / sync: **read** that domain file.

- Default: follow invariants (they prevent the regressions we already paid for).  
- **Product evolution is allowed:** if the app intentionally changes a pipeline, key scheme, or store role, update the rulebook **with confirmation** (§3) **in the same change**, and update tests/gates.  
- Do **not** invent a silent alternate pipeline “just for this bug.”  
- Do **not** treat rulebooks as a ban on new features — only as a checklist against accidental breakage.

### L11 — SDD & 2-Turn Execution Protocol (Mandatory for Class M/L/X)
For non-trivial fixes or features (Class M/L/X), execution MUST follow a 2-turn protocol:
- **Turn 1 (SDD Spec Phase)**: Write or update a Software Design Document in `plan/<task_name>.md`. Define:
  1. **Structural Root Cause**: Diagnosis across full application architecture.
  2. **Code Pruning Inventory**: List of obsolete conditionals, regexes, or functions to DELETE (net-zero/negative complexity growth).
  3. **Deterministic Boundary**: Explicit split between LLM prompt role (strictly schema extraction/classification) and TypeScript logic (unit conversions, math, sanitization).
  4. **Telemetry Audit**: Logging strategy using central `logger` (clean up transient logs, no duplicate terminal noise).
  5. **Regression Test Plan**: Vitest suites to run and verify.
  *DO NOT edit application source code during Turn 1.*
- **Turn 2 (Execution Phase)**: Delete obsolete code, implement clean TS helpers, pass regression gates, and submit.

### L12 — Strict Prompt Line-Budget & Anti-Bloat Rule
- **Strict Prompt Line Ceiling**: System prompts (in `server_vision_scout.ts`, dietitian instructions, biomarker agents) are strictly capped. Adding new lines to a prompt is FORBIDDEN unless an equivalent number of redundant/outdated prompt lines are removed in the same edit (net-zero line growth).
- **No Prompt-Based Code**: Business logic, math, unit conversions, brand overrides, and data sanitization MUST live in pure TypeScript middleware, NEVER in English prompt instructions. Prompts are strictly for classification and schema extraction under 200 words.

### L10 — COMPLETE
All of: IMPACT (L/X) · SELF-CHECK · (if code changed: `tsc` · domain regression map commands · pack assert if any; skip if doc/ops only) · paths verified or known-broken noted.

**Forbidden until then:** “all done” / “fully verified” / “nothing left.”  
**Auto FAIL:** import without call site · silent half-fix · detect without repair · dropped fields · gate weakened · drive-by scope.

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

## 4. Git / GitHub: commits only via AI Studio

**Binding (agents forget this — read twice):**

| Who | May commit / push to `origin`? |
|-----|--------------------------------|
| **AI Studio** (Studio pack session with human) | **Yes** — after gate exit 0 |
| Grok / Claude / Cursor / other local agents | **No** — prepare files, packs, gates only |

Local agents **must not**:

- `git commit` / `git push` / force-push / amend published history to GitHub  
- “Just ship it” after a chat fix  

Local agents **may**:

- Edit the working tree  
- Run tests/gates  
- Update `AI_HANDOVER.md` WIP notes  
- Author `studio/M*.md` for the human to upload  

**Ship path:**

```text
Local agent prepares code + studio pack
  → human uploads pack (+ docs if needed) to AI Studio
  → AI Studio applies / verifies gate exit 0
  → AI Studio commits + pushes to GitHub
  → board (AI_HANDOVER) updated; pack archived
```

Full pack craft: `docs/agent/PACKS.md`.

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
2. ≤6 acceptance IDs; FIND→REPLACE / small swaps; machine gate exit 0.  
3. **Commit/push = AI Studio only** (§4).  
4. After true COMPLETE: archive pack; update `AI_HANDOVER.md`.

---

## 7. Bugs (token-saving)

Prefer `GET /api/bugs/open`; a11y + `domain_pack.json`; deep-fetch only if blocked.  
Spec: `plan/BUG_TRACKING_COMPREHENSIVE_PLAN.md`.

---

## 8. Keep this file short

If always-on content grows past ~one screen of laws + index, **move detail out** (with §3 confirmation) — do not dilute context with pack templates or full domain tables here.
