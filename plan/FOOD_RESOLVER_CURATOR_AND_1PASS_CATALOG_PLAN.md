# Food Resolver Curator + 1-Pass Atomic Catalog Plan

**Status:** Proposed architecture (implementation-ready)  
**Date:** 2026-08-12  
**Domain:** Food-calc / catalog / resolver  
**Related:** `docs/agent/domains/food-calc.md`, `server_food_catalog.ts`, `server_nutrient_basis.ts`, `server_budget_reconcile.ts`, `server_vision_scout.ts`, `executeFoodResolverAgent` in `server.ts`  
**Evidence job:** `debug-job_1786486910960_lj1iw1c3k` (22 redundant queries, bad FDC candidates, 0-kcal tortilla persisted, brand false-positives)

---

## 1. Goal

Transition food identity resolution from an expensive, noisy, low-curation pipeline into:

1. **Fast deterministic path** for clean atomic base ingredients (filtered USDA/FDC + local aliases).
2. **Strong Food Resolver curator** when identity is ambiguous, multi-matched, cross-source, international, or catalog-dirty — **one LLM iteration**, high-power actions.
3. **Self-healing catalog** so Resolver designs itself out of the hot path: every good decision writes aliases / merges / normalizes basis so the next meal hits local DB.
4. **Preserve meal truth hierarchy:** OCR / brand printed nutrients remain hard locks; atomic foundation fills missing macros/micros; scout soft kcal only when no brand/OCR kcal.

**Non-goals**

- Replace budget → foundation → reconcile (keep it).
- Remove Food Resolver.
- Fork a parallel `basic_foods` schema (extend `food_items` / `dish_cache` / `food_aliases`).
- Claim sub-second end-to-end while Vision Scout still runs (claim **resolver+DB** warm-path latency + reduced LLM gap calls).

---

## 2. Product principles

| # | Principle |
|---|-----------|
| P1 | **OCR / brand truth wins** for keys that are printed or official menu. Scout `estimatedCalories` is **void** when brand/OCR kcal exists. |
| P2 | **Atomic foundation** builds shape (macros/micros) from base ingredients + sauces. Multi-component dishes search **components only**, not parent dish titles. |
| P3 | **Resolver is the catalog curator**, not a calorie estimator: pick identity, route brand vs generic, dedupe, normalize portion basis, reject garbage, write aliases. |
| P4 | **Self-heal is primary KPI:** after a successful resolve, the same query must not need Resolver again. |
| P5 | **One scale, no double fat:** hard_lock scale once; prep oil XOR component fat; never brand total + dishCore + full component sum as three competing truths. |
| P6 | **Scout queries are clinical English** (inverted USDA taxonomy); brand/local names stay in `originalName` / brand fields. |
| P7 | **Right row, right table:** brand product → brand-scoped food_item or brand_menu linkage; generic commodity → generic food_item; composed dish memory → dish_cache only when no safe atomic decomposition. |

---

## 3. Target end-to-end flow

```text
[User image + text]
        │
        ▼
[Vision Scout]
  - items + components (clinical searchQuery, mass% preferred)
  - originalName / chainName / rawNutritionLabel (printed only)
  - soft estimatedCalories per item (ignored if brand/OCR kcal)
        │
        ▼
[Query set builder]  ← NEW pure helper
  - unique atomics only (normalize + synonym collapse)
  - + brand/chain dish query only if chainName or brand identity
  - + single-component dishes (croissant = one atomic)
  - NEVER parent multi-component titles / "…ingredients" paraphrases
        │
        ▼
[Deterministic resolve each query]
  1. food_aliases / food_items / CANONICAL_BASE_FOODS / brand aliases
  2. Brand menu / OFF only if brand/barcode class
  3. Filtered FDC: Foundation | SR Legacy | Survey(FNDDS)
       top-N → matching_engine form/token filters → reject 0-kcal / Atwater fail
  4. Classify outcome:
       HIT_UNIQUE | MULTI_MATCH | MISS | INVALID_CANDIDATES | NEAR_DUP_CLUSTER
        │
        ├── HIT_UNIQUE → use nutrients; gated alias write (no LLM)
        │
        └── else → collect CuratorCase pack
        │
        ▼
[Food Resolver Curator — 1 iteration, batch of cases]
  Actions: pick_existing | create_from_external | merge_duplicates |
           alias_only | normalize_basis | quarantine | reformulate_pick |
           no_safe_match
  Server executes writes deterministically
        │
        ▼
[Assembly]
  foundation = Σ component mass × per_100g
  budget = OCR/brand hard > dish_cache > scout soft > category
  reconcile (single scale) + prep XOR oil components
        │
        ▼
[Self-heal metrics + observations]
```

