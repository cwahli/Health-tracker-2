# Domain rulebook: Debug contract report

**Pillar:** 3 — Reliability (run artifact / agent observability).  
**Load when:** debug download, `debugPayload`, `dumpContract`, `test-from-debug`, Log Meal card vs dump, stall/503 dumps, Front Desk handoff dumps, food multi-edit dumps.  
**Do not load** for pure food-calc math, USDA, or i18n-only copy.

**Architecture (execute IDs):** `plan/RELIABILITY.md` §10–§11 · `plan/ROADMAP.md` **F-8.13** + **Q-8**  
**WIP:** `AI_HANDOVER.md`  
**Code:** `src/utils/debugPayload.ts` (markdown view) · `src/utils/dumpContract.ts` (scorer) · `scripts/test-from-debug.ts` · cold debug JSON on R2  
**Gates:** `docs/agent/DOMAIN_REGRESSION_MAP.md` → job **process** golden / debug row.

**This file is the durable truth.** ROADMAP IDs and RELIABILITY §11 may be shortened; do not delete these laws without a before→after and tests in the same change.

**How to use:** One download per job is the contract report for **that run**. Inner loop = score the **JSON tree**, not another live meal. Markdown is a human view of the same tree.

---

### Before → after (2026-09-04)

| Before | After |
|--------|--------|
| Debug.md is a long narrative; matrix looks like a scoreboard and can **lie** (calc Standby with a ledger in logs) | **Contract table first**; matrix must match logs |
| Same prompt in “Agent instructions” **and** backend logs; same crumb pasted twice | Builder dedupes **serialization**. **Process** duplicates (AnalyzeFinished ×4) stay and are **scored** |
| Card / Retry / Attempt 1 of 3 not in the file | **Dialog inventory** at Download (structured tree, not screenshot/HTML) |
| One layout for every job | Packs: `food` \| `receptionist` \| `medical` \| `health_coach` |
| Regex on markdown as the only scorer | **JSON run tree canonical**; `classifyDump` scores JSON; markdown prints it |
| Live Gemini / Grok in the wait loop to “see if it works” | Dummy process rows (Q-8) + one Tier 3 confirm; Grok does not sit on the spinner |

---

## 0. Why this exists (Soto thread, 2026-09-04)

Six live Log Meal confirms were **six classes**, not one flake. Goldens (G1) stayed green. The debug file had the evidence and still failed as a tool: duplicated, missing the card, matrix lying, prompts twice.

| Pass | Dump symptom | Class |
|------|----------------|-------|
| 1 | Still `running` after ledger + dietitian 503 | `DEGRADE_NOT_TERMINAL` |
| 2 | Felt queued ~2 min | Session MAX misread (not product) |
| 3 | Submit JSON `queued` | `QUEUE_LIE` |
| 4 | Debug done, card Attempt 1/3 | `DISPLAY_LAG` (poller / UI) |
| 5 | ~1 min persist lag; AnalyzeFinished ×4 | persist after R2; `COMPLETE_ONCE` |
| 6 | 90s scout stall → **failed** → user Retry | `STALL_NO_FALLBACK` |

**Lesson:** a dump is an **alarm for this branch**, not the whole suite. Walk every worker exit onto the process board (Q-8.1). The debug file must make this run’s faults **named and scorable**.

---

## 1. Invariants (do not drop)

1. **One writer** — `buildDebugMarkdownReport` only. No second formatter in the debug route.
2. **Contract table first** (after identity) — every applicable law PASS/FAIL with **MISSING / DUPLICATE / WRONG_PLACE / WRONG_TIME / WRONG_COUNT**.
3. **Snapshot at Download** — **dialog inventory** of the open modal (structured tree). Not a screenshot as source of truth, not innerHTML. Optional PNG on R2 for humans when a UI row is FAIL.
4. **Fixed section order, one heading each** — later sections **point**; they do not reprint kcal.
5. **Prompts once per dispatch that ran** — received + instruction + user + output **once**; not again in the log excerpt (F-8.13).
6. **Matrix must match logs** — Finalized ledger ⇒ calc Connected, never Standby (`DEBUG_MISS`).
7. **Same scorer at download and in vitest** — `classifyDump` / `dumpContract` / `test-from-debug`. Do not fork a second classifier. Score the **JSON tree**.

