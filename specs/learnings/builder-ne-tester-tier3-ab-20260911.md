---
slug: builder-ne-tester-tier3-ab
date: 2026-09-11
class: PROCESS_GAP
node: Builder
status: promoted
---

# Learning: Builder must not score its own Tier-3 / live A/B quality claims

## What happened
1. Fair + same-schema Vertex Set 3 A/Bs showed the procedural-graph “wins” in `procedural-graph-and-dietitian-purge-20260910.md` were driven by **prompt spoilers**, **smaller schemas**, and **incomplete grouping** — not gated multi-step execution.
2. `run_compare_set3_live.ts` coached Arm B (`Do NOT put mackerel/kembung in the warning tier`, named dishes). Same agent authored method + scorecard + learning claim.
3. Journey already separates Maker≠Checker for **standing/Guard** (Builder ≠ `journey-guard.mjs`). That separation **did not** cover live clinical/cost A/B evals under `prototype/meallog/procedural_graph/`.

## What the user asked
- Review whether we have separation of roles.
- “Yeah do that” (standing ratchet for builder ≠ tester) and continue the benchmark; keep current (monolith) compare method for now.

## Keep
- Production Mode D: `scout_only_compare_instructions.ts` + `scoutOnlyCompareResponseSchema` (single API call).
- Journey Builder ≠ Guard script for code/standing.
- Frozen ground truth: `golden/meal/Meal_03_compare/correct_results.md` / `benchmark_result.md` as score targets — not builder-authored “wins.”

## Propose standing (add only)
```json
{
  "id": "builder_ne_tier3_ab_scorer",
  "label": "Agent that authors a method must not run/score its own live A/B or Tier-3 quality claim",
  "asked": "repeated",
  "files_must_contain": {
    "docs/agent/JOURNEY.md": [
      "Builder ≠ Tier-3 scorer",
      "frozen ground-truth scorecard"
    ],
    "plan/RELIABILITY.md": [
      "Builder must not author and score the same live A/B"
    ]
  }
}
```

## Propose skill delta (≤5 lines each, additive)
- planner: Tier-3 / A/B packets must name a separate eval owner (script+GT or different surface); Builder may not own the scorecard.
- builder: Do not add dish-name spoilers or self-graded “wins” into live compare harnesses; leave production compare instruction/schema alone unless packet Allowed.
- guard: Standing needles in JOURNEY.md + RELIABILITY.md for builder≠Tier-3 scorer; do not weaken goldens to pass a prototype claim.
- reviewer: When a learning claims A/B superiority, require fair harness evidence (same schema option, no spoilers, score vs golden) or classify PROCESS_GAP.

## Do not
- Delete standing rows
- Treat one-call “procedural steps” prose as a gated graph win
- Reintroduce Dietitian LLM or USDA hot path