---

## 4. Truth hierarchy (meal finalize — unchanged product rule)

Per **dish item** (not per component):

| Priority | Source | Effect |
|----------|--------|--------|
| 1 | Printed OCR / `rawNutritionLabel` keys | Hard lock those keys |
| 2 | Official brand menu match (high confidence) | Hard lock official nutrients / kcal |
| 3 | Foundation sum from resolved atomics | Shape of macros/micros; fills unlocked keys |
| 4 | Scout `estimatedCalories` | Soft budget **only if** 1–2 missing |
| 5 | Category density × weight | Last resort |

**Yolk burger with only kcal printed**

- Budget hard-lock calories from brand/OCR.
- Scout components (bun, beef, sauce…) build foundation.
- Reconcile: **one** hard_lock scale of foundation → locked kcal.
- Scout estimatedCalories **not used**.

**Double-count bans**

| Ban | Rule |
|-----|------|
| Brand total as component row + budget | Brand is budget/truth only unless single-item brand product with no components |
| dishCore + multi-component assembly | Skip dishCore when `components.length >= 2` |
| Prep policy + oil/sauce components | XOR: if fat-bearing components present, `decidePrepAddition = 0` |
| Soft scout + hard brand | Soft voided when hard exists |
| Two scales | At most one reconcile scale factor per item |

---

## 5. Query hygiene (P0 — fixes current job fan-out)

### 5.1 Build unique query list

From Scout items:

```text
for each item:
  if components.length >= 2:
    emit each component.searchQuery (clinical)
    if chainName or brand product identity: emit brand dish query ONCE for budget lookup only
    do NOT emit item.keyword / originalName / queriesToSearch parent strings for USDA atomics
  else:
    emit clinical query for the single food (keyword or component[0])
```

Normalize:

- lower/trim, synonym map (`garlic mayo` → `mayonnaise` for catalog key if appropriate; keep brand if present)
- inverted clinical form where Scout failed to invert
- case-collapse (`Vegetarian wrap` vs `vegetarian wrap`)

### 5.2 Target for job `lj1iw1c3k`

| Today | Target |
|-------|--------|
| 22 searches (parents + ingredients + dups) | ≤ 13 unique atomics |
| 15 resolver gaps (cap 8) | 0 resolver if FDC/catalog clear; else ≤ 3 true curator cases |
| 67 raw DB matches noise | Ranked top-N per atomic only |

### 5.3 Scout prompt additions

1. **USDA Query Inversion:** `Noun, Descriptor, Preparation` (e.g. `Egg, whole, cooked, hard-boiled`).
2. **Clinical English only** for `searchQuery` / component queries.
3. **Brand fields separate:** `originalName` / `chainName` / optional `brandToken`; do not only mash brand into FDC string unless brand path.
4. **Preparation fat:** for deep-fried / heavy glaze, include oil/butter component with % (mass preferred).
5. Prefer **massPercentage** (or weightGrams) over pure volume%; if volume only, server applies density table later (P2).

---

## 6. Deterministic FDC / catalog path

### 6.1 Atomic search class vs brand class

| Class | When | Sources |
|-------|------|---------|
| **Atomic** | No brand/barcode context | FDC: `Foundation`, `SR Legacy`, `Survey (FNDDS)` only |
| **Brand product** | chainName, known brand token, barcode, explicit retail brand in query | Brand menu, OFF, FDC Branded (with quality gates) |
| **Hybrid** | “Sainsbury rolled oats” | Internal multi-hit + OFF brand + FDC commodity → **Resolver** if not unique |