Plus (do not drop when adding packs):

8. **JSON tree is canonical; markdown is a view.**
9. **`jobId` (and turn/dispatch id) on console, network, and server lines.** Handoff carries the same id.
10. **Per-dispatch signals:** `model`, `latency_ms` (time-to-first-token if streamed), `tokens` if returned, `error` / finish.

---

## 2. Two kinds of duplicate and missing

| | **Malformed file** (builder FAIL — always) | **Real job fault** (contract FAIL — keep and score) |
|--|--|--|
| **DUPLICATE** | Same `##` twice; same crumb row pasted twice; scout instruction in Dispatches **and** in `[UnifiedLLM-Prompt]` logs; three kcal tables | `AnalyzeFinished` ×4; two real Retry clicks; two runner loops |
| **MISSING** | No session trail; no Contract; no dialog inventory; matrix Standby while ledger is in the log | No `{final,result}`; no 3.1 hop after stall; dish drop; Retry showing while succeeded |

**Law:** Dedupe **serialization**. Never “clean” **process**. If the job did it twice, the file shows it twice **and** Contract says DUPLICATE.

---

## 3. Shape faults (ui / content / process)

| Fault | Detector |
|-------|----------|
| MISSING | expected count 1, actual 0 |
| DUPLICATE | expected 1, actual > 1 **in the job** |
| WRONG_PLACE | present on a surface that must_hide it |
| WRONG_TIME | right object, wrong status/order |
| WRONG_COUNT | expand / N items off |

Content **value** (wrong dish, wrong grams) stays G* / G-B. This book does not replace Layer B.

---

## 4. Canonical JSON run tree

Cold debug JSON on R2 is the source. Markdown is printed from it.

```text
run
  jobId, conversationId, pack, status, exportedAt
  dialogInventory { open, title, on_card, visible[], hidden[], composer{}, expand }
  lastUserAction, breadcrumbs[], sessionEvents[], console[], network[]
  handoffs[] { from, to, received, keysDropped, jobId }
  dispatches[] {
    id, parent, turn, agent,
    user, received, instruction, output,
    model, latency_ms, tokens, error
  }
  contract[] { law, layer, fault, result, actual }
```

`classifyDump` reads this object (markdown parse is fallback for **historical** captures only).

---

## 5. Dialog inventory (not the whole modal blob)

At Download, capture the **open dialog’s state** so UI faults are in the file:

```text
## Modal snapshot (food chat)
- open: true
- title: "…"
- on_card: { kcal, P, C, F }     // must match ledger or WRONG_TIME
- visible: [View Analysis, Download Debug]
- hidden: [Retry, Attempt 1 of 3]
- composer: { photo, add_image, paste, send }  // each count === 1
- expand: workers/tiles open if shouldExpandMealAgent
```

| Do | Do not |
|----|--------|
| Structured tree / testids / a11y roles | Screenshot as the oracle |
| Control **counts** (DUPLICATE if Retry ×2) | Dump LogChat innerHTML |
| Macros **on the card** vs ledger | Reprint the calc table here |

Optional: one dialog PNG on R2 when a UI contract row is FAIL. Humans look at PNG; vitest looks at the tree.

---

## 6. Packs (file is not one layout)

Omit a section only if that pack **did not run** it. If it ran and the section is absent → malformed.

**Shared (every pack):** identity → **Contract** → last user action → breadcrumbs → session trail → console errors → network/activity errors → pipeline matrix (this pack’s stages only).

Empty console/network/actions = explicit **none**, not omitted. Do not drop because GATE PASS.

### 6.1 `food` (Log Meal, including multiple edits)

