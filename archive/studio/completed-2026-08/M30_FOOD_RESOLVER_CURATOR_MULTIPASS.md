# M30 — Food Resolver Curator + 1-Pass Atomic Catalog (MULTIPASS AUTONOMOUS)

**Status:** ACTIVE for AI Studio upload  
**Who commits/pushes:** **AI Studio only** (`AGENTS.md` §4)  
**Architecture (binding):** `plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md`  
**Domain:** `docs/agent/domains/food-calc.md` (invariants keep; Resolver role evolves in same task — pack authorizes protected-doc update at end)  
**Evidence job:** user debug `job_1786486910960_lj1iw1c3k` (22 queries, parent-title gaps, 0-kcal tortilla persist, brand false-positives)

**Goal:** Implement the **full plan (Phases 0–5)** in one continuous multipass effort. You (AI Studio) run **multiple internal sessions / context rolls yourself** until the **master gate exits 0**. Do **not** stop after Phase 0/1 and wait for the human to say “continue.”

---

## A. User prompt (copy-paste into AI Studio — this IS full approval)

```text
MULTIPASS AUTONOMOUS EXECUTION — PRE-APPROVED END-TO-END

You are AI Studio on Health-tracker. Follow studio/M30_FOOD_RESOLVER_CURATOR_MULTIPASS.md and plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md.

═══════════════════════════════════════════════════════════════
PRE-APPROVAL (AGENTS.md L13 multipass epic — waives L11 Stage-1 wait and L3 multi-file re-ask)
═══════════════════════════════════════════════════════════════
This message IS PRE-APPROVED / MULTIPASS AUTONOMOUS for the entire plan Phases 0–5.
L13 applies: Stage 1 await is WAIVED; this pack is approval.
Do NOT emit a Stage-1 strategic report and wait.
Do NOT ask “should I proceed to Phase N?”
Do NOT end a turn with only investigation, grep, or “next steps for you.”
Do NOT claim COMPLETE until master gate exit 0.

═══════════════════════════════════════════════════════════════
AUTONOMOUS CONTINUATION LAW (binding — overrides early stop habits)
═══════════════════════════════════════════════════════════════
1. After any file read / grep / view: immediately continue with edits, tests, or the next phase checklist item in the SAME continuous work stream.
2. After a phase’s unit tests pass: IMMEDIATELY start the next phase (P0→P1→P2→P3→P4→P5). No human gate between phases.
3. If context is nearly full: (a) update AI_HANDOVER.md § M30 multipass checkpoint with exact remaining IDs, (b) write a short RESUME block at top of AI_HANDOVER, (c) continue in a NEW chat/session YOURSELF using only that checkpoint — do not wait for the user to paste “continue.”
4. Forbidden terminal phrases until master gate 0:
   - “Ready when you are”
   - “Say continue for Phase …”
   - “I’ve completed Phase 0; next we could …”
   - “all done” / “fully verified” without GATE LOG exit 0
5. If blocked by true environment limit (no network, missing secret): note in AI_HANDOVER as BLOCKED + what human must provide; still finish every offline phase.

═══════════════════════════════════════════════════════════════
PRODUCT INTENT (do not invent alternate pipeline)
═══════════════════════════════════════════════════════════════
- OCR / brand printed nutrients = meal hard truth; scout estimatedCalories VOID when brand/OCR kcal exists.
- Multi-component dishes: search ATOMIC components only (clinical English inverted USDA queries).
- Deterministic resolve first; Food Resolver is CATALOG CURATOR (1 LLM iteration) for multi-match, merge, brand routing, basis normalize, quarantine — self-heal so next meal needs no Resolver.
- Extend food_items / food_aliases / dish_cache — do NOT create parallel basic_foods tables.
- Prefer extract modules + thin server.ts call sites (AGENTS L8).
- Keep Mode A / D / Edit same finalize math; keep budget→foundation→reconcile.
- Prep fat XOR oil-in-components; one reconcile scale only.
- Net-zero scout prompt growth (AGENTS L12): add clinical/inversion lines only if you remove equivalent redundant lines.

═══════════════════════════════════════════════════════════════
ORDER + MASTER GATE
═══════════════════════════════════════════════════════════════
Implement P0 → P1 → P2 → P3 → P4 → P5 in order.
After all phases: run §F master gate (assert-food-curator-m30.mjs + listed vitest + tsc).
Only then: IMPACT/SELF-CHECK/GATE LOG COMPLETE format, update AI_HANDOVER, update food-calc.md Resolver role (pack authorizes), archive this pack, commit+push.

Preflight: node scripts/assert-food-curator-m30.mjs  → expect FAIL before work, PASS after.
Do not weaken asserts.
```