### 6.2 Candidate ranking (no `foods[0]`)

Reuse `server_matching_engine.ts`:

1. Fetch top 10–25.
2. Drop kcal==0 (except whitelist: water, diet drinks).
3. Atwater validity on macros when present.
4. Form/token coverage + modifier inversion (bar vs bowl, dried vs cooked).
5. If exactly one survivor above score τ → **HIT_UNIQUE**.
6. If 2+ survivors → **MULTI_MATCH** (curator).
7. If zero → **MISS** (curator may reformulate once via server pre-search).

### 6.3 Gated write on deterministic HIT (no LLM)

Still write alias when:

- kcal > 0 (or whitelist)
- Atwater OK
- form-safe
- status starts as `candidate` if confidence medium; `active` if high + known canonical

Never write parent dish string → single component.

---

## 7. Food Resolver as curator (core of this plan)

### 7.1 Mission

Resolver is the **problem-solver and librarian**:

- Choose the correct **food_item** or **brand** entity among many partial matches (internal + USDA + OFF).
- Decide **reuse vs create**.
- **Merge / retire duplicates** and near-duplicates.
- Route **brand product vs generic commodity** into the correct catalog row and alias graph.
- **Normalize portion basis** (per 100g / per pack / per serving / portion+total weight country formats).
- **Quarantine** malformed or improbable entries so they never poison self-heal.
- Leave the catalog better so **next time Resolver is not needed**.

### 7.2 When to invoke (trigger router)

Invoke Resolver **only** if any query yields:

| Trigger | Example |
|---------|---------|
| `MULTI_MATCH` | Multiple Sainsbury rolled oats rows + OFF variants |
| `NEAR_DUP_CLUSTER` | Same fdc_id or high name sim + Atwater-close pair |
| `CROSS_SOURCE_CONFLICT` | Internal generic oats vs brand-specific OFF |
| `MISS` after filtered FDC | Regional food, odd clinical string |
| `INVALID_CANDIDATES` | All 0-kcal / wrong form (e.g. tuna salad for greens) |
| `BASIS_AMBIGUOUS` | Nutrients look like per-pack or per-portion but tagged per_100g (or reverse) |
| `IMPLAUSIBLE_ROW` | Existing catalog row 10k kcal/100g, 10kg “serving” |

**Do not invoke** for unambiguous atomic HIT_UNIQUE (target for the debug job’s basic components).

Batch all curator cases into **one** LLM call (1 iteration). Soft cap e.g. 12 cases; prioritize MULTI_MATCH and BASIS_AMBIGUOUS over low-value misses.

### 7.3 Input pack schema (server-built)

```ts
type CuratorCase = {
  query: string;                    // user/scout raw
  clinicalQuery: string;            // inverted English
  brandToken?: string | null;
  chainKey?: string | null;
  countryHint?: string | null;      // GB, ID, US…
  formHints: string[];              // cooked, loose, bar, liquid…
  context: 'atomic_component' | 'brand_product' | 'single_item_dish';

  internalCandidates: Array<{
    food_id: string;
    food_key: string;
    display_name: string;
    status: string;
    nutrients_per_100g: Record<string, number>;
    basis_meta?: BasisMeta;
    fdc_id?: string;
    provenance?: string;
    similarity: number;
  }>;

  externalCandidates: Array<{
    id: string;
    source: 'usda' | 'off' | 'brand_menu' | 'web';
    name: string;
    dataType?: string;
    nutrients: Record<string, number>; // as reported
    basis_raw?: BasisMeta;             // detected before LLM
    kcal: number | null;
  }>;

  nearDuplicates?: Array<{ a: string; b: string; reason: string }>;

  /** Existing row that may need basis fix or quarantine */
  suspectRows?: Array<{ food_id: string; issues: string[] }>;
};

type BasisMeta = {
  basisType: 'per_100g' | 'per_serving' | 'per_pack' | 'per_dish' | 'total' | 'unknown';
  servingGrams: number | null;
  packGrams?: number | null;
  portionsPerPack?: number | null;
  rawServingText?: string | null;
};
```

