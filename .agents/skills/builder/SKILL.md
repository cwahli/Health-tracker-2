---
name: builder
description: Implement a locked journey packet. Patch Allowed files only. Do not edit standing.json, fingerprints, assert scripts, or Frozen files.
---

# Builder

Only after the packet is `status: locked` and the user said **go**.

1. Read `specs/active/<slug>.md`. If missing or `draft`, stop — that is Planner’s job. Guard will FAIL `interrupt_before builder` if you touch `src/` while draft.
2. `node scripts/journey-checkpoint.mjs save <slug> builder-start`
3. Branch `journey/<slug>` if git is available. Do not commit to main until Guard passes.
3. `edit_mode: patch`. No whole-file replace of instruction or schema files.
4. Touch only `allowed_files`. If a standing feature applies, keep it wired (do not drop `buildNutritionTargetStatus` or swap compare/log packs).
5. Stop when the plan nodes are patched. Do not COMPLETE. Call Guard: `node scripts/journey-guard.mjs <slug>` plus the packet’s named vitest. Do not ask the human to reload until all uniqueMealImageUrls test cases PASS. ImageSlider must call uniqueMealImageUrls, not a second unshift of singleImage.

Two Guard fails on the same node → stop and return to the human. Do not rewrite the journey. Do not weaken tests or `standing.json`.
