# Active Status

**Handover (WIP):** [`AI_HANDOVER.md`](../AI_HANDOVER.md)  
**Plans:** [`plan/RELIABILITY_FREE_TIER_PLAN.md`](../plan/RELIABILITY_FREE_TIER_PLAN.md)  
**Process:** [`AGENTS.md`](../AGENTS.md) · [`docs/agent/PACKS.md`](../docs/agent/PACKS.md)

## Active pack (upload this for full program)

| Pack | Role |
|------|------|
| **[M23_FULL_FREE_TIER_RELIABILITY.md](./M23_FULL_FREE_TIER_RELIABILITY.md)** | **MASTER — continuous M23→M28 until `assert-free-tier-complete.mjs` exit 0** |
| [M23_FIRESTORE_WRITE_KILL_SWITCH.md](./M23_FIRESTORE_WRITE_KILL_SWITCH.md) | Nested detail for phase M23 only |
| [M22_MEAL_BUILD_TRUE_COMPLETE.md](./M22_MEAL_BUILD_TRUE_COMPLETE.md) | Prior product pack (unrelated) |

## Master gate

```bash
node scripts/assert-free-tier-complete.mjs
npx tsc --noEmit
npx vitest run src/utils/syncUtils.regression.test.ts src/utils/firestoreUtils.test.ts
```

Expect **FAIL** until all phases implemented. Studio must loop from first FAIL → fix → re-run master.

## Phase checklist

| Phase | Assert | Focus |
|-------|--------|--------|
| M23 | `assert-free-tier-m23.mjs` | Chat + telemetry off Firestore |
| M24 | `assert-free-tier-m24.mjs` | Profile single-writer |
| M25 | `assert-free-tier-m25.mjs` | Projected pull + keyset |
| M26 | `assert-free-tier-m26.mjs` | Thin agent_jobs |
| M27 | `assert-free-tier-m27.mjs` | ID token on proxies |
| M28 | `assert-free-tier-m28.mjs` | Gemini retry |
| **DONE** | **`assert-free-tier-complete.mjs`** | All nested PASS |

## Out of scope for this COMPLETE

D1 · full server router split · Playwright · Cloudflare Pages · knip campaign