### 7.4 Output action schema (LLM)

```ts
type CuratorResolution = {
  query: string;
  action:
    | 'pick_existing'
    | 'create_from_external'
    | 'merge_duplicates'
    | 'alias_only'
    | 'normalize_basis'
    | 'quarantine'
    | 'reformulate_pick'   // server already ran reformulated search; pick from expanded list
    | 'no_safe_match';

  chosenFoodId?: string | null;
  chosenExternalId?: string | null;
  catalogTarget: 'generic_food_item' | 'brand_food_item' | 'dish_cache' | 'none';

  aliasesToWrite: string[];         // all normalized keys that should hit this entity next time

  merge?: { winnerId: string; loserIds: string[] };

  create?: {
    display_name: string;
    nutrients_per_100g: Record<string, number>; // MUST be per 100g after normalize
    form_tags: string[];
    provenance: string;
    brand_key?: string | null;
    fdc_id?: string | null;
  };

  basisCorrection?: {
    food_id: string;
    from: BasisMeta;
    to: BasisMeta;
    nutrients_per_100g: Record<string, number>; // rewritten
    reason: string;
  };

  quarantine?: {
    food_ids: string[];
    reason: string;
  };

  rejectExternalIds?: string[];
  confidence: 'high' | 'medium' | 'low';
  reason: string; // one line for logs
};
```

### 7.5 Server execution after LLM (deterministic)

| Action | Server work |
|--------|-------------|
| `pick_existing` | Use nutrients; `upsertFoodAlias` for all aliases; bump `capture_count` / `hit_count` |
| `create_from_external` | Validate gates → `upsertFoodItemCandidate` with correct brand/generic flags → aliases |
| `merge_duplicates` | `mergeFoodCatalogItems` winner/losers; redirect all loser aliases; status `merged` |
| `alias_only` | Aliases only; no new row |
| `normalize_basis` | Rewrite `nutrients_per_100g` + store basis meta; version++ |
| `quarantine` | status `quarantine`; remove from active resolve path; observation event |
| `reformulate_pick` | Same as pick/create from expanded candidates only |
| `no_safe_match` | Category floor for **this meal only**; observation; **no active alias** |

**Allowlist rule retained:** chosen external IDs must appear in the case pack (or reformulated expansion). Forged IDs discarded (existing test).

---

## 8. Catalog routing (right food → right database)

### 8.1 Entity types

| Entity | Table / store | When |
|--------|---------------|------|
| Generic commodity | `food_items` (`provenance` usda/canonical, no brand_key) | Egg, chicken breast, wheat tortilla |
| Brand product | `food_items` with `brand_key` + optional barcode **or** brand_menu id linkage | Sainsbury rolled oats, Co-op yogurt pot |
| Brand dish (restaurant) | Brand menu tables + `dish_aliases` / food_aliases → brand id | Yolk sandwich official kcal |
| Composed dish memory | `dish_cache` | Only when no reliable multi-component decomposition and we store dish-level core |
| Alias graph | `food_aliases` / `dish_aliases` | All successful identities |

**Extend schema (migration)** — prefer columns on existing tables:

```sql
-- food_items additions
ALTER TABLE public.food_items
  ADD COLUMN IF NOT EXISTS brand_key text NULL,
  ADD COLUMN IF NOT EXISTS barcode text NULL,
  ADD COLUMN IF NOT EXISTS basis_type text NOT NULL DEFAULT 'per_100g',
  ADD COLUMN IF NOT EXISTS serving_grams real NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS pack_grams real NULL,
  ADD COLUMN IF NOT EXISTS portions_per_pack real NULL,
  ADD COLUMN IF NOT EXISTS country text NULL,
  ADD COLUMN IF NOT EXISTS entity_kind text NOT NULL DEFAULT 'generic', -- generic | brand_product
  ADD COLUMN IF NOT EXISTS quality_flags text[] DEFAULT '{}';

-- food_aliases additions
ALTER TABLE public.food_aliases
  ADD COLUMN IF NOT EXISTS hit_count int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS source text NULL, -- already exists; use: resolver|deterministic|brand|admin
  ADD COLUMN IF NOT EXISTS confidence real DEFAULT 0.8;

CREATE INDEX IF NOT EXISTS idx_food_items_brand_key ON public.food_items(brand_key);
CREATE INDEX IF NOT EXISTS idx_food_items_entity_kind ON public.food_items(entity_kind);
CREATE INDEX IF NOT EXISTS idx_food_aliases_food_id ON public.food_aliases(food_id);
```