---

## B. Anti-miss / honesty (binding)

1. **Import without production call site = FAIL.**  
2. **Grep theater = FAIL** — symbols must be invoked on food-analyze path.  
3. **Parent dish titles must not enter atomic USDA search** when `components.length >= 2`.  
4. **0-kcal / missing energy FDC must not persist** as active/candidate usable match (except explicit zero-cal whitelist).  
5. **BrandGuard:** generic tokens (`granola`, `mayonnaise`, `chicken`, …) must not bind random brand_menu without chain/product context.  
6. **Resolver does not invent meal calories** when brand/OCR hard lock exists.  
7. **Curator actions** must execute merges/aliases/quarantine on disk — not log-only.  
8. **Do not weaken** any `assert-*.mjs` or delete regression tests to go green.  
9. **No god-file rewrite** of all of `server.ts` — extract modules, thin wire-in.  
10. **Sibling paths:** Mode A primary; Mode D / Edit must still call same finalize helpers (log tags preserved).  
11. **Early-stop = FAIL** if work remains on the phase checklist and master gate is not 0.

---

## C. Already DONE — do not rebuild

| Keep | Notes |
|------|--------|
| Hybrid budget / reconcile | `server_budget_reconcile.ts` |
| Prep policy | `server_prep_policy.ts` — extend XOR only |
| food_items / food_aliases / dish_cache schema | extend, don’t replace |
| `resolveInternalFood`, `upsertFoodAlias`, `mergeFoodCatalogItems`, Atwater quarantine | reuse |
| Matching engine form/token rules | `server_matching_engine.ts` |
| Nutrient basis types | `server_nutrient_basis.ts` — extend normalize |
| Food Resolver allowlist discard tests | keep + extend |
| Portion clarify / refine skipScout | do not break |
| Label / brand hard lock paths | preserve |

---

## D. Phase checklist (execute ALL — autonomous)

Mark each row in `AI_HANDOVER.md` as you finish: `P0a ✅` etc.

### Phase 0 — Query hygiene + gates (no LLM schema change required)

| ID | Work | Evidence |
|----|------|----------|
| **P0a** | New `server_query_set.ts`: `buildFoodSearchQuerySet(scoutItems)` → unique atomics only; brand dish query only if chain/brand; single-component dishes once; drop parent multi-component titles and `…ingredients` paraphrases | unit test with lj1-shaped fixture → ≤14 queries, no `chicken avocado salad bowl` as atomic USDA query |
| **P0b** | Wire query set into `server.ts` DB search path (replace ad-hoc uniqueQueries fan-out) | log `[QuerySet]` |
| **P0c** | Reject candidates with missing/0 kcal before choose/persist (whitelist water/diet) | test + no persist path for 0-kcal tortilla class |
| **P0d** | BrandGuard on generic tokens without chain context | test + log `[BrandGuard]` |

### Phase 1 — FDC filter + rank + scout clinical

| ID | Work | Evidence |
|----|------|----------|
| **P1a** | Atomic searches: `Foundation,SR Legacy,Survey (FNDDS)`; Branded only brand/barcode class | code path |
| **P1b** | Rank top-N via matching engine; classify HIT_UNIQUE / MULTI_MATCH / MISS | log `[ResolveClass]` |
| **P1c** | HIT_UNIQUE → gated alias write (no Resolver) | test |
| **P1d** | Scout prompt: inverted clinical English for searchQuery; brand separate; oil component for heavy fry; **net-zero line budget** | prompt diff net ≤0 lines or removed equal count |

### Phase 2 — Curator Resolver v1

