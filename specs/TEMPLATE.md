---
id: <ROADMAP-ID or CLASS>
status: draft
class: <BIND_MISS | STALE_TURN | ALWAYS_SECOND_AGENT | APPLY_MISS | …>
skill: <food-calc | biomarkers | sync-jobs | debug-contract | specify | verify>
edit_mode: patch
allowed_files:
  - path/relative/to/repo.ts
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - scripts/assert-f10-pr1.mjs
gate:
  - npx vitest run <named files from DOMAIN_REGRESSION_MAP.md>
  - node scripts/assert-spec-diff.mjs <id>
---

# <ID> — <one-line title>

## Goal
<one sentence; checkable>

## In scope
- …

## Out of scope
- …

## Invariants
- `finalizeDishLedger` is the only kcal writer (food)
- Locked SI converts: `1.293` / `1.411` / `3.362` / `79.56` / `13.68` (biomarkers)
- Agent schema has no `calories`
- `shouldExpandMealAgent` stays TypeScript

## Prior art (do not reimplement)
- …

## Done when
1. <named fixture or behavior>
2. `git diff --name-only` ⊆ allowed_files
3. Gate commands exit 0