Brand menu rows remain source of truth for chain dishes; aliases may point `alias_key` → `brand_menu:<id>` virtual food_id convention **or** mirrored food_item with `provenance=brand_menu`.

### 8.2 Routing rules for Resolver

| Signal | catalogTarget |
|--------|----------------|
| chainName / brand menu official | brand path (hard truth for meal) + alias |
| Retail brand in query + OFF barcode product | `brand_food_item` |
| Commodity clinical query only | `generic_food_item` |
| Multi-component parent without brand | do not create dish_cache if components resolved |
| Ambiguous “granola” without brand context | **generic** or reject brand_menu false-positive (Co-op pot) |

**Brand false-positive guard (server, pre-LLM):**

- Brand menu substring match on ultra-generic tokens (`granola`, `mayonnaise`, `chicken`, `salad`) requires **chain context** or high product-name token overlap.
- Log: `[BrandGuard] rejected generic token brand hit`.

---

## 9. Portion / basis curator (normalize to per_100g)

Canonical storage for `food_items.nutrients_per_100g` is **always per 100g** after curator/normalize. Meal assembly always uses per_100g × grams.

### 9.1 Country / label patterns to support

| Pattern | Regions | Detection | Normalize |
|---------|---------|-----------|-----------|
| Per 100g column | UK/EU, many packs | “per 100g”, “per 100 ml” | store as-is |
| Per serving + serving grams | US, UK | “per serving” + “30g” | `n * (100/serving_g)` |
| Per pack / whole pack | retail | “per pack”, “per pot” + pack weight | `n * (100/pack_g)` |
| Portion count + total pack weight (no per 100g) | **Indonesia common**, some SEA | “isi 4” / 4 portions + “netto 400g” + nutrients per portion | `portion_g = pack_g/portions`; then to per_100g |
| Per dish total (restaurant) | chains | brand menu whole item | meal basisType `total`/`per_dish` — **do not** write as food_items per_100g without weight; keep brand_menu / dish basis |
| kJ only | EU/AU | energy kJ | convert kcal = kJ/4.184 |

Reuse and extend `server_nutrient_basis.ts` (`NutrientBasisType`, detect/convert helpers).

### 9.2 Pure helper: `normalizeToPer100g`

```ts
function normalizeToPer100g(input: {
  nutrients: Record<string, number>;
  basis: BasisMeta;
}): { ok: true; nutrients_per_100g: Record<string, number>; basis: BasisMeta }
  | { ok: false; reason: string }
```

Rules:

- If `basisType === 'per_100g'` and values already density-like → pass through + plausibility check.
- If per_serving/per_pack/total with known grams → scale to 100g.
- If portions_per_pack + pack_grams → derive portion grams → scale.
- If grams unknown → `ok: false` → Resolver case `BASIS_AMBIGUOUS` or quarantine; **do not invent weight**.

### 9.3 Resolver basisCorrection

When deterministic detection is unsure but text + numbers allow a human-like read:

- LLM proposes `basisCorrection` with from/to + rewritten per_100g.
- Server **recomputes** scale itself from from/to grams (do not trust LLM arithmetic blindly); LLM only chooses interpretation of serving text.

---

## 10. Plausibility & quarantine (malformed data)

### 10.1 Hard reject / quarantine thresholds (server)

