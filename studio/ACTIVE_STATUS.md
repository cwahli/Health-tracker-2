# Active Status

**Handover (WIP):** [`AI_HANDOVER.md`](../AI_HANDOVER.md)  
**Process:** [`AGENTS.md`](../AGENTS.md) · [`docs/agent/PACKS.md`](../docs/agent/PACKS.md)

**Bug-fix law (2026-08-15):** `AGENTS.md` **L14** — several independent jobs in one turn are required; `POST /loop` / meal-green search is forbidden. Copy-AI-Studio from Golden inbox now ships that contract.

## Active packs

| Pack | Role |
|------|------|
| [F9_PR1_GEMINI.md](./F9_PR1_GEMINI.md) | **Shipped.** Do not re-paste. |
| [F9_PR2_GEMINI.md](./F9_PR2_GEMINI.md) | **Shipped.** |
| [F9_PR3_GEMINI.md](./F9_PR3_GEMINI.md) | **Shipped** (`currentTurn` + LogChat increment). |
| [F9_PR4_GEMINI.md](./F9_PR4_GEMINI.md) | **Partial.** apply() on store/sync/runner. **Grok leftover:** App.tsx poller `updateJob`. |
| [BUG_CONTINUE_GEMINI.md](./BUG_CONTINUE_GEMINI.md) | Notes only. Law is **`AGENTS.md` L15**. |
| [Q64_GEMINI_COMBINED_QUEUE_UI.md](./Q64_GEMINI_COMBINED_QUEUE_UI.md) | Gemini G2 Q-6.4. Do **not** mix with F-9. |
| [M30_FOOD_RESOLVER_CURATOR_MULTIPASS.md](./M30_FOOD_RESOLVER_CURATOR_MULTIPASS.md) | Food catalog curator — separate track |
| [M22_MEAL_BUILD_TRUE_COMPLETE.md](./M22_MEAL_BUILD_TRUE_COMPLETE.md) | Prior product pack |
| **Archived** | M23 Free Tier Reliability, M31 Biomarker Lifecycle |

## F-9 — how to run Gemini (job session)

1. Paste **only section A** from `F9_PR1_GEMINI.md`. Do not ask Gemini to “investigate and propose first.”
2. After COMPLETE (named vitest + `assert-f9-pr1.mjs` exit 0), Grok reviews, then paste §A of PR2, then PR3, then PR4.
3. Do **not** mix F-8.10 or Q-6.4 into F-9.
4. `npm run build` is not how localhost picks up React. Dev must log `[boot] frontend=vite`.

**Plans**

- **Biomarker remaining:** [`plan/BIOMARKER_LIFECYCLE_PLAN.md`](../plan/BIOMARKER_LIFECYCLE_PLAN.md) §13
- Food curator: [`plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md`](../plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md)
- Agents early-stop analysis: [`plan/AISTUDIO_M30_AGENTS_COMPAT.md`](../plan/AISTUDIO_M30_AGENTS_COMPAT.md)
- Free tier: [`plan/RELIABILITY_FREE_TIER_PLAN.md`](../plan/RELIABILITY_FREE_TIER_PLAN.md)

## Continue bug fixing (any agent)

Law: **`AGENTS.md` L15**. **work bug** / **work 11** drains that card’s remaining in one turn. **next bug** = following card. Claude: Hand off. Do not type continue between lines.

## M31 — how to run AI Studio (biomarker remaining)

1. Tree must include `plan/BIOMARKER_LIFECYCLE_PLAN.md` §13 and this pack.
2. Paste **only section A** from `M31_BIOMARKER_LIFECYCLE_REMAINING_MULTIPASS.md` as the chat prompt.
3. Do **not** ask him to “investigate and propose first” — that re-enables AGENTS L11 early stop.
4. Master gate: `node scripts/assert-biomarker-lifecycle-m31.mjs` plus the vitest list in pack §F.
5. Food M30 is a **different** track. Do not mix.

## M30 — how to run AI Studio (food curator)

1. Ensure plan + pack are in the tree.
2. Paste **only section A** from `M30_FOOD_RESOLVER_CURATOR_MULTIPASS.md` as the chat prompt (includes PRE-APPROVAL + no-wait-between-phases).
3. Do **not** ask him to “investigate and propose first” — that re-enables AGENTS L11 early stop.
4. Master gate (after all phases): `node scripts/assert-food-curator-m30.mjs` (created by Studio) + vitest/tsc per pack §F.

See `plan/AISTUDIO_M30_AGENTS_COMPAT.md` for why default AGENTS.md stops early and proposed L13.

## Free-tier master gate (separate track)

```bash
node scripts/assert-free-tier-complete.mjs
npx tsc --noEmit
npx vitest run src/utils/syncUtils.regression.test.ts src/utils/firestoreUtils.test.ts
```

| Phase | Assert | Focus |
|-------|--------|--------|
| M23 | `assert-free-tier-m23.mjs` | Chat + telemetry off Firestore |
| M24 | `assert-free-tier-m24.mjs` | Profile single-writer |
| M25 | `assert-free-tier-m25.mjs` | Projected pull + keyset |
| M26 | `assert-free-tier-m26.mjs` | Thin agent_jobs |
| M27 | `assert-free-tier-m27.mjs` | ID token on proxies |
| M28 | `assert-free-tier-m28.mjs` | Gemini retry |
| **DONE** | **`assert-free-tier-complete.mjs`** | All nested PASS |

## Out of scope for free-tier COMPLETE

D1 · full server router split · Playwright · Cloudflare Pages · knip campaign
