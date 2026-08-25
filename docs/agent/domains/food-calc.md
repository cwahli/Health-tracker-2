# Domain rulebook: Food-calc

**Load when:** calories, scout, budget, reconcile, receipt, portion, catalog/resolver, Mode A/D/Edit food analyze.  
**Do not load** for pure biomarker UI or unrelated CSS.

**Plans (architecture):** `plan/FOOD_CALC_HYBRID_AND_INTERNAL_DB_PLAN.md`  
**WIP status:** `AI_HANDOVER.md`  
**Gates:** `docs/agent/DOMAIN_REGRESSION_MAP.md` → Food-calc section.

**How to use this book:** Default path that stops regressions. **Not a freeze** on product change.  
If you intentionally change pipeline/modes/fields: get confirmation for protected-doc edit (`AGENTS.md` §3), show before→after, update this file + tests in the same task. Do not invent a silent side pipeline for one bug.

---

## 1. Pipeline (Dish-Level Inverted Pipeline — default)

```text
Vision Scout (dish-level portion estimate + direct carbohydrates + printed OCR label + ingredients)
  → Finalize Engine (3-Rung Truth Hierarchy: OCR → Brand Menu → Scout Estimate + USDA Atomics)
  → Single Scaler Math (R = W_consumed / W_basis)
  → Pure TS Derivation (Bottom-Up Calories = 4P + 4C + 9F, Unsat Fat, Salt, Carbs) & Atwater Check
  → Dietitian Clinical Audit & Pure TS Macro Rebalancing (active review; clinical corrections rebalanced deterministically)
```

| Role | Rule |
|------|------|
| Scout | Identifies whole dishes, assigns realistic gram weight & direct physical macros (P, C, F) per dish, transcribes printed labels verbatim, emits plain ingredients |
| `rawNutritionLabel` | **Printed label only** — never invented |
| Truth Hierarchy | Rung 1 (OCR) → Rung 2 (Brand Menu) → Rung 3 (Scout Estimate + USDA Atomics) |
| Scaler | **Single scaler across entire system:** $R = \text{consumedWeight} / \text{nutrientBasisWeight}$. Never double-scale or clamp brand lock basis |
| Derivations | `server_derivation.ts` computes bottom-up Calories ($4\text{P} + 4\text{C} + 9\text{F}$), unsaturated fat, and salt mathematically |
| Dietitian | Audits server finalize ledger against culinary reality; emits `correctedNutrients` with clinical notes; pure TS rebalances dependent metrics |
| Modes | Same finalize math (`finalizeDishLedger`) for **Mode A, Mode D, and Edit** |

---

## 1b. LLM Structured Output & Schema Invariants (Grammar Enforcement)

To guarantee that Vision Scout and Dietitian agents reliably emit core fields (e.g., `nutrients`, `ingredients`):

1. **Multi-Level `required` Arrays in `responseSchema`:**
   - In Gemini Structured Outputs (`responseMimeType: "application/json"`), defining a field in `properties` is only *permissive*.
   - To make it mandatory, the field MUST be included in the enclosing object's `required` list at **every level**:
     - Level 1 (`items.required`): `["keyword", "originalName", "estimatedWeightGrams", "nutrients", "ingredients", "boundingBox2D", "sourceImageIndex"]`
     - Level 2 (`nutrients.required`): `["calories", "protein", "totalFat", "carbohydrates", "sodium", "saturatedFat"]`
   - *Failure to add to `required` causes lite models (`gemini-3.5-flash-lite`) to drop nested objects.*

2. **Concrete Numeric Values in Prompt Schema Templates:**
   - System instruction schema examples must use concrete numbers (e.g. `"calories": 480, "protein": 22`) instead of type string placeholders (`"calories": "number"`). Lite models pattern-match directly on the template.

3. **Explicit `propertyOrdering`:**
   - Place critical estimation fields (`estimatedWeightGrams`, `ingredients`, `nutrients`) early in `propertyOrdering` before bulky fields like bounding boxes or label OCR strings.

