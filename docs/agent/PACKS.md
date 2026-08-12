# Studio pack authoring (load on demand)

**Audience:** Humans / agents writing AI Studio packs.  
**Always-on laws:** root `AGENTS.md` (still apply).  
**Do not** paste this whole file into every coding session — only when authoring or auditing packs.

Honesty / COMPLETE rules: embed a short COMPLETE block in each `studio/M*.md` (or cite `archive/aistudio-instructions/HONEST_COMPLETION_RULES.md`).

---

## 0. Workflow

1. Status from **`AI_HANDOVER.md`** (WIP). Architecture from **`plan/`** if design needed.  
2. Write **one** pack into `studio/`.  
3. Human uploads pack to **AI Studio** (and docs if the pack says so).  
4. Studio implements + gate exit 0.  
5. **AI Studio commits and pushes** to GitHub (local Grok/Claude/Cursor **must not** push).  
6. Archive pack; update `AI_HANDOVER.md` board.

| Step | Where |
|------|--------|
| WIP / status / multi-agent notes | `AI_HANDOVER.md` |
| Architecture plans | `plan/` |
| Process laws / rulebooks | `AGENTS.md`, `docs/agent/**` (protected — pack must list if editing) |
| Active pack | `studio/` + `studio/ACTIVE_STATUS.md` |
| Done packs | `archive/studio/` |

**Do not:** leave finished packs in `studio/` forever · invent steps without board/plan audit · local-agent `git push`.

### Lifecycle

```text
plan/ (design) + AI_HANDOVER (status)
  → studio/M*.md
  → AI Studio gate 0
  → AI Studio commit + push
  → archive/ + AI_HANDOVER update
```

### What Studio receives

| Correct | Incorrect |
|---------|-----------|
| One pack file (may instruct multi-file tree if governance ship) | Open-ended “fix everything” |
| FIND→REPLACE or listed full files | Random rewrite of protected docs without before→after |
| Gate exit 0 then **Studio** commit/push | Local agent claimed COMPLETE + pushed |

### Other initiatives

- i18n: paused unless board says resume.  
- Food-calc history: `archive/`; new work = delta pack after audit.  
- Cloudflare images greenfield: separate plan; do not mix into unrelated packs.

---

## 1. Studio strengths / weaknesses

| Good at | Bad at |
|---------|--------|
| Exact FIND→REPLACE | Open-ended architecture |
| Small file swaps | Huge god-file rewrites |
| Grep/assert with unique strings | Honest multi-mode judgment |
| Small continuous task lists | “Is Mode D done too?” |

**Rule:** You supply snippets + gates + matrix. Studio will not invent the audit.

---

## 2. Failure pattern (do not forget)

1. Happy path only → claim all done  
2. Import without call site  
3. Detect without repair  
4. Grep theater  
5. Second-order field wipe on merge  
6. Soft work overwritten after reconcile  
7. Huge pack partial + overclaim  
8. Sibling modes skipped  

**Diagnosis:** greppable artifacts ≠ product paths. Each acceptance row needs unique evidence.

---

## 3. Pack shape

```text
A. Short user prompt
B. Anti-miss / honesty rules
C. Already DONE — do not rebuild
D. Mode / path matrix
E. FILE SWAP and/or FIND → REPLACE
F. Machine gate (assert-*.mjs)
G. STATUS table (one row per ID)
H. Out of scope + order
```

| Change kind | Delivery |
|-------------|----------|
| Pure logic | Full swap ≤3 files |
| Call sites | FIND→REPLACE |
| Scout field | Schema + snippet, not full rewrite |
| Giant rewrite | Avoid — extract helper |

**Scope cap:** ≤6 acceptance IDs. Prefer delta packs after audit.

**Exception — multipass epics:** A single pack may exceed 6 acceptance IDs when it is titled **MULTIPASS** (or states **MULTIPASS AUTONOMOUS** / **PRE-APPROVED**), is tied to one `plan/*.md` architecture file, and is closed by **one master** `assert-*.mjs`. Prefer this over N small packs that each stop for human “continue.” See `AGENTS.md` **L13**. Inter-phase “say continue” while checklist IDs remain = FAIL.

