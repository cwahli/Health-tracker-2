# Active Status

**Handover (WIP):** [`AI_HANDOVER.md`](../AI_HANDOVER.md)  
**Plans (architecture):** [`plan/`](../plan/) — include [`RELIABILITY_FREE_TIER_PLAN.md`](../plan/RELIABILITY_FREE_TIER_PLAN.md)  
**Process:** [`AGENTS.md`](../AGENTS.md) · [`docs/agent/`](../docs/agent/) · packs [`docs/agent/PACKS.md`](../docs/agent/PACKS.md)

## Git note

Do **not** assume 100% parity without `git fetch` + audit. Prefer **one shipping origin**; reconcile `Health-tracker-2` vs `Health-tracker-6` with the human before push.

## Active pack

| Pack | Role |
|------|------|
| **[M23_FIRESTORE_WRITE_KILL_SWITCH.md](./M23_FIRESTORE_WRITE_KILL_SWITCH.md)** | **ACTIVE** — free-tier Firestore write kill-switch (chat + telemetry) |
| [M22_MEAL_BUILD_TRUE_COMPLETE.md](./M22_MEAL_BUILD_TRUE_COMPLETE.md) | Prior meal-build pack (archive after M23 ship if already green on origin) |
| [M21_1_MEAL_BUILD_COMPLETION_GATES.md](./M21_1_MEAL_BUILD_COMPLETION_GATES.md) | Nested prior |

## M23 gates (run before claiming M23 DONE)

```bash
node scripts/assert-free-tier-m23.mjs
npx tsc --noEmit
npx vitest run src/utils/syncUtils.regression.test.ts src/utils/firestoreUtils.test.ts
```

## Program board (reliability)

| Pack | Focus | Status |
|------|--------|--------|
| M23 | Chat + telemetry off Firestore | **ACTIVE** |
| M24 | Profile single-writer (Supabase only) | Next |
| M25 | Projected pull + keyset pagination | Queued |
| M26 | Thin agent_jobs / R2 blobs | Queued |
| M27 | Firebase ID token on proxies | Queued |
| M28 | Gemini retry/backoff | Queued |

See `plan/RELIABILITY_FREE_TIER_PLAN.md`.

## Feature board (high level)

See `AI_HANDOVER.md` § initiatives. Product tracks (modal, food-calc, K, images) were largely green on Desktop; **re-verify after merge**.