4. **Aggregator Baseline Resolution (`server_nutrient_aggregation.ts`):**
   - Must resolve `labelData = item.labelNutrientsPerServing || item.syntheticBase100g`.
   - Never allow dish estimates with synthetic baselines to evaluate `labelData` to null.

5. **Reality-Check Immunity for Dish Estimates & Brand Truth:**
   - `applyNutrientRealityChecks` must skip heuristic category rewrites when `syntheticBase100g`, `isDishEstimate`, or `dbSource === "brand_official"` is present.

---

## 1c. Nutrient Precision Hierarchy (31 Nutrients)

### 1. Core Nutrients (High Precision ~90–100%)
*Reason: Narrow safety windows, non-negotiable physiological floors, and hard upper limits where estimation errors cause acute metabolic disruption, cardiovascular risk, or rapid dietary drift within 24–48 hours.*
- **Calories**
- **Protein**
- **Saturated Fat**
- **Trans Fat**
- **Added Sugar**
- **Total Fibre**
- **Sodium**
- **Carbohydrates** [Derived mathematically: $(\text{Calories} - (4 \times \text{Protein}) - (9 \times \text{Total Fat})) / 4$ if omitted or unprovided]

### 2. Key Nutrients (Moderate Precision ~70%)
*Reason: Wide biological buffers and flexible metabolic ranges where day-to-day fluctuations are regulated by homeostatic reserves; medium-term weekly averages matter far more than single-meal precision.*
- **Total Fat**
- **Total Sugar**
- **Potassium**
- **Omega-3**
- **Calcium**
- **Iron**
- **Magnesium**
- **Vitamin D**
- **Unsaturated Fat** [Derived: $\text{Total Fat} - (\text{Saturated Fat} + \text{Trans Fat})$]
- **Salt** [Derived: $(\text{Sodium in mg} \times 2.54) / 1000$]

### 3. Extended Nutrients (Directional Precision <50%)
*Reason: Deep internal storage pools (liver, bone, adipose tissue) that buffer deficiencies over weeks to years, or ubiquitous dietary abundance where day-to-day tracking errors carry negligible clinical risk.*
- **Soluble Fibre**
- **Vitamin A**
- **Thiamine (B1)**
- **Riboflavin (B2)**
- **Niacin (B3)**
- **Vitamin B6**
- **Folate (B9)**
- **Vitamin B12**
- **Vitamin C**
- **Vitamin E**
- **Vitamin K**
- **Zinc**
- **Selenium**
- **Iodine**
- **Phosphorus**

---

## 1d. Dietitian Final Nutrient Audit & Clinical Corrections

The Dietitian coach serves as the final clinical auditor on all nutrient estimates before meal presentation:

1. **Final Sanity Audit:**
   - The Dietitian inspects the backend finalize ledger against the meal image context, dining environment, and culinary preparation realism.
   - If the Dietitian identifies an implausible or underestimated figure (e.g. oil absorption was underestimated on deep-fried elements, sodium was under-calculated for fast food, or uncaptured cooking fats), the Dietitian has the authority to emit corrected values (`correctedNutrients`).

2. **Mandatory Audit & Clinical Note:**
   - Every adjustment made by the Dietitian MUST be accompanied by an explicit clinical note explaining *why* the value was modified (e.g., `"Adjusted fat +6g (+54 kcal) to account for deep-fried wonton oil absorption"`, `"Adjusted sodium to 850mg based on fast-food seasoning prior"`).

3. **Single-Ledger Parity Guarantee:**
   - When the Dietitian issues a correction, the modified values immediately become the authoritative numbers for both the Dietitian narrative and the saved meal breakdown table, ensuring 1:1 parity with full audit transparency.

4. **Pure TS Macro Rebalancing:**
   - Whenever the Dietitian mutates one or more macros or calories, pure TypeScript middleware (`rebalanceNutrientProfile`) deterministically recomputes dependent metrics ($\text{Calories} = 4\text{P} + 4\text{C} + 9\text{F}$, $\text{Unsaturated Fat}$, $\text{Salt}$) and clamps values to physical density bounds, ensuring 100% thermodynamic consistency.

---

