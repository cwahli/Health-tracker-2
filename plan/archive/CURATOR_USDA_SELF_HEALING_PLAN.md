# Curator-Driven USDA Resolution, Multi-Match Curation & Self-Healing Database Architecture

**Status:** Implementation Specification & Architectural Plan (Hardened Edition)  
**Date:** 2026-08-12  
**Target Modules:** `server.ts`, `server_vision_scout.ts`, `server_food_resolver_curator.ts`, `agents/foodResolverInstructions.ts`, `server_food_catalog.ts`, `serverBrandMenu.ts`

---

## 1. Executive Overview & Goals

This architecture transforms food identity resolution and database maintenance into a **self-healing, low-token, curator-driven engine**.

### Primary Objectives:
1. **Scout Simplification:** Strip FDC ID lookup instructions and schema fields from the Vision Scout prompt. The Scout focuses exclusively on visual extraction, portion sizing, component decomposition, and generating clean clinical inverted queries (e.g., `"Chicken, breast, grilled"` or `"Sainsbury Oats"`).
2. **0 ms Instant Local Path:** Route queries through a unified `food_aliases` mapping layer that supports both generic commodities (`food_items`) and branded/packaged items (`brand_menu_items`).
3. **Ambiguity Escalation at Step 1:** If local database matching yields multiple competing hits with high similarity scores, mark the query as **Ambiguous** rather than selecting an arbitrary winner.
4. **Curator Parametric Memory & USDA Search Loop:**
   - The Curator uses its parametric knowledge to look up standard USDA FoodData Central (FDC) reference numbers for unambiguous clinical queries.
   - If the parametric FDC ID is valid, verified, and exact, the server anchors it.
   - If parametric lookup fails or is inapplicable, the Curator evaluates candidate results retrieved from parallel live USDA searches and local candidate pools.
5. **Strict Single-Loop Session Cap (Max 1 LLM Call):** All unmapped gaps and ambiguous multi-matches across an entire meal session are batched into **exactly 1 Curator LLM invocation**, preventing token bloat and controlling credit usage.
6. **Self-Healing Database Curation:** High-confidence Curator choices automatically persist aliases, merge duplicate database records (brand and generic), quarantine bad entries, and route catalog entries. Over time, recurring queries hit `food_aliases` directly, driving Curator LLM usage down to near zero.

---

## 2. Comprehensive System Architecture & Pipeline Flow

```text
[User Photo(s) + Message]
           │
           ▼
[Vision Scout Stage]
  ├─ Decomposes dish into raw components (mass % / volume %)
  ├─ Generates clean clinical queries ("Noun, descriptor, preparation")
  └─ Output: searchQuery array (NO FDC ID guessing)
           │
           ▼
[Step 1: Local Catalog & Unified Alias Pre-Check]
  ├── Single High-Confidence Alias / Item Match ──────> [INSTANT 0ms MATCH]
  └── Ambiguous Multi-Match OR Unmapped Gap ──────────> [Mark for Curator]
                                                               │
                                                               ▼
                                         [Step 2: Candidate Retrieval & Parametric Assembly]
                                           ├── Local `food_items` Candidates
                                           ├── Local `brand_menu_items` Candidates
                                           └── Live USDA FoodData Central Candidates (1200ms Timeout)
                                                               │
                                                               ▼
                                         [Step 3: Single-Loop Curator Pass (Max 1 Call)]
                                           │
           ┌───────────────────────────────┴───────────────────────────────┐
           ▼                                                               ▼
[Parametric FDC Lookup]                                         [USDA Search Candidate Evaluation]
Curator provides exact USDA FDC ID                             Curator selects best candidate from
from parametric memory (e.g., "171077").                        USDA / local database search pool.
           │                                                               │
           └───────────────────────────────┬───────────────────────────────┘
                                           │
                                           ▼
                         [Semantic Verification & Safeguard Gate]
                           ├─ Verifies FDC ID existence
                           ├─ Enforces >=50% Token Overlap
                           └─ Checks Basis Normalization (per_100g)
                                           │
                                           ▼
                         [Step 4: Unified Curation Actions]
                           ├─ `pick_existing` (Apply for meal macros)
                           ├─ `create_alias` (Atomic UPSERT -> `food_aliases`)
                           ├─ `merge_duplicates` (Soft-merge loser IDs -> winner)
                           └─ `quarantine` (Exclude corrupted/mismatched entries)
                                           │
                                           ▼
                         [Step 5: Gated DB Commit & Fallback]
                           ├── High Confidence & Gate Pass? ───> Commit Aliases & Merges to Supabase
                           └── Low Confidence / Gate Fail?  ───> Category Fallback (No DB pollution)
```

---

## 3. Deep-Dive Audit: Critical Failure Modes & Hardened Safeguards

### Failure Mode 1: Parametric FDC ID Hallucination (Valid Number, Wrong Item)
- **Problem:** LLMs output valid 6-digit USDA numeric IDs from memory (e.g., `171077`) that actually map to a completely different food in USDA FoodData Central (e.g., `"Beef liver, raw"` instead of `"Chicken breast grilled"`). A simple ID existence check passes, permanently corrupting `food_aliases`.
- **Hardened Mitigation: Semantic Verification Gate.** Before accepting any `parametricFdcId`:
  1. Fetch the official item description for that ID from USDA / local DB.
  2. Compute normalized token overlap between the user query (e.g., `"chicken breast grilled"`) and the resolved USDA title (e.g., `"Chicken, breast, meat only, cooked, grilled"`).
  3. If token overlap is $<50\%$, reject the parametric ID, log a warning, and fall back to candidate search evaluation.