| Check | Threshold (defaults; tune in one config object) | Action |
|-------|--------------------------------------------------|--------|
| kcal per 100g | > 950 (above pure fat ~900) or < 0 | reject/quarantine |
| kcal absolute “serving” | > 4000 without multi-serve evidence | reject as meal total mis-tagged |
| serving_grams / pack_grams | > 5000g (e.g. 10kg lasagna as one serving) | quarantine |
| serving_grams | < 1g for solid food | quarantine |
| protein/carbs/fat g per 100g | any > 100 (or fat > 100) | quarantine |
| Atwater vs stated kcal | deviation > 35% (existing helper) | reject promote; optional rescale only for labels with hard printed kcal |
| sodium mg per 100g | > 20000 absurd | quarantine |
| 0 kcal + non-zero macros | inconsistent | reject |
| 0 kcal + zero macros on “food” | reject unless whitelist beverage water | |

Examples from product intent: **10k calorie item**, **10kg lasagna serving** → quarantine, not alias.

### 10.2 Status lifecycle

```text
candidate ──promote──► active
    │                    │
    │                    ├──merge──► merged (parent_id = winner)
    │                    │
    └──fail gates──► quarantine
```

Resolve path uses: `active` + high-quality `candidate` (existing confidence ≥ 0.65 + Atwater). Never `quarantine` / `merged`.

### 10.3 Background hygiene (optional P3)

- Periodic `quarantineAtwaterFailures` (exists) + new `scanImplausibleFoodItems`.
- Resolver can be run offline on `food_observations` deferred gaps (not in request path).

---

## 11. Self-healing alias policy

### 11.1 Always alias on success

Write **multiple** alias keys when safe:

- raw scout query
- clinical query
- brand+product variants
- common synonyms resolved this session

Include **brand products** (user request): e.g. `yolk_steak_chimi`, `coop_blueberry_granola_yogurt_pot`.

### 11.2 Never alias

- Parent multi-component dish → one component
- Quarantined / rejected externals
- `no_safe_match` category floor
- Generic token → random brand menu hit

### 11.3 Hit tracking

On alias hit: `hit_count++`, `last_accessed_at=now()`. Promote `candidate` → `active` when `hit_count >= N` (e.g. 3) and still gate-pass.

---

## 12. Prep fat XOR (anti double-count)

| Condition | Prep policy |
|-----------|-------------|
| Components include oil/butter/mayo/dressing with % > 0 | `decidePrepAddition` reason `fat_in_components` → 0 |
| Composite dish, no fat components, method fried | existing calculated prep OK |
| User explicit “fried in oil” | existing user-explicit path |
| Whole raw produce | 0 (existing) |

---

## 13. Module / file plan

| Module | Responsibility |
|--------|----------------|
| `server_query_set.ts` (new) | Build unique atomic + brand queries from scout; pure + tests |
| `server_clinical_query.ts` (new) | Light normalization / inversion helpers (not full LLM) |
| `server_fdc_resolve.ts` (new or extract) | Filtered search, rank, HIT/MULTI/MISS classification |
| `server_catalog_gates.ts` (new) | Plausibility, Atwater wrap, 0-kcal reject, promote rules |
| `server_basis_normalize.ts` (extend `server_nutrient_basis.ts`) | Country patterns → per_100g |
| `server_food_resolver_curator.ts` (new) | Build cases, prompt, parse actions, execute writes |
| `server_food_catalog.ts` | Schema fields, alias hit_count, brand_key, merge hooks |
| `server_vision_scout.ts` / scout prompt | Clinical English, inversion, mass%, oil component |
| `server.ts` | Wire: query set → resolve → curator → assembly; thin |
| `agents/foodResolverInstructions.ts` | Curator system instruction + JSON schema |
| Migration `supabase/migrations/20260812_food_catalog_curator.sql` | Columns above |

**Do not** grow `server.ts` with curator business logic — extract.

---

## 14. Phased delivery

### Phase 0 — Query hygiene + 0-kcal reject (no schema)

**Work**

- `buildFoodSearchQuerySet(scoutItems)` components-only.
- Reject 0-kcal FDC before match / before persist.
- BrandGuard on generic tokens.
- Log `[QuerySet] n=…` and list.

