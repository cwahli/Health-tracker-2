# AGENTS.md — Always-on rules (keep short)

**Purpose:** Reduce cascade bugs from multi-agent AI work — without freezing product evolution.  
**Repo:** https://github.com/cwahli/Health-tracker-2  
**Updated:** 2026-08-11  

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

**Core Autonomous Invariants (Always-On):**
- **Non-Terminal Search Law (Continuous Investigation):** A `grep`, search, or file-find command is **NEVER a valid ending to a turn**. An agent is strictly forbidden from ending its turn on a search/grep output (whether results are matching, partial, or completely empty). The agent MUST continue investigating, inspecting source files, and analyzing until it delivers the **complete Stage 1 Strategic Report** before yielding. If a search yields 0 results, immediately broaden keywords or search the pipeline mechanism in `server.ts`. Ending a turn on a search tool is an immediate auto-failure.
- **Binding Execution Law:** Once the user gives approval or commands an action, agents **MUST NOT yield the turn after reading files**. Reading lines must be chained immediately with the write tool (`replace_file_content`), tests, and verification in a single continuous execution.
- **Anti-Simulation & Real Disk Verification Law:** Agents are strictly forbidden from outputting simulated tool responses, fake `MDout:` logs, or fabricated terminal logs in text. If an edit tool fails or returns `(nil ToolCall)`, the agent MUST treat the file as unedited, fix the parameters, and re-invoke the write tool. A task is NEVER complete without verifying actual disk writes via real machine tool execution (e.g. `tsc`, tests, or build tool calls).
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

**Default loop:** board (`AI_HANDOVER`) → domain rulebook if needed → implement → domain gates → COMPLETE format → update board.

---

## 2. Coding Laws (every session)

### L1 — Blast radius (anti-random-deletion)
Touch **only** files required for the task. No drive-by refactors, renames, or “cleanup.”  
Do not remove branches, error handlers, fallbacks, or **mode-tagged / gate-used logs** unless listed in scope.

### L2 — Contracts
No breaking signature/API/prop changes without updating **all** call sites in the same task. Prefer optional params + defaults.

### L3 — Scope honesty & continuous execution
- Perform comprehensive deep investigation across all relevant files without pausing mid-investigation.
- Present architectural trade-offs concisely and obtain user direction before executing significant multi-file changes.

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

### L11 — Autonomous Investigation & Strategic Proposal Protocol
When addressing non-trivial tasks or fixes, agents MUST follow the 2-stage interaction model:

1. **Stage 1 — Autonomous Deep Investigation & Strategic Report (No mid-way pausing)**:
   - **Non-Terminal Search Law**: A `grep` or search command is strictly an intermediate tool call, NEVER a turn-ending response. Agents MUST NOT stop after a search (even if 0 matches are returned). The agent must chain `view_file`, broaden query terms, or trace the pipeline in `server.ts` until it delivers the complete **Stage 1 Strategic Report** in that single turn. Ending a turn on a search tool is an immediate fatal failure.
   - **Continuous Investigation**: Perform thorough multi-file inspection and codebase analysis autonomously. Never stop mid-turn after `grep` or `view` to ask the user to say "continue".
   - **Strategic & Best-Practice Review**: Evaluate industry best practices and research how the problem is standardly solved. Account for potential future failure modes and ensure the solution is durable (anti-patch guarantee).
   - **Concise Architectural Proposal (No Raw Code Dumps)**: Present a clear, high-level summary:
     - **Structural Root Cause & Diagnosis**
     - **Options & Trade-offs**: Compare available approaches (e.g. Option A: quick patch vs. Option B: durable structural solution, with clear Pros and Cons).
     - **Future Failure Mode Analysis**: Explicit explanation of how edge cases and downstream risks are mitigated.
     - **Key Points of Proposed Changes**: Concise architectural bullets (*strictly avoid dumping large code blocks*).
   - **Request Approval / Direction**: Await user selection or confirmation before applying edits to application source code.

2. **Stage 2 — Post-Approval Autonomous Execution**:
   - **Binding Execution Law**: Once the user gives approval or commands an action, the agent **MUST NOT yield the turn after reading or viewing files**. Reading lines to prepare an edit must be chained immediately with the write tool (`replace_file_content`), tests, and verification in a single continuous execution.
   - Execute all required file changes in a single continuous flow.
   - Run tests, type checks (`tsc`), and regression gates to verify zero cascade breakages.
   - **Mandatory Executive Response Format (Zero Code Dumps)**:
     All completion responses MUST strictly adhere to this format:
     - **Root Cause & Diagnosis:** (1–2 concise sentences)
     - **Key Changes Applied:** (2–4 high-level architectural bullets; no code blocks or diffs)
     - **Verification:** (Pass/Fail status for build, `tsc`, tests, and gates)
     *(Pasting raw code blocks, file contents, or diffs in chat is strictly prohibited).*

### L12 — Strict Prompt Line-Budget & Anti-Bloat Rule
- **Strict Prompt Line Ceiling**: System prompts (in `server_vision_scout.ts`, dietitian instructions, biomarker agents) are strictly capped. Adding new lines to a prompt is FORBIDDEN unless an equivalent number of redundant/outdated prompt lines are removed in the same edit (net-zero line growth).
- **No Prompt-Based Code**: Business logic, math, unit conversions, brand overrides, and data sanitization MUST live in pure TypeScript middleware, NEVER in English prompt instructions. Prompts are strictly for classification and schema extraction under 200 words.

### L10 — COMPLETE
All of: IMPACT (L/X) · SELF-CHECK · (if code changed: `tsc` · domain regression map commands · pack assert if any; skip if doc/ops only) · paths verified or known-broken noted.

**Forbidden until then:** “all done” / “fully verified” / “nothing left.”  
**Auto FAIL (Stage 2 execution):** import without call site · silent half-fix · detect without repair (when repair was approved) · simulated tool output / fake edit completion · dropped fields · gate weakened · drive-by scope.

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

## 7. Bug & Diagnostic Investigations
When investigating user bug logs, errors, or diagnostic reports, deep multi-file inspection and reading the provided diagnostic markdown file is expected and encouraged.
Spec: `plan/BUG_TRACKING_COMPREHENSIVE_PLAN.md`.

---

## 8. Keep this file short

If always-on content grows past ~one screen of laws + index, **move detail out** (with §3 confirmation) — do not dilute context with pack templates or full domain tables here.
