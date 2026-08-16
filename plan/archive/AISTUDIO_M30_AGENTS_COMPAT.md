# AI Studio M30 — AGENTS.md compatibility & early-stop analysis

**Date:** 2026-08-12  
**Pack:** `studio/M30_FOOD_RESOLVER_CURATOR_MULTIPASS.md`  
**Plan:** `plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md`

---

## 1. Verdict

**Current `AGENTS.md` composition does *not* efficiently support “do the whole multi-phase plan in one multipass effort without stopping.”**  
It is optimized for **small, approval-gated, single-milestone Studio packs** — which is why agents keep stopping early even when the human wanted continuous execution.

The M30 pack **works around** those laws with an explicit **pre-approval + Autonomous Continuation Law**. That is necessary today. For durable efficiency, add a small always-on multipass clause (proposed § below) after human confirmation (`AGENTS.md` §3 protected).

---

## 2. What causes early stop (mapped to laws)

| Mechanism in AGENTS / process | Effect on long food-catalog work | Severity |
|------------------------------|----------------------------------|----------|
| **L11 Stage 1** — Strategic Report then **await approval** before code | Agent finishes investigation and **yields** even when user already pasted a full plan | **Critical** |
| **L3** — obtain user direction before significant multi-file changes | Same: multi-file curator work pauses mid-flight | **Critical** |
| **Binding Execution Law** only applies *after* approval | Without clear “this message is approval,” Stage 2 never starts | **Critical** |
| **Studio pack culture** (`PACKS.md`): ≤6 acceptance IDs, one pack, FIND→REPLACE | Multi-phase plan gets truncated to P0 only | **High** |
| **AI_HANDOVER “One focus / one Studio milestone”** | Agent treats end of phase as end of job | **High** |
| **L10 COMPLETE** + forbidden “all done” until gates | Good for honesty; agents mis-use by **stopping after partial gate** and asking human for next pack | **Medium** |
| **Non-Terminal Search Law** | Prevents stop-on-grep (good); does **not** force phase chaining | Neutral |
| **Protected docs §3** | Correct stop for rulebook edits; fine if pack authorizes food-calc update at end | Low if pack lists files |
| **L8 extract over god-file** | Good — keeps multipass implementable | Helpful |
| **L12 prompt net-zero** | Good constraint; agents may “stop” claiming can’t add scout lines — must remove lines instead | Medium if ignored |
| **Zero-Code-Change Exemption** | Fine | Neutral |

**Root cause in one line:** Stage-1 approval gate + single-milestone pack norms beat any architecture plan unless the user prompt **explicitly pre-approves multipass Stage-2 and forbids inter-phase yield**.

---

## 3. Does M30 instruction alone fix it?

| Gap | M30 pack mitigation | Residual risk |
|-----|---------------------|---------------|
| Stage-1 wait | Section A “PRE-APPROVAL waives L11 Stage-1” | Agent that doesn’t re-read pack mid-session may still stop |
| Phase boundary stop | “After phase tests pass → IMMEDIATELY next phase”; forbidden “say continue” | Weak models still summarize and yield |
| Context limit | Checkpoint in `AI_HANDOVER` + RESUME block | Human may need to open new chat if Studio UI can’t self-spawn |
| ≤6 acceptance IDs | STATUS table with many IDs; master gate | Conflicts with PACKS.md “≤6” — pack documents exception for multipass epic |
| Open-ended architecture | Points at frozen plan; phases are checklist not free design | Studio still weaker on inventing design — plan must stay detailed |

**Conclusion:** Upload **both** the plan + M30 pack + paste section A prompt. Without the pre-approval paragraph, L13 does not fire and default Stage-1 wait returns.

**L13 status:** Applied to `AGENTS.md` 2026-08-12 (human confirmed).

---

## 4. Applied laws (2026-08-12 — human confirmed)

| Change | Where |
|--------|--------|
| **L13 Multipass pre-approved epics** | `AGENTS.md` (L3/L11 cross-refs + L10 early-stop FAIL) |
| **Multipass exception (>6 IDs)** | `docs/agent/PACKS.md` § scope cap |

### food-calc.md one-liner (when M30 code lands — pack P5c)

```markdown
| Food Resolver | Catalog curator (1-iter): multi-match, merge, brand routing, basis normalize, quarantine + aliases — not primary calorie estimator; not invoked on HIT_UNIQUE atomics |
```

---

## 5. How to run AI Studio (with L13 live)

1. Upload / ensure tree has:
   - `plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md`
   - `studio/M30_FOOD_RESOLVER_CURATOR_MULTIPASS.md`
   - `AGENTS.md` with L13
2. Paste **only** section **A** of M30 as the chat prompt (includes PRE-APPROVED + MULTIPASS AUTONOMOUS — triggers L13).
3. Prefer a **stronger model** for multipass (pro-class), not lite — control flow + multi-file.
4. If Studio UI forces a new chat: open new chat with the one-liner from M30 §H RESUME (also left in `AI_HANDOVER`).
5. Do **not** also paste “please investigate and propose options first” — that re-enables L11 Stage 1 stop outside L13 intent.

---

## 6. What *not* to change in AGENTS

Keep:

- Non-Terminal Search Law (stops useless grep-end turns)
- Binding Execution Law after approval (M30 makes approval explicit)
- L8 extract helpers
- L10 honest COMPLETE + real gates
- §4 AI Studio only commits
- Protected docs confirmation (M30 lists food-calc in-scope at P5)

---

## 7. Summary for human

| Question | Answer |
|----------|--------|
| Can AI Studio do the full plan in multipass under current AGENTS? | **Only if** the prompt pre-approves and forbids inter-phase wait (M30 §A). |
| Why does he stop early by default? | **L11 Stage 1 + L3 + single-milestone pack norms.** |
| Is AGENTS “wrong”? | No — safe for small fixes; **hostile to epics** without L13/multipass exception. |
| Best next step | Run M30 with section A paste; optionally confirm L13 into `AGENTS.md` so future epics don’t need a novel waiver each time. |
