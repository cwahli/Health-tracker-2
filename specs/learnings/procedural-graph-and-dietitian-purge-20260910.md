---
slug: procedural-graph-and-dietitian-purge
date: 2026-09-10
class: PROCESS_GAP
node: Builder
status: draft
---

# Learning: Dietitian Purge, Non-USDA Nutrient Derivation, and Compare Catch-All Collapse on Dense Menus

## What happened
1. **Dietitian Deprecation Completed:** The secondary Dietitian LLM evaluation was fully purged from `server_food_analyze_run_dietitian.ts`, converting the phase into a 0-cost, 0-token deterministic TypeScript projector (`executeMealProjectorPhase`). User-facing UI chrome, tabs, badges, and translations were updated from "Dietitian" to "Meal Agent" across English and Indonesian while retaining backward compatibility for historical logs in Supabase.
2. **Context Exhaustion & Catch-All Tier Collapse on Dense Menus (Set 3):**
   - In Mode D Compare, the monolithic instruction required the LLM to output 100+ dishes twice (`allExtractedDishes` + inside `groups[].items`) and compute 20 nutrient values per group.
   - On Set 3 (Sambal Bakar Pencok 89, 2 menu pages, 104 dishes), this caused extreme latency (**27.5s**), token bloat (**5,907 candidate tokens**), and **Semantic Collapse**: 68 out of 100 dishes were dumped into a single catch-all "Tier 3 Warning" group.
   - Critical clinical error: Cardioprotective *Ikan Kembung* (Indo-Pacific Mackerel, rich in marine EPA/DHA Omega-3s essential for the patient's high LDL) was misclassified into Tier 3 Warning alongside deep-fried chicken intestines (`Sate Usus`) and 1,500mg-sodium salted fish (`Ikan Asin`).
3. **Procedural Graph Superiority on Complex Cases:**
   - Decomposing the comparison into active procedural nodes [Extraction $\rightarrow$ Anti-Collapse Clustering $\rightarrow$ 100g Normalization $\rightarrow$ Clinical Trade-offs] reduced latency to **20.8s** (25% faster) and output tokens to **1,620** (72.6% reduction).
   - Prevented catch-all collapse: Cardioprotective whole fish was correctly classified into Tier 2 (Neutral), salted fish and offal were isolated into Tier 4 (Alert), and the recommendation paired grilled Mackerel with *Sayur Asem* to solve both the patient's -17% protein deficit and high LDL.
4. **Non-USDA Computation Confirmation:**
   - External USDA querying was discontinued due to regional Asian/Indonesian catalog gaps and high latency.
   - The verified 4-pillar truth hierarchy operates in pure TypeScript:
     1. Packaging Label OCR Lock (Rung 1, F-8.12) scaled by Single Scaler $R = W_1 / W_0$.
     2. Brand Menu Database (`server_brand_match.ts`).
     3. 14 Universal Food-Type Biological Trace Archetypes (`FOOD_TYPE_TRACE_NUTRIENTS` in `server_food_db.ts`).
     4. Deterministic TypeScript derivation: Atwater calories ($4P + 4C + 9F$), Salt ($\text{Na} \times 0.00254$), Unsaturated Fat ($\text{Total} - \text{Sat} - \text{Trans}$), and Cooking Method Oil Critic (`COOKING_METHOD_OIL_MODIFIERS`).

## What the user asked
1. "There are no more dietician. Can you do an audit and clean that up so there is no more reference?"
2. "compare the old system without diet. Do a new test without diet. It's already been removed. Do a 1 API call for both. The latest goldenmeal test is 1 agent only as well. Then compare"
3. "in term of nutrient output, what's the difference between the 2. And how is it computed correctly? we stop using USDA because it most of the time do not have the data when needed. If you compute it, you need to use something else"
4. "Can you test your method on a true complex case. Use the compare meal set 3. It's using 2 menu item. Test it with the existing compare Vs the new method and see what's best"
5. "push everything and your learning to github"

## Keep
- Pure TypeScript projector execution (`executeMealProjectorPhase`) with zero secondary LLM calls.
- Backward compatibility for `dietitianScratchpad` and `dietitianAnswer` in historical log readers.
- 4-Pillar Non-USDA Truth Hierarchy in `server_dish_finalize.ts` and `server_food_db.ts`.
- Anti-Collapse procedural clustering rules in Mode D Compare to prevent cardioprotective marine fish from being branded as deep-fried offal hazards.

## Propose standing (add only)
```json
{
  "id": "compare_anti_collapse_marine_omega3",
  "label": "Mode D Compare must isolate cardioprotective whole fish from deep-fried sets and offal",
  "asked": "repeated",
  "files_must_contain": {
    "prototype/meallog/compare/scout_only_compare_instructions.ts": [
      "UNLISTED HARMS & BENEFITS ISOLATION",
      "BENEFITS: Elevate whole foods offering cardioprotective marine Omega-3s"
    ]
  }
}
```

## Propose skill delta (≤5 lines each, additive)
- planner: For dense multi-page menus (50+ items), prohibit requiring the LLM to output full string arrays twice in JSON. Use menu section partitioning and representative item mapping.
- builder: In Mode D Compare, ensure cardioprotective whole sea fish (Mackerel, Salmon, Tilapia) are elevated to Tier 1 or Tier 2, never lumped with deep-fried poultry, salted fish, or offal.
- guard: Assert that `server_food_analyze_run_dietitian.ts` contains no live `callUnifiedLLM` invocations (pure TS projector).

## Do not
- Delete standing rows
- Reintroduce live Dietitian LLM calls on meal creation
- Query external USDA APIs on the hot path for regional/Indonesian foods
- Overwrite compare instruction with meal-log instruction