Dialog inventory · gate+ledger once · scout once per create turn that ran scout · calc once per finalized turn · **one turn/dispatch block per user send** (t1 create, t2+ edits) · backend log excerpt without prompt reprint.

### 6.2 `receptionist` (Front Desk, including transfer)

Handoff chain · Front Desk dispatch once · **handoff record** (from, to, received, keys dropped) · specialist pack sections for the downstream job (not a second Front Desk prompt).

### 6.3 `medical` / `health_coach`

Ingest/Apply or clinical report instead of scout/ledger. Same agent-I/O rule. No meal scout tape (WRONG_PLACE).

Wrong pack’s sections = WRONG_PLACE. Do not score food stall-hop on a Front Desk-only dump (`n/a`).

---

## 7. Agent I/O — once per dispatch, including handoff and edits

**Key:** `{turn, agent}` e.g. `t1/scout`, `t1/dietitian`, `t2/dietitian`, `fd/front_desk`, `fd→medical`.

```text
### Dispatch t2/dietitian
- User: …
- Received: (activeMeal / scout / profile / photo count — not base64)
- Instruction: … (once; schema once)
- Output: … (once)
- Signals: model, latency_ms (TTFT if stream), tokens, error/finish
- Parent: t1/scout | fd/front_desk | …
```

- Transfer: Front Desk block **and** specialist block. FD instruction is not copied under the specialist.
- Three food edits: `t1`, `t2`, `t3` — three user lines, three Received snapshots (what **that** turn saw), three outputs. Not only the last turn.
- Backend logs must not repeat instruction/output (`see Dispatch t1/scout`).
- `conversationHistory` once; not also inside Received.
- Missing I/O for a dispatch that ran = malformed MISSING. A second copy = malformed DUPLICATE.

---

## 8. Durable capture (do not rot)

These already exist on `DebugReportInput`. **Keeping them in the export is a gate.**

| Field | Must | Test |
|-------|------|------|
| `lastUserAction` | Always a section; “none” if empty | Heading on every pack fixture |
| Breadcrumbs | Distinct last actions; cap **after** dedupe | Identical Log Meal row not pasted twice; real second click stays |
| Console | error/warn; do not strip because GATE PASS | Fixture error still visible |
| Network / activity | Failures + `network_slow`; jobs/gemini 4xx/5xx | NET LATENCY / 503 still visible |
| Session trail | Fail → retry → succeed visible (skip poll heartbeats, keep status changes) | |
| Agent I/O | §7 one block per dispatch | Instruction not in logs + Dispatches |
| Handoff | Chain + each agent + dropped keys | Transfer without specialist = MISSING |
| Edits | One turn block per user send | |
| Dialog inventory | Food/specialist when modal open | Retry vs kcal scor able |
| `jobId` on lines | Console + network + server | Joinable |

Refactors of `LogChat` / `serverJobs` / debug route that stop forwarding these = FAIL named debug tests.

---

## 9. Contract table (eval on the run)

At export, run `classifyDump` on the JSON tree. Print first body section:

Food-pack examples (unused = `n/a`):

| Law | Layer | Fault |
|-----|--------|--------|
| SSE `{final,result}` | process | MISSING |
| AnalyzeFinished count = 1 | process | DUPLICATE |
| Stall/503/quota → 3.1 hop, same job | process | MISSING |
| Submit JSON `running` | process | WRONG_TIME |
| `pendingFoodLog` → succeeded before R2 | process | WRONG_TIME |
| Retry hidden if succeeded or kcal in logs | ui | WRONG_TIME |
| Attempt 1/3 hidden if succeeded | ui | WRONG_TIME |
| Dialog on_card kcal = ledger | ui | WRONG_TIME |
| Composer controls count = 1 | ui | DUPLICATE / MISSING |
| DIAG5 off on food | process | WRONG_PLACE |
| Matrix calc matches ledger | content | MISSING |
| Each dispatch has model + latency_ms | process | MISSING |
| Handoff from/to + same jobId if transfer | process | MISSING |