---

## 4. Mode matrix (food / multi-path)

| Behavior | Mode A | Mode D | Edit |
|----------|--------|--------|------|
| … | log/call | log/call | log/call |

Mode A PASS ≠ D/Edit. Distinct log tags required. COMPLETE only if every cell PASS or explicit N/A.

Domain detail: `docs/agent/domains/food-calc.md`. Biomarker multi-agent matrix: `domains/biomarkers.md`.

---

## 5. Acceptance criteria

**Good:** call site `fn\s*\(` · exact mode log · field preserve pattern · REPAIR not only FAIL · assert exit 0.  
**Bad:** “implement properly” · “all modes” · “fully verified.”

---

## 6. Second-order (food) — summary

Merge preserve · reconcile only locks · scale components · detect+repair · fail-open · match priority · import on each branch.  
Full table: `domains/food-calc.md`.

---

## 7. Machine gates

```bash
node scripts/assert-<pack>.mjs   # exit 0
npx vitest run <named>
```

| Do | Don’t |
|----|--------|
| Require call not only import | Match import line only |
| Mode-tagged logs | One generic tag for all modes |
| REPAIR if repair required | FAIL log only |
| 8–15 solid checks | 50 vague greps |

Domain map: `docs/agent/DOMAIN_REGRESSION_MAP.md`.

### COMPLETE policy (paste into packs)

```text
COMPLETE only if:
  1. STATUS every row PASS with branch evidence
  2. assert exit 0
  3. named vitest exit 0
Forbidden: all done / fully verified / nothing left
Import without call site = FAIL
One path only = FAIL if matrix requires more
```

Also obey root `AGENTS.md` L10.

---

## 8. FIND → REPLACE quality

- 15–40 lines unique context (not line numbers alone)  
- One REPLACE per behavior  
- **Done when:** exact string or test name  

---

## 9. Authoring loop

```text
1. Audit origin/main — PASS/FAIL only
2. DELTA pack for FAILs only
3. Anti-miss + matrix + gate
4. Studio implements
5. Independent re-audit
6. FAIL → smaller delta, not new epic
```

Do not trust Studio STATUS without re-audit.

---

## 10. User prompt templates

**Delta:** Follow pack only · no rebuild DONE · every matrix cell · STATUS · COMPLETE only if gate 0 · forbidden overclaim phrases.

**Continuous:** Do not stop after first easy item and claim COMPLETE.

**Overclaim mid-flight:** INCOMPLETE · mark FAIL · continue from first FAIL · import without call site = FAIL.

---

## 11. Food-calc product memory

See **`docs/agent/domains/food-calc.md`** (single source). Do not duplicate long tables here long-term.

---

## 12. Anti-patterns for pack authors

| Don’t | Do |
|-------|-----|
| 5 overlapping docs | One pack |
| Re-ask “all food calc” | Audit → delta |
| “121 tests passed” alone | Name the tests |
| Symbol-exists gates | Call site + mode + repair |
| Skip re-audit | Always verify |

---

## 13. Checklist before upload

- [ ] ≤6 IDs · Already-DONE table · path matrix  
- [ ] Second-order listed if relevant  
- [ ] FIND→REPLACE or swaps · assert script  
- [ ] STATUS + forbidden COMPLETE phrases  
- [ ] Gate exit 0 forced · out of scope listed  
- [ ] Domain rulebook cited if food/biomarker/sync  

---

## 14. Bug briefs

Same as `AGENTS.md` §5 — prefer open bugs API; a11y + domain_pack; no full R2 dumps by default.

---

## 15. For Grok / Claude preparing Studio work

1. Board + plan  
2. Audit origin honestly  
3. One pack in `studio/`  
4. On true COMPLETE → archive + board  
5. Durable process: `AGENTS.md` + this file + domain rulebooks — not chat-only notes  