## 2. Mode matrix (all modes share finalize math)

| Behavior | Mode A (`new_log`) | Mode D (evaluation) | Edit / modify |
|----------|--------------------|---------------------|---------------|
| Finalize ledger | `finalizeDishLedger` | `finalizeDishLedger` (`mode=D`) | `finalizeDishLedger` (`mode=edit`) |
| Portion scale | $R = W_1 / W_0$ | $R = W_1 / W_0$ | $R = W_1 / W_0$ |

- Mode A PASS ≠ Mode D/Edit PASS.  
- Prefer **one shared helper** + call sites in each mode over copy-paste math.  
- Unique log substrings for gates (e.g. `[Budget] mode=D`).

---

## 3. Second-order invariants (always if relevant)

| Topic | Must |
|-------|------|
| Merge | Preserve `rawNutritionLabel`, `estimatedCalories`, `estimatedWeightGrams`, `components` |
| Reconcile | Soft result not wiped; re-apply **only** `itemLockedKeys` |
| Scale | Item total scale ⇒ **component rows** scale |
| Multi-turn Portion | Turn 1 carries forward `resolvedDbCandidates` to Turn 2 (`skipScout=true`) to bypass redundant DB re-scans |
| Log Stitching | Preserve `turn1Logs` across portion pauses; stitch Turn 1 + Turn 2 logs for complete R2 debug trace |
| UI Portion Card | Map `needsPortionClarify` & `portionClarify` into `msg.data` so portion selection card renders immediately |
| Stale Narrative | Weight/portion change without dietitian re-run sets `staleDietitianNarrative=true` (D8 / edit scale) |
| Invariant | Detect **and REPAIR the class** (not log-only FAIL). Do **not** “repair” by scaling/aliasing to hide imbalance (L14) |
| Match priority | Real USDA/OFF/catalog **beats** `category_fallback` |
| Fail-open | Agent error → top form-safe candidate, not mass category dump |
| Import | Call site on **each** required branch |

**Classic regressions to refuse:**

- Spreading LLM over vision and dropping `estimatedCalories`  
- Reconcile then re-applying full “truth” map  
- Import `portionAndReconcile` without Mode D/Edit call site  
- Re-running entire vision scout / DB search on Turn 2 portion confirmation  
- Dropping `portionClarify` metadata in client streaming message handlers  
- Overwriting Turn 1 vision logs in R2 upon Turn 2 completion  

---

## 3b. Durable pipeline contract (long-term, no catalog paint)

Success is **not** “this meal’s FDC IDs match a spreadsheet.”  
Success is: **Scout names the food → Resolver resolves *that query* → Backend keeps that bind.** The next unknown food uses the same path.

```text
Scout (vision)     → dishes + component searchQuery + scoutIndex + boxes
Resolver (1 LLM)   → for each query: HIT / MULTI / MISS on *that* query’s candidates
Backend bind       → component may only use rows tagged searchQuery === this query
Honest residual    → MISS is done. Do not steal a sibling row. Do not invent an alias.

Meal trial balance (golden detector — does not solve):
  scout_est → foundation → reconcile → dietitian_payload → saved_table → narrative
  Adjacent books must agree. A backend or dietitian *correction* is a red
  (SILENT_REPAIR / DISH_DROP), not a way to paint green.
```

| Layer | May do | Must not do |
|---|---|---|
| Scout | Extract names, components, weights, printed labels | Guess FDC IDs; invent `rawNutritionLabel` |
| Resolver | Pick / quarantine / MISS among **this query’s** USDA/OFF hits | Write `food_aliases` from HIT_UNIQUE; bind chicken using the onions row |
| Backend | Query-scoped bind; index/name identity; no 2.000 silent scale | `includes()` catalog; `expectFdcId` paint; meal-wide `databaseMatchesArray` steal |

**Patches that look green and fail on the next food (forbidden):**

- `CANONICAL_BASE_FOODS` / `lookupCanonicalBaseFood` `includes()`
- `expectResolve` exact FDC as the test reward
- `POST /loop` until picnic `all_green`
- Extra negative regex for one ID (171327, 172522, …) as the *only* fix