Plus QUALITY.md §1.3.1 exits for this pack. Receptionist: transfer target ran. Medical: Apply/salvage terminal.

Historical dumps stay **red** if that run was broken. Dummy fixtures / code probes go **green** without a new photo.

---

## 10. What this file can and cannot catch

**Can (this run):** SSE wrap, queue lie, poller/card lag, persist order, stall with no hop, AnalyzeFinished storms, DIAG5 on food, matrix vs ledger, dialog chrome if inventoried, dish drop vs scout, Apply miss, console/network, last actions, which agent ran and what they saw, edit turns, Front Desk → specialist gaps, dropped handoff keys, TTFT on a dispatch.

**Cannot:** a worker exit this job never took. Those are dummy rows on the process board (Q-8.1). One debug file ≠ the whole suite.

**Malformed file** is `DEBUG_DUP` / `DEBUG_MISS`. Catch in `debugPayload.test.ts`, not by asking for another meal.

---

## 11. Pyramid (three budgets)

| Budget | When | Gemini? |
|--------|------|---------|
| 1 Named vitest + content + process goldens + this contract on fixtures | Every change | No |
| 2 Playwright **stubs** — dialog inventory vs fake job status (Q-8.3). R-3 = chrome/Kosong only | UI/job wiring | No |
| 3 **One** live confirm — website **or** API, not both. Human or a script. Not Grok in the wait loop | After rows green | Yes, once |

Website live subsumes API for that job. If the new dump’s FAIL is already a Contract row, the inner loop failed — do not re-upload.

---

## 12. Gaps to close (execute, not a SaaS)

Aligned with OTel GenAI / LangSmith-style **trace vs eval**, without buying Phoenix. Code evals only. No LLM-as-judge in `dumpContract`.

| | Gap | ID |
|--|-----|-----|
| A | JSON run tree canonical; markdown is a view | **F-8.13** |
| B | `jobId` on console, network, server | F-8.13 |
| C | Dialog inventory | F-8.13 + **Q-8.3** |
| D | Per-dispatch model / latency_ms / tokens | F-8.13 |
| E | Handoff from/to/dropped keys | F-8.13 + **Q-8.5** |
| F | Scorer on JSON at download and vitest | F-8.13 |
| G | Dummy rows for exits not in this dump | **Q-8.1** |
| H | Stall/503 one-line count later | **R-12** (not a dashboard) |
| I | No LangSmith / LLM-judge inner loop | Standing |

---

## 13. Inner loop

```bash
npx tsx scripts/test-from-debug.ts path/to/debug.md
npx vitest run src/utils/dumpContract.test.ts src/utils/debugPayload.test.ts
```

Until the JSON tree exists, markdown parse is allowed as fallback. After F-8.13, fixtures are JSON.

---

## 14. Do not

- `POST /loop` / meal-green / Soto as G8  
- Hash-only prompts or hide schema  
- Green matrix that disagrees with logs  
- Strip real process duplicates to look clean  
- Second debug formatter  
- Biomarker history on a food dump  
- Drop console/network/breadcrumbs/last action because the meal succeeded  
- Flatten multi-edit or handoff into one dietitian prompt  
- Second copy of instruction/output in the log excerpt  
- Screenshot or innerHTML as the contract  
- LangSmith / Phoenix / LLM-judge inside `dumpContract`  
- Regex-on-markdown as the **only** scorer once the JSON tree exists  
- A metrics product (R-12 is a number in handover)  
- Grok watching the spinner for four minutes  

---

## 15. Related

| File | Role |
|------|------|
| `plan/RELIABILITY.md` §10–§11 | Execute-facing summary; **this file wins** if they drift |
| `plan/QUALITY.md` §1.3 / §1.3.1 | Process goldens + worker-exit audit |
| `plan/ROADMAP.md` F-8.13, Q-8.1–8.6, R-12 | IDs |
| `docs/agent/domains/sync.md` | Job sync / tombstones — not dump shape |
| `docs/agent/domains/food-calc.md` | Kcal laws — not dump shape |
