---
id: R-13
status: draft
class: LIVE_DEPLOY
skill: sync-jobs
edit_mode: patch
allowed_files: []
frozen_files:
  - src/App.tsx
  - src/components/LogChat.tsx
  - src/jobs/JobStore.ts
  - server_meal_gate.ts
  - AGENTS.md
  - docs/agent/standing.json
  - scripts/assert-standing.mjs
  - scripts/journey-guard.mjs
  - scripts/assert-f10-pr1.mjs
  - agents/scoutInstructions.ts
  - agents/dietitianInstructions.ts
gate:
  - npx tsc --noEmit
  - npx vitest run src/server/receptionist/handoffContract.test.ts server_derivation.test.ts server_sse_json.test.ts
  - node scripts/assert-free-tier-complete.mjs
  - node scripts/assert-spec-diff.mjs R-13
---

# R-13 — Cloudflare go-live with AI Studio parity

**Architecture:** [plan/RELIABILITY.md](../../plan/RELIABILITY.md) **§12** (canonical). Execute table: [plan/ROADMAP.md](../../plan/ROADMAP.md) Track R.

Agent fills this. Human replies: **go** | **stop** | one comment.

On **go**: lock this file (`status: locked`), answer § Open questions, then execute **one** sub-ID (`R-13.0` … `R-13.5`). Do not implement on draft. Do not start R-13.4 to unstick 13.1.

## Goal

Public Health-tracker URL on Cloudflare. `npm run dev` (`tsx server.ts`, port 3000, Vite) unchanged.

## Journey

Better = a real user can open the prod host, sign in with Google, submit a meal photo, and get a persisted D1 row + R2 image, while AI Studio and named vitest stay byte-identical. Not “Express on Pages Functions.” Not D1-as-primary (R-5). Not static-only CDN (R-2).

## Findings (do not redo)

- Live path is `/api/jobs/submit` + poll. Food-analyze SSE is internal loopback (`X-Session-ID: server-job-*`) — 403 from the browser.
- Jobs `fetch('http://127.0.0.1:${PORT}/…')` and keep in-memory Maps. Workers have neither loopback nor shared memory.
- 3-minute limit is **app** code: 180s abort, 90s stall, 5 min D1 stale fail. Worker HTTP wall-clock is unlimited; 524 is proxy-to-origin.
- `server.ts` imports `sharp` and `fs.mkdirSync` at eval — cannot be a Worker entry.
- `server_d1.ts` is REST-only. `server_auth.ts` treats `NODE_ENV !== 'production'` as localhost.
- `npm run build` emits Node `dist/server.cjs` as well as the SPA.
- Firebase Authorized Domains need exact hosts. `*.pages.dev` is invalid.
- M23–M28 free-tier core is already green. Do not re-migrate images or re-kill Firestore writes.

## In scope

- R-13.0 console/secrets/OAuth allowlist (no app code)
- R-13.1 `build:web` split, PORT default 3000, Dockerfile / Container (or Cloud Run), Workers/Pages **static** SPA, route `/api/*` to the Node process
- R-13.2 SSE `: ping` on loopback streams; timeout copy
- R-13.3 `server_auth.ts` localhost-only skip; popup fallback
- Later, **only after 13.1 live:** R-13.4 native D1/R2 bindings + in-process analyze; R-13.5 logs/cost

## Out of scope

- Importing `server.ts` / `export { app }` into `functions/api/[[route]].ts`
- Skipping `app.listen` on `CF_PAGES`
- R-5 D1 as primary SQL; R-2 static-latency-only Pages
- Food-calc, scout instructions, `App.tsx` / `LogChat` / `JobStore` job-lifecycle rewrite
- God-file split of `server.ts` (R-4)
- Track B/F/S current work
- Raising Worker CPU to 5 min in order to run Express on V8

## Invariants

- `finalizeDishLedger` is the only kcal writer (food) — do not touch
- Locked SI converts: `1.293` / `1.411` / `3.362` / `79.56` / `13.68`
- Agent schema has no `calories`
- `shouldExpandMealAgent` stays TypeScript
- `npm run dev` = `tsx server.ts`, port **3000**, Vite when `runningViaTsx`
- Production API is a **Node process** in R-13.1 (Container or Cloud Run), not a Pages Function
- One writer per entity (RELIABILITY Rule 5). Blobs stay R2
- `NODE_ENV=production` on the live process

