# Q-8.6 — Tier 3 soak protocol (one live confirm)

**Not the inner loop.** Inner = named vitest (`tests/foodProcess.golden.test.ts`, `tests/bioProcess.golden.test.ts`, `tests/deskProcess.golden.test.ts`). Grok does **not** sit on the spinner.

Run **after** Q-8.2 (food) / Q-8.4 (bio) / Q-8.5 (desk) dummy rows are green.

## One surface, not both

Website live **or** API live for the same job — never both. Website subsumes API for card/poller classes.

```bash
# Stubbed card (Tier 2, not this soak):
npx playwright test prototype/tests/dialog-inventory.spec.ts

# Inner board (must already be green):
npx vitest run tests/foodProcess.golden.test.ts tests/bioProcess.golden.test.ts tests/deskProcess.golden.test.ts
npx tsx scripts/test-from-debug.ts tests/captures/job_1788538012316_m9wm9cs9a.md
```

## Food (after Q-8.2)

1. Human or a script: one website Log Meal (same Soto/matcha photos is enough). **Do not** re-upload between process-row fixes.
2. Download debug (JSON tree + markdown view).
3. Score:

```bash
npx tsx scripts/test-from-debug.ts path/to/debug-job_*.md
# or the JSON tree if exported:
npx tsx scripts/test-from-debug.ts path/to/debug-job_*.json
```

4. **If the dump FAIL class is already a Contract / process-board row, the inner loop failed.** Do not re-upload. Fix the dummy row, then one confirm.
5. If the FAIL is a **new** class: add a dummy row to the matching board, then one confirm.

Do **not** `POST /loop`. Do **not** promote Soto to G8. Do **not** run Grok Bot for 3–5 Log Meal cycles.

## Biomarker / receptionist

Same rule after 8.4 / 8.5: one Apply or one UC handoff on the website **or** API, not both. If the class is already a board row, inner failed.

## Stall/503 count (R-12)

After the JSON tree has `latency_ms` / `error` on dispatches, one line in `AI_HANDOVER.md` — hang rate from that soak dump, not a Grafana product.

```bash
# Count stall/503 lines in a capture (example):
rg -c 'Stream stalled|503|falling back to gemini-3.1' path/to/debug-job_*.md
```