**Exit criteria (job lj1iw1c3k)**

- Search count ≤ 14 unique atomics.
- No parent `chicken avocado salad bowl` in USDA atomic list.
- Tortilla candidate without kcal cannot be chosen or persisted.

**Tests**

- `server_query_set.test.ts` with fixture from scout JSON in that job.
- Gate strings in assert script optional.

### Phase 1 — Filtered FDC + ranking + scout clinical prompt

**Work**

- Atomic dataTypes include FNDDS; Branded only brand class.
- Rank-N + matching_engine; HIT_UNIQUE auto-alias (gated).
- Scout prompt: inversion + clinical English + oil component rule.

**Exit criteria**

- `boiled egg` → hard-boiled style entry, not dried yolk powder.
- `mixed salad greens` → leafy greens, not tuna salad.
- Resolver not called when all atomics HIT_UNIQUE.

### Phase 2 — Curator Resolver v1 (pick / merge / alias / create)

**Work**

- Trigger router MULTI_MATCH | MISS | INVALID.
- New action schema + `server_food_resolver_curator.ts`.
- Execute merge + multi-alias + create gates.
- Replace “gap title spam” path; keep 1 iteration.

**Exit criteria**

- Sainsbury multi-oats style fixture: one winner, losers merged, ≥2 aliases.
- Duplicate food_items count decreases on fixture DB.
- Forged chosenFdcId still discarded (existing test + action schema tests).

### Phase 3 — Basis normalize + brand routing + plausibility

**Work**

- Migration columns; `normalizeToPer100g` for ID/UK/US patterns.
- Resolver actions `normalize_basis` + `quarantine`.
- Brand vs generic `entity_kind` / `brand_key`.
- Implausible thresholds config + quarantine scan.

**Exit criteria**

- Per-portion + pack weight (ID-style) → correct per_100g within 5% of hand calc.
- 10k kcal / 10kg serving fixtures → quarantine, not active alias.
- Brand product aliases resolve without re-search.

### Phase 4 — Density / mass assembly + prep XOR polish

**Work**

- massPercentage or density table for volume%.
- Prep XOR integration tests.
- Metrics: resolver_call_rate, alias_hit_rate, quarantine_count.

**Exit criteria**

- Chicken salad style foundation not 2× scout soft budget from bad matches.
- Warm re-run same meal: alias hits ≥ 80% of atomics, resolver_cases = 0.

### Phase 5 — Hardening

**Work**

- Golden meal suite (20–50): label-only, brand partial, home atomic, fried oil, ID label, UK label, multi-photo.
- Domain rulebook update (`food-calc.md` Resolver role).
- Admin: list quarantine, force merge (optional UI).

---

## 15. Resolver system prompt (summary for `foodResolverInstructions.ts`)

Replace gap-only librarian text with curator mandate:

1. You curate the **internal nutrition database** and resolve identity conflicts.
2. Prefer **reuse + alias** over new rows; **merge** near-duplicates.
3. Route **brand products** vs **generic commodities** correctly.
4. All stored densities are **per 100g**; interpret country serving formats; propose basis interpretation, server will recompute.
5. Quarantine impossible values (extreme kcal, absurd weights).
6. Choose only from provided candidates; never invent IDs.
7. Output strict JSON actions; one line reason each.
8. Success = next identical query needs **no** Resolver.

---

## 16. Logging & observability

| Log tag | Meaning |
|---------|---------|
| `[QuerySet]` | Final unique queries |
| `[ResolveClass]` | HIT_UNIQUE / MULTI_MATCH / MISS per query |
| `[BrandGuard]` | Rejected generic brand false positive |
| `[CuratorCase]` | Case built for Resolver |
| `[CuratorAction]` | action + chosen ids + aliases |
| `[BasisNormalize]` | from → to + factor |
| `[CatalogQuarantine]` | food_id + reason |
| `[AliasHit]` / `[AliasWrite]` | self-heal path |
| `[PrepXOR]` | fat_in_components vs calculated prep |
| `[Budget]` / `[Foundation]` / `[Reconcile]` | unchanged meal math |