| ID | Work | Evidence |
|----|------|----------|
| **P2a** | `server_food_resolver_curator.ts` (+ update `agents/foodResolverInstructions.ts`): action schema pick_existing / create_from_external / merge_duplicates / alias_only / no_safe_match / reformulate_pick | unit tests parse + allowlist |
| **P2b** | Trigger router: only MULTI_MATCH, MISS, INVALID, NEAR_DUP — **not** parent dish spam | job-shaped: 0 curator cases when all HIT_UNIQUE |
| **P2c** | Execute merge + multi-alias + create with Atwater/kcal gates | merge test |
| **P2d** | One LLM iteration batch; fail-open without poisoning catalog | existing forged-ID test still passes |

### Phase 3 — Basis normalize + brand routing + quarantine

| ID | Work | Evidence |
|----|------|----------|
| **P3a** | Migration `supabase/migrations/20260812_food_catalog_curator.sql`: brand_key, entity_kind, basis_type, serving_grams, pack_grams, portions_per_pack, hit_count, last_accessed_at, etc. | file present; ensure schema path OK |
| **P3b** | `normalizeToPer100g` (extend basis module): per_100g, per_serving, per_pack, portion×pack (ID-style) | unit tests hand-calc |
| **P3c** | Curator actions `normalize_basis` + `quarantine`; server recomputes scale from grams (don’t trust LLM math) | tests |
| **P3d** | Implausible gates: kcal/100g > 950, serving > 5000g, macros > 100g/100g, etc. | 10k kcal / 10kg fixtures quarantine |

### Phase 4 — Assembly polish

| ID | Work | Evidence |
|----|------|----------|
| **P4a** | Prep XOR: fat-bearing components ⇒ prep addition 0; log `[PrepXOR]` | test |
| **P4b** | Optional mass/density correction helper if volume% still used | test or explicit N/A if mass% already from scout |
| **P4c** | Metrics hooks: alias hit / curator call / quarantine (debug logs OK) | logs |

### Phase 5 — Hardening + docs + ship

| ID | Work | Evidence |
|----|------|----------|
| **P5a** | `scripts/assert-food-curator-m30.mjs` master gate (all greppable invariants + nested prior food gates you touch) | exit 0 |
| **P5b** | Golden unit fixtures: query set lj1; multi-oats merge; basis ID; quarantine | vitest exit 0 |
| **P5c** | Update `docs/agent/domains/food-calc.md` Resolver role → curator (pack-authorized protected edit); update DOMAIN_REGRESSION_MAP food-calc section with new tests | done |
| **P5d** | `AI_HANDOVER.md` M30 COMPLETE; archive this pack to `archive/studio/completed-2026-08/`; commit + push | ship |

---

## E. File plan (preferred ownership)

| Create / primary edit | Role |
|----------------------|------|
| `server_query_set.ts` + `.test.ts` | Query hygiene |
| `server_fdc_resolve.ts` + tests (or extract from server.ts) | Filtered search + rank + class |
| `server_catalog_gates.ts` + tests | Plausibility / 0-kcal / promote |
| `server_food_resolver_curator.ts` + tests | Curator |
| `agents/foodResolverInstructions.ts` | Curator prompt |
| `server_nutrient_basis.ts` (+ tests) | normalizeToPer100g |
| `server_food_catalog.ts` | alias hit_count, brand fields, merge |
| `server_prep_policy.ts` | XOR fat |
| `server_vision_scout.ts` | clinical prompt net-zero |
| `server.ts` | **thin** wire-in only |
| `supabase/migrations/20260812_food_catalog_curator.sql` | columns |
| `scripts/assert-food-curator-m30.mjs` | master gate |
| `docs/agent/domains/food-calc.md` | Resolver role (end) |
| `docs/agent/DOMAIN_REGRESSION_MAP.md` | new tests list |
| `AI_HANDOVER.md` | multipass checkpoint + COMPLETE |

**Out of scope:** biomarker agents, i18n, Firestore free-tier work, rewriting dietitian, Temporal/workers, parallel `basic_foods` schema, deleting Food Resolver.

---

## F. Master gate (write this script; do not weaken)

Create `scripts/assert-food-curator-m30.mjs` that **fails** unless approximately:

```text
// Presence + wiring (adjust strings to match your real log tags)
- buildFoodSearchQuerySet exported and imported/called from server food-analyze path
- log/tag QuerySet or buildFoodSearchQuerySet usage
- ResolveClass or HIT_UNIQUE / MULTI_MATCH classification exists
- 0-kcal reject helper used before upsertFoodItemCandidate on resolver/fdc path
- BrandGuard or equivalent generic-token brand reject
- curator action schema includes merge_duplicates and quarantine (or normalize_basis)
- foodResolverInstructions mentions curator / alias / merge (not only gap dishCore)
- normalizeToPer100g or equivalent basis normalize exists
- PrepXOR or fat_in_components / composite prep suppress still present
- migration 20260812_food_catalog_curator.sql exists
- server_query_set.test.ts / curator tests exist

// Nested: keep critical prior food asserts green if they still apply
// e.g. run vitest patterns listed below inside the script or document as GATE LOG lines
```

**GATE LOG required for COMPLETE:**

```bash
npx tsc --noEmit
npx vitest run server_query_set.test.ts server_food_resolver_curator.test.ts server_catalog_gates.test.ts server_nutrient_basis.test.ts server_budget_reconcile.test.ts server_food_resolver.test.ts server_prep_policy.test.ts server_vision_scout.test.ts
node scripts/assert-food-curator-m30.mjs
# plus any food-calc map commands you still touch
```

All exit **0**.

---

## G. STATUS table (fill as you go — COMPLETE only if all PASS)

| ID | Result | Evidence |
|----|--------|----------|
| P0a Query set | | |
| P0b Wire server | | |
| P0c 0-kcal reject | | |
| P0d BrandGuard | | |
| P1a FDC types | | |
| P1b Rank + class | | |
| P1c HIT alias | | |
| P1d Scout clinical | | |
| P2a Curator module | | |
| P2b Trigger router | | |
| P2c Merge/alias exec | | |
| P2d One-iter + allowlist | | |
| P3a Migration | | |
| P3b Basis normalize | | |
| P3c normalize/quarantine actions | | |
| P3d Implausible gates | | |
| P4a Prep XOR | | |
| P4b Density/mass | | |
| P4c Metrics logs | | |
| P5a Master assert | | |
| P5b Vitest suite | | |
| P5c Domain docs | | |
| P5d Handover + ship | | |
| Mode A finalize | | |
| Mode D/Edit no break | | |

---

## H. Context-roll protocol (you drive multi-session)

When near context limit **mid-multipass**:

1. Write to `AI_HANDOVER.md`:

```markdown
## M30 MULTIPASS CHECKPOINT (machine-readable)
status: IN_PROGRESS
last_completed: P2c
next: P2d
blocked: none
branch_note: <optional>
files_touched: [list]
gate: assert-food-curator-m30 still FAIL (expected until end)
RESUME: Continue studio/M30_FOOD_RESOLVER_CURATOR_MULTIPASS.md from ID next=. Pre-approval still valid. Do not re-investigate whole codebase. Do not wait for user.
```

2. Start fresh session with only:

```text
Resume M30 from AI_HANDOVER.md M30 MULTIPASS CHECKPOINT.
Pre-approval still holds. Autonomous continuation law still holds.
Read plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md § phase next only if needed.
Implement from next ID through P5d + master gate 0.
```

3. **Human is not required** to paste that — if the product UI forces a new chat, output the RESUME one-liner once as the last line of the truncated session **and** leave it in AI_HANDOVER so the next agent/session continues. Prefer auto-continue when the environment allows.

---

## I. COMPLETE block (only after master gate 0)

```text
COMPLETE
IMPACT: class L — Food Resolver curator + 1-pass atomic catalog (M30)
SELF-CHECK: all boxes
GATE LOG:
  tsc: exit 0
  vitest: exit 0 (list files)
  assert-food-curator-m30: exit 0
paths: Mode A verified; Mode D/Edit finalize helpers still wired
ship: commit + push by AI Studio
board: AI_HANDOVER M30 done; pack archived
```

Forbidden until true: all done · fully verified · nothing left · phases complete without gate.

---

## J. Why this pack fights early-stop (read once)

Default `AGENTS.md` pushes agents to: investigate → **stop for approval** (L11 Stage 1) → small packs → COMPLETE → wait.  
This pack **pre-approves** Stage 2 for Phases 0–5 and makes **inter-phase wait a FAIL**.  
If you still stop early, you are violating section A Autonomous Continuation Law.
