# Food Analysis Pipeline (F-8.10)

This directory contains the sharded components of the 3,800-line `server_food_analyze_run.ts` file, splitting it into clean 400-600 line owners for better maintainability as mandated by F-8.10.

- `food_analyze_helpers.ts` (Imports, basic extraction tools)
- `food_analyze_bootstrap.ts` (SSE connection logic, SSE status patching)
- `food_analyze_router.ts` (Core flow orchestrator)