## Prior art (do not reimplement)

- RELIABILITY.md §12 (this program)
- M23–M28 (`assert-free-tier-complete.mjs`)
- M29 job submit+poll (client already uses it)
- D1 HTTP helper `server_d1.ts` / `server_db_d1.ts`
- R2 S3 helper `server_routes_r2.ts`
- Client image compress `src/utils/imageCompressor.ts`
- Debug live-stream `: ping` every 15s in `server.ts`

## Plan

Procedural graph. Execute **one** node after lock. Each node amends `allowed_files` in this spec (or a child spec `R-13.N`) before Builder starts — this draft has `allowed_files: []` on purpose.

1. **R-13.0 Preconditions.** Workers Paid. D1 + R2 + CORS. Runtime secrets. Firebase + Google OAuth exact hosts. `NODE_ENV=production`. Done when: checklist in RELIABILITY §12.5–12.7 R-13.0 is ticked in `AI_HANDOVER.md`. No `src/` / `server.ts` diff.
2. **R-13.1 Ship.** `build:web` vs `build:server`. PORT default 3000. Loopback URLs use `127.0.0.1:${PORT}`. Dockerfile. Static SPA on Workers/Pages. `/api/*` → Container (default) or Cloud Run. SPA fallback except `/api/*`. Orange-cloud: heartbeat or grey-cloud API host. Done when: §12.9 production list + AI Studio `frontend=vite` on 3000.
3. **R-13.2 Time limits.** `: ping` on food/medical loopback SSE. Keep 180s abort. Align stale-fail copy. Done when: proxied silent 180s does not 524; vitest `server_sse_json.test.ts` still green.
4. **R-13.3 Auth.** Localhost skip = localhost/127.0.0.1 only. Redirect fallback. Preview policy. Done when: Google popup + email verify + Drive backup on prod host; unauthenticated spoofed `uid` rejected.
5. **R-13.4 Edge adapter (parked).** Native `env.DB` / `env.BUCKET`; in-process analyze; durable jobs. Done when: Worker can run analyze **without** `127.0.0.1` and without `sharp`. Do not start here.
6. **R-13.5 Observability.** Workers Logs, 1102/1027/524 alerts, static excluded from compute.

## Test plan

```text
npx tsc --noEmit
npx vitest run src/server/receptionist/handoffContract.test.ts server_derivation.test.ts server_sse_json.test.ts
node scripts/assert-free-tier-complete.mjs
node scripts/assert-spec-diff.mjs R-13
npm run dev
# must log frontend=vite and bind port 3000
```

Outer (R-13.1+, human or script, not Grok in the wait loop): RELIABILITY §12.9 production list. One meal photo, not a 10-case loop.

## Audit plan

1. Scope vs ROADMAP R-13 only — no silent F/B/S IDs, no R-5 D1 primary, no R-4 monolith rewrite
2. Rejected Pages-Functions catch-all must not appear in the diff
3. Frozen files empty-diff
4. Honest residual: preview OAuth and custom domain named if unanswered

## Blast radius

Allowed / Frozen are the YAML lists. On draft, Allowed is empty.

When locking **R-13.1**, expected Allowed (amend then): `package.json`, `server.ts` (PORT + loopback URL strings only), `wrangler.jsonc` (new), `Dockerfile` (new), `.dockerignore` (new), optional `public/_redirects`. Not `App.tsx`, `LogChat.tsx`, job store, food-calc, agent instructions.

Out of scope: `functions/api/**` that imports `server.ts`.

## Stop and come back

Two repairs fail · Frozen file in the diff · New class appears · Live Gemini requested as the inner loop · Builder starts R-13.4 before 13.1 live · `npm run dev` stops serving Vite on 3000

## Open questions (human at lock)

1. API host: **Cloudflare Containers (Recommended)** vs Cloud Run behind Cloudflare
2. Public hostname: workers.dev / pages.dev vs custom domain (OAuth needs the exact host)
3. Preview Google login: prod-only vs stable `preview.` host