Catalog sync status already exposes resolver_call_count / deferred gaps — add `alias_hit_count`, `curator_merge_count`, `quarantine_count` if easy.

---

## 17. Testing plan

### Unit

| File | Coverage |
|------|----------|
| `server_query_set.test.ts` | job lj1 fixture → atomic-only list |
| `server_basis_normalize.test.ts` | per 100g, per serving, per pack, ID portion+netto |
| `server_catalog_gates.test.ts` | 0-kcal, 10k kcal, 10kg serving, Atwater |
| `server_food_resolver_curator.test.ts` | parse actions, allowlist, merge execution mocks |
| existing `server_food_resolver.test.ts` | keep forged ID + cap behavior (update cap semantics if needed) |
| `server_budget_reconcile.test.ts` | hard brand + foundation scale unchanged |

### Integration / golden

| Scenario | Expect |
|----------|--------|
| Granola+wrap+salad+croissant job | No parent gaps; tortilla has kcal; greens not tuna; protein salad not 124g from bad egg |
| Yolk kcal-only | hard lock kcal; components shape macros; scout soft void |
| Sainsbury oats multi | one active row; aliases; duplicates merged |
| ID label portion×pack | per_100g correct |
| Malformed catalog row | quarantine |

### Regression gates

Update `docs/agent/DOMAIN_REGRESSION_MAP.md` Food-calc section:

- QuerySet components-only for multi-component.
- Curator not meal calorie inventor.
- Brand/OCR hard lock still wins.
- Mode A/D/Edit same finalize.

---

## 18. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Resolver over-called again | Strict trigger router; HIT_UNIQUE never calls LLM |
| LLM bad merge | Server-only merge with bar/loose guard; require winner in candidate set |
| LLM bad arithmetic on basis | Server recomputes from grams; LLM only chooses interpretation |
| Schema drift | Single migration; no parallel basic_foods table |
| Brand pollution | BrandGuard + entity_kind |
| Latency regression | 1 curator call batched; fewer USDA queries overall |
| Double fat / double scale | PrepXOR + single reconcile (tests) |

---

## 19. Success metrics

| Metric | Baseline (job lj1) | Target |
|--------|--------------------|--------|
| Unique DB queries / meal | 22 | ≤ 14 atomics first pass; ≪10 after warm |
| Resolver LLM calls | 1 heavy (8+ deferred) | 0 on basic atomics; 1 only on true curator cases |
| Wrong form matches (greens/egg/tortilla) | present | 0 on golden set |
| 0-kcal persist | yes (2758996) | 0 |
| Alias hit rate on repeat meal | low | ≥ 80% |
| Near-duplicate active pairs | high growth | decreasing |
| Brand false-positive on mayo/granola | yes | 0 without chain context |

---

## 20. Documentation updates (with implementation)

When phases land (protected-doc confirmation per `AGENTS.md`):

1. `docs/agent/domains/food-calc.md` — Resolver role → **catalog curator**; pipeline diagram add QuerySet + Curator.
2. `plan/README.md` — index this plan (see below).
3. `AI_HANDOVER.md` — WIP checkboxes per phase.
4. `agents/foodResolverInstructions.ts` — curator prompt.

---

## 21. Implementation checklist (quick)

- [x] P0 `buildFoodSearchQuerySet` + tests + wire server.ts
- [x] P0 0-kcal reject + BrandGuard
- [x] P1 FNDDS + rank-N + scout clinical prompt
- [x] P1 HIT_UNIQUE gated alias write
- [x] P2 CuratorCase builder + action schema + execute layer
- [x] P2 merge_duplicates + multi-alias
- [x] P3 migration basis/brand columns
- [x] P3 normalizeToPer100g + normalize_basis action
- [x] P3 quarantine implausible
- [x] P4 prep XOR + density/mass
- [x] P5 golden suite + domain doc

---

## 22. One-line north star

**Deterministic resolve serves the meal; the Resolver curates identity, basis, and brand routing so the catalog self-heals and the Resolver is not needed next time — while OCR/brand remain meal truth.**
