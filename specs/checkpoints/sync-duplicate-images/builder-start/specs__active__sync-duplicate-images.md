---
id: sync-duplicate-images
status: locked
class: DISPLAY_DUP
skill: sync-jobs
edit_mode: patch
allowed_files:
  - src/utils/foodImageSources.ts
  - src/utils/foodImageSources.test.ts
  - src/utils/foodLogDedupe.ts
  - src/utils/foodLogDedupe.test.ts
  - src/components/ImageSlider.tsx
  - src/jobs/SupabaseJobSync.ts
  - src/App.tsx
frozen_files:
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - prototype/meallog/compare/scout_only_compare_instructions.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/assert-egress-bomb.mjs
  - scripts/journey-guard.mjs
gate:
  - npx tsc --noEmit
  - npx vitest run src/utils/foodImageSources.test.ts src/utils/foodLogDedupe.test.ts src/jobs/JobSession.contract.test.ts
  - node scripts/assert-egress-bomb.mjs
  - node scripts/journey-guard.mjs sync-duplicate-images
---

# Packet: sync duplicate photos + 402 delete + sanitize noise

## Journey
Manual Sync (Force Pull) must not show the same meal photo twice. Direct browser
DELETE to Supabase `agent_jobs` must not run (402 Payment Required / lockout).
BiomarkerSanitize console lines are flags, not crash errors.

## Findings (do not redo)
- Console: `[Sync] Force Pull` then `Fetching 24 missing images (cap 24; 30 deferred)` then two photos on **Tofu, Beef, and Boiled Peanuts**.
- `pickBetter` (`foodLogDedupe.ts`) concatenates winner+loser `imageUrls` + both `imageUrl`s. `Set` is exact-string only, so `/photos/x.jpg` and `https://….r2.dev/photos/x.jpg` become two slides.
- `rehydrateFoodImagesFromDonors` comment says copy onto **missing** photos; code still unions donor URLs when the target already has photos (second meal’s picture after sync).
- App.tsx Force Pull `imageMap` merge (lines ~2621–2631) and union merge (~3034–3046) do the same raw concat.
- `ImageSlider` unshifts `singleImage` if it is not `includes()`-equal **before** `normalizeMealImageUrl`.
- `DELETE … supabase.co/rest/v1/agent_jobs` 402: `deleteJobFromBackend` always calls `supabase.from('agent_jobs').delete()` and **ignores** `isDirectClientSupabaseDisabled` (standing `egress_conservation`).
- `[BiomarkerSanitize] Flagged N improbable unit-scale value(s) — not auto-rewritten` is **correct** (do not auto-convert 50 mg/dL). It is not a failure. It logs on every `setBiomarkerHistory` during sync (appears 3×). Do not rewrite SI values here.
- `/api/bug-tracker/overview` 500: D1/overview path. **Out of scope** this packet (separate ID).

Standing that applies: `egress_conservation` (402). Do not drop it.

## Plan
1. Add `uniqueMealImageUrls()` in `foodImageSources.ts` keyed by `photoKeyFromUrl` / normalized path. Done: r2 URL + `/photos/key` → one entry.
2. `pickBetter` and App.tsx image merges use it. Done: vitest, no duplicate keys.
3. `rehydrateFoodImagesFromDonors`: if the target already has a usable photo, **do not** append donor URLs. Only fill when missing. Done: existing fingerprint test still copies when missing; new test: target with photo unchanged.
4. `ImageSlider`: compare normalized URLs before unshift.
5. `deleteJobFromBackend`: skip direct Supabase delete when `isDirectClientSupabaseDisabled` (keep `/api/jobs/delete`). Done: `assert-egress-bomb` still PASS; no 402 from the client.
6. BiomarkerSanitize: log at most once per session (or `console.debug`). Do not auto-rewrite values.

## Test plan
```text
npx tsc --noEmit
npx vitest run src/utils/foodImageSources.test.ts src/utils/foodLogDedupe.test.ts src/jobs/JobSession.contract.test.ts
node scripts/assert-egress-bomb.mjs
node scripts/journey-guard.mjs sync-duplicate-images
```

## Audit plan
1. After Force Pull, one meal card: unique photo keys in `imageUrls` (no r2 + proxy pair).
2. Network: no client `DELETE` to `*.supabase.co/rest/v1/agent_jobs`.
3. Sanitize may still flag; it must not change stored numbers.
4. Diff ⊆ Allowed. Frozen clean. Compare pack untouched.

## Blast radius
Out of scope: bug-tracker 500, live Gemini, compare/log instruction packs, Apply SI conversion, JobStore, LogChat.

## Stop and come back
Two repairs fail · Frozen file in the diff · rewriting SI values to silence the sanitize log · re-enabling direct Supabase
