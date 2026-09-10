---
slug: biomarker-lifestyle-and-job-milestones
date: 2026-09-10
class: PROCESS_GAP
node: Builder
status: promoted
---

# Learning: Behavioral metrics and medical background jobs lacked dedicated sensors and standing rows

## What happened
1. **Biomarker Range Heuristic Domain Bleed:** In `src/utils/biomarkers.ts`, a clinical laboratory sanity check (`num < refMin * 0.45` to catch g/dL vs g/L blood dilution errors) was applied indiscriminately to lifestyle metrics. A normal sedentary reading (`Steps: 3095`) was erroneously flagged as an impossible medical value.
2. **Phantom UI Action:** When the Biomarker Review Agent returned qualitative clinical advice without modifying records, `BiomarkerReviewCard.tsx` displayed an active `Accept Proposal` button that triggered empty mutations.
3. **Silent Job Progress Freeze:** In `serverJobs.ts`, `updateSupabaseProgress` only monitored food-specific pipeline keywords (`scout`, `usda`, `dietitian`). Medical jobs were stuck at `15%` throughout execution despite backend progress.

## What the user asked
1. "FLAGGED: Improbable Biomarker Value (3095 steps/day)... review this and say what can be improved."
2. "Biomarker Telemetry & Scaling Errors Detected... review what happened here."
3. "Integrate 2026 Harness Engineering (Hashimoto's Ratchet) and Stanford SHEPHERD into our process."

## Keep
- `isExcludedDeviceMetric` in `src/utils/biomarkers.ts` exempting steps, active minutes, and lifestyle metrics from laboratory plausibility ratio checks.
- Conditional `Acknowledge` vs `Accept Proposal` action in `BiomarkerReviewCard.tsx` depending on `hasProposalChanges || hasModifications`.
- Medical job milestones (25%, 50%, 75%, 90%) in `serverJobs.ts`.
- Reversible git execution tree (`scripts/journey-checkpoint.mjs`) to avoid compounding errors.

## Propose standing (add only)
```json
{
  "id": "biomarker_lifestyle_exclusion",
  "label": "Behavioral metrics (steps, active minutes) excluded from laboratory range-collapse checks",
  "asked": "repeated",
  "files_must_contain": {
    "src/utils/biomarkers.ts": ["isExcludedDeviceMetric", "device/lifestyle metrics do not follow acute clinical laboratory bounds"],
    "src/utils/biomarkerSanitize.test.ts": [
      "does not flag sedentary/low steps as improbable clinical values",
      "lifestyle metric exemption"
    ]
  }
},
{
  "id": "job_milestone_telemetry",
  "label": "Server background jobs dispatch progress milestones for all domains (food and medical)",
  "asked": "repeated",
  "files_must_contain": {
    "serverJobs.ts": [
      "statusLower.includes('extract')",
      "statusLower.includes('classified')",
      "statusLower.includes('running agent')"
    ]
  }
}
```

## Propose skill delta (≤5 lines each, additive)
- planner: Distinguish clinical laboratory blood analytes from lifestyle/wearable metrics. Require explicit `type: 'ADVICE_ONLY' | 'PROPOSAL'` in card specs.
- builder: Always test lifestyle metrics against edge cases (low steps, zero active minutes) without triggering clinical lab alerts. Check `hasProposalChanges` before rendering mutation buttons.
- guard: If `src/utils/biomarkers.ts` or `src/server/biomarkers/**` changed, run `npx vitest run src/utils/biomarkerSanitize.test.ts src/utils/__tests__/biomarkerIdentity.test.ts`.

## Do not
- Delete standing rows
- Merge lifestyle heuristics into acute blood chemistry validators
- Allow Builder to patch on top of a dirty, failing attempt without reverting to the clean checkpoint first
