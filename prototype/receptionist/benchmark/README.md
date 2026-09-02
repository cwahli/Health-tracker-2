# Receptionist & Onboarding Benchmark Suite

This directory contains gold benchmark test cases for the Receptionist and Onboarding AI agent:

- **[C1.json](./C1.json)**: Case 1 — New User Weight Loss Onboarding (`"I want to loose weight"`). Evaluates intent detection (`weight_loss`), calorie deficit requirement logic, missing info identification (`gender`, `age`, `height`, `weight`, `activity_level`, `medical_history`), memory initialization, and polite follow-up.
- **[C2.json](./C2.json)**: Case 2 — New User General Wellness (`"i just want to be healthy"`). Evaluates open-ended health goal interpretation, missing baseline discovery (focus pillars, lifestyle, demographics), memory initialization, and follow-up.
- **[C3.json](./C3.json)**: Case 3 — Existing User Health Optimization (`"What can be improved for my health?"`). Evaluates inspection of existing complete profile, detection of uncompleted / overdue tasks (overdue biomarker blood panel, irregular meal logging streak), memory consolidation, and construction of actionable handoff payload for the Coach agent.

## Benchmark Execution

Run dry-run comparison:
```bash
npx tsx prototype/receptionist/runner.ts --dry
```

Run live with Gemini Flash-Lite:
```bash
npx tsx prototype/receptionist/runner.ts --case C1
```