**Debug flow (Studio, no babysit, no loop):**

1. Classify the tape (one class). List other reds as out of session.
2. Hypothesis: which **layer** broke the contract (scout opening / resolver MISS vs steal / backend steal / silent repair).
3. Predicted test: a **generic** fixture (not “G8 sugar”), e.g. pool with two sibling queries — bind must not cross.
4. Patch that layer only. Two burned hypotheses → `blocked_human` (only then ping the human).
5. Outer: one replay of the example meal. Do not `/loop`.

| Class | Inbox / tape examples | Layer that should learn |
|---|---|---|
| Query-scope steal | wrap chicken→onion powder; flour→tortilla; salt→butter | Backend bind (`searchQuery`) |
| False friend in-query | sugar→Popsicle; berries→Powerade; ham→salt pork | Resolver ranker refuse |
| Dish drop / index | croissant phantom 4106; ham gone; quinoa gone | Backend identity + scout merge |
| Opening wrong | lassi 1000g | Scout weight-anchor; one NEW Analyze |
| Silent repair | receipt 2.000 | Backend: stay red, `itemCal := rowSum` |
| Transport | inbox quota job | Not food-calc |

**Golden compiler + journey UI:** inbox shows scout→…→narrative books. `all_green` / Promote is blocked while the compiler is `unbalanced`. Catalog replay cannot promote.

**Many jobs, no loop:** run independent classes in one turn. Inner loop = named vitest. `POST /loop` is forbidden. Two burned hypotheses → `blocked_human` on that job (only then ping the human), then start the next class.

---

## 4. Hot files (prefer extract + test)

| Area | Prefer |
|------|--------|
| Budget / reconcile | `server_budget_reconcile.ts` + tests |
| Catalog / DB / resolver | `server_food_*.ts` |
| Pure helpers | `server_pure_helpers.ts`, aggregation/basis modules |
| Client jobs | `src/jobs/FoodAgentExecutor.ts`, modal/job tests |
| God files | Thin patches only in `server.ts` / large UI — no end-to-end rewrite |

---

## 5. Anti-patterns

- “Implement budget properly” without call sites + mode logs  
- Grep theater (symbol exists ≠ invoked on path)  
- Claiming COMPLETE after Mode A only  
- Weakening assert scripts to green  

---

## 6. Behavioral tests (required)

```bash
npx vitest run server_budget_reconcile.test.ts server_vision_scout.test.ts server_nutrient_aggregation.test.ts server_portion_clarify.test.ts
# + relevant assert scripts from DOMAIN_REGRESSION_MAP.md
```

| Invariant | Covered by |
|-----------|------------|
| Label / brand / dish_cache / scout / category budget priority | `server_budget_reconcile.test.ts` |
| `parseLabelCalories` | same |
| incompleteAssembly reject_scale | same |
| Post-reconcile locks & density correction (`applyPostReconcileTruthLocks`) | same |
| Vision soft kcal + weight + components survive LLM merge | `server_vision_scout.test.ts` (`mergeScoutItems`) |
| Aggregation preserves `rawNutritionLabel` / `components` + locks | `server_nutrient_aggregation.test.ts` |
| Portion choice scales `estimatedCalories`, keeps label | `server_portion_clarify.test.ts` |

### Invariants & Gates

1. Post-reconcile `applyPostReconcileTruthLocks` pure helper + tests extracted from `server.ts`.  
2. Mode A/D/Edit call-site remains gate-asserted (string/log); do not drop mode tags.

### Database Curator (Food Resolver)
The Food Resolver agent now operates as a **Catalog Curator**. 
- It uses a strict `FoodCuratorActionSchema` with actions like `pick_existing`, `merge_duplicates`, `normalize_basis`, and `quarantine`.
- It is triggered by `MULTI_MATCH` or `MISS` classifications from the FDC Resolve layer.
- `HIT_UNIQUE` queries bypass the LLM and are automatically aliased in the database.
- It never invents meal macros or acts as a meal math calculator; its sole purpose is to resolve item identities to standard `food_items` rows.