### Failure Mode 2: Over-Escalation of Routine Queries ("Threshold Cascade")
- **Problem:** Setting Step 1 ambiguity checks too aggressively causes 80–90% of routine searches (e.g., `"Grilled Chicken"`, `"Croissant"`) to trigger the Curator because the local DB contains 2–3 minor variations.
- **Hardened Mitigation: Score Gap Thresholding.** Compute a normalized string similarity score (token set ratio + Levenshtein distance) for local hits. If the top candidate has a similarity score $>0.92$ and a score gap $>0.15$ over the runner-up, treat it as a confident hit and resolve instantly in Step 1 without calling the Curator.

### Failure Mode 3: Cyclic Merges & Data Loss during `merge_duplicates`
- **Problem:** Merging database rows across sessions (`A -> B`, `B -> C`, `C -> A`) creates infinite resolution loops. Deleting base rows during consolidation destroys historical auditability.
- **Hardened Mitigation: Direct Pointers & Soft Merging.**
  1. `food_aliases` must resolve directly to canonical primary keys in `food_items` or `brand_menu_items` (single-hop resolution; no alias-to-alias chaining).
  2. Never hard-delete database rows during `merge_duplicates`. Mark loser rows as `status = 'merged_loser'` with a `canonical_target_id` pointer.

### Failure Mode 4: Basis Type & Density Miscalculation (`per_100g` vs `per_serving`)
- **Problem:** USDA FDC data is stored per 100g, but some brand items or OpenFoodFacts entries express macros per serving (e.g., 1 bar = 45g). Linking a generic query to an un-normalized per-serving row breaks downstream per-100g density calculations.
- **Hardened Mitigation: Mandatory Basis Normalization Validation.** When persisting an alias, the backend verifies that `basis_type` is `per_100g`. If the target item is `per_serving`, the Curator's `normalize_basis` scaling factors are applied to re-calculate per-100g rates before writing the alias.

### Failure Mode 5: Brand vs. Commodity Cross-Contamination
- **Problem:** A generic query like `"Croissant, butter"` gets aliased to a specialty branded item (`"Starbucks Almond Chocolate Croissant"` with 450 kcal and nut allergens), or vice versa.
- **Hardened Mitigation: Strict Scope Isolation Gate.**
  - Generic inverted queries (`"Noun, descriptor"`) can only point to standard commodity `food_items`.
  - Branded queries (containing recognized brand tokens like `"Starbucks"`, `"Sainsbury"`, `"McDonald's"`) can only point to `brand_menu_items`.

### Failure Mode 6: Concurrent Write Collisions & Race Conditions
- **Problem:** Multiple requests submitting the same unmapped food simultaneously trigger concurrent Curator calls and write to `food_aliases` at the same time, causing primary key / unique constraint crashes.
- **Hardened Mitigation: Idempotent Atomic Upsert.** Execute all `food_aliases` writes using Supabase `UPSERT` with `ON CONFLICT (alias_key) DO UPDATE SET hit_count = food_aliases.hit_count + 1`.

---

## 4. Single-Loop Curator Execution & Curation Actions

All unresolved gaps and ambiguous queries across a meal session are batched into **exactly 1 Curator LLM pass**. The Curator returns structured JSON containing 5 explicit actions:

| Action | Purpose | Execution & Database Outcome |
| :--- | :--- | :--- |
| **`pick_existing`** | Current Meal Resolution | Selects the canonical winner item (brand or generic) to calculate meal nutrition. |
| **`create_alias`** | Unified Alias Registration | Writes `(alias_key -> target_food_id)` into `food_aliases` for both `food_items` and `brand_menu_items`. |
| **`merge_duplicates`** | Local Catalog Consolidation | Marks duplicate local rows as `status = 'merged_loser'` and creates redirection aliases (`legacy_merge_<loserId> -> winnerId`) in `food_aliases`. |
| **`quarantine`** | Corrupt Data Elimination | Blacklists mismatched or impossible entries (e.g., hard seltzer matching hard-boiled egg) so future searches ignore them. |
| **`route_catalog`** | Catalog Classification | Ensures branded foods are stored in `brand_menu_items` and generic commodities in `food_items`. |

---

## 5. File Implementation Map & Responsibilities

| File | Responsibilities & Modifications |
| :--- | :--- |
| `plan/CURATOR_USDA_SELF_HEALING_PLAN.md` | Architecture specification & design record. |
| `server_vision_scout.ts` | Remove `suggestedFdcId` schema fields and prompt instructions; enforce inverted clinical query generation. |
| `server_food_catalog.ts` | Expand `food_aliases` lookup to resolve both commodity and brand menu items; add Score Gap Thresholding for multi-matches. |
| `serverBrandMenu.ts` | Integrate brand menu items with unified `food_aliases` resolution and duplicate merging. |
| `agents/foodResolverInstructions.ts` | Update `foodResolverCuratorInstruction` and `FoodCuratorActionSchema` to support parametric FDC lookup and brand/commodity duplicate merging. |
| `server_food_resolver_curator.ts` | Implement candidate retrieval, Semantic Verification Gate, single-loop batched execution, and atomic Supabase writes. |
| `server.ts` | Wire simplified Scout queries through local alias pre-checks and batch remaining gaps into the single Curator pass. |

---

## 6. Verification & Quality Gates

- **Static Analysis:** Run `lint_applet` (`tsc --noEmit`) to verify zero TypeScript errors.
- **Build Verification:** Run `compile_applet` (`npm run build`) to ensure CommonJS bundling succeeds.
- **Dev Server Check:** Restart dev server via `restart_dev_server` to verify clean startup.
