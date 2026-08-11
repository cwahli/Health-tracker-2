# Reliability & Lean Free-Tier Plan (optimized)

**Status:** Architecture / program board (not a Studio pack)  
**Updated:** 2026-08-11  
**Code truth:** Desktop working tree; ship via AI Studio packs only  
**Domain:** `docs/agent/domains/sync.md` (Class L/X when touching merge/tombstones)

---

## 1. Literature & best practice (what the industry already learned)

These are the principles behind this program — not new invention.

| Principle | Source / practice | Apply here |
|-----------|-------------------|------------|
| **Separate blob storage from relational rows** | 12-factor / cloud data modeling; “never put large objects in the row store” | Photos, debug JSON, mealBuild, scratchpads → **R2 only**; Supabase holds URLs + thin fields |
| **CQRS-lite: list projection vs detail** | API design / GraphQL field selection / mobile offline guides | History list = projected columns; expand fetches detail once |
| **Keyset (cursor) pagination over OFFSET** | Postgres + large feeds (use-the-index-luke, Supabase docs) | `WHERE (updated_at, id) < ($c_ts, $c_id) ORDER BY … LIMIT n` |
| **One writer per entity / single source of truth** | Distributed systems; dual-write is an anti-pattern without outbox | Stop dual Firestore+Supabase profile/log paths |
| **Write amplification kills free tiers** | Firestore pricing model (charged per doc write); chat-on-every-keystroke is classic failure | Kill high-frequency writers first |
| **Authn before authz (RLS is not enough alone)** | OWASP API Security; “never trust client uid” | Verify Firebase ID token on sync/job proxies; service_role only after auth |
| **Idempotent async jobs** | Queue workers (Sidekiq/Bull/Cloud Tasks patterns) | Job id stable; submit → durable status → poll; recover interrupted |
| **Retry with exponential backoff + jitter** | AWS Architecture; Google SRE | Wrap Gemini `generateContent` only — not infinite UI spins |
| **Observability before migration** | “Measure, then cut” | Instrument egress/writes before D1 or big rewrites |
| **Strangler fig over big-bang rewrite** | Fowler / industry migrations | Extract routes & kill writers incrementally; no 766KB rewrite |
| **Tombstones for multi-device delete** | CRDTs / offline-first (e.g. RxDB, Couch) | Existing law: absence ≠ delete |

### Experience-based ranking (personal-app free tiers)

1. **Quota crashes** almost always come from **write storms** (chat, telemetry, dual profile) before storage GB.  
2. **Egress bills** almost always come from **SELECT \*** + **fat JSONB** + **re-downloading history**, not from “having Postgres.”  
3. **D1 / edge SQL** is a **second migration**, not a free fix for dual-write or fat pulls.  
4. **Monolith splits** improve maintainability; they do **not** stop resource-exhausted by themselves.

---

## 2. Current-state audit (do not rebuild DONE work)

| Area | State | Evidence |
|------|--------|----------|
| Food/biomarker dual-write to Firestore | **DONE removed** | `syncUtils.syncLogsWithTimeBuckets` comment: Supabase sole store |
| Base64 images in Supabase food rows | **DONE cleaned** | R2 migrations + push interceptor; size check scripts |
| Debug / cold logs to R2 | **DONE pattern** | `debug_url`, strip helpers, cold debug |
| UI history page size 15 + lazy images | **DONE (UI only)** | `FOOD_HISTORY_PAGE_SIZE = 15` — **not** server cursor |
| Job crash recovery | **PARTIAL** | `recoverInterruptedServerJobs` |
| Profile dual-write Firestore + Supabase | **STILL LIVE** | `App.tsx` `setDoc` + `upsertProfileToSupabase` |
| Chat auto `setDoc` per save | **STILL LIVE** | `LogChat.saveConversationToFirestore` |
| API telemetry → Firestore batch | **STILL LIVE** | `ApiCallTrackerModal.handleSyncToCloud` |
| Pull `SELECT *` all logs | **STILL LIVE** | `/api/sync/supabase-pull` |
| `agent_jobs.clean_result` may embed mealBuild | **RISK** | `SupabaseJobSync.upsertJobToSupabase` |
| `server.ts` ~766KB | **REAL** | Extract on touch; not Phase-0 |

**Historical claim (~83MB / 20–30 logs)** maps to **base64 era**. Re-measure after kill-switch packs; do not re-migrate images.

---

## 3. Where the original 6-phase plan fails

| Failure mode | Why it happens | Mitigation |
|--------------|----------------|------------|
| **Stale diagnosis** | Plan targets dual-write in `firestoreUtils` / `SupabaseJobSync` | Correct targets: chat, telemetry, profile dual-write, fat pull |
| **Re-doing R2 migrations** | Agents re-upload base64 work already done | Pack §C “Already DONE” |
| **UI pagination ≠ data diet** | Slice(15) after full download still burns egress | Server projection + keyset |
| **RLS theater** | Policies present but service_role trusts client `uid` | Token verify first |
| **Big-bang router split** | Studio weak on 15k-line rewrites; merge hell | Strangler extracts |
| **D1 too early** | Rewrites Realtime/JSONB/jobs for unmeasured gain | Park until post-diet metrics fail free tier |
| **Detect without repair** | Flags quota but still writes | Kill write path |
| **Sync regression** | Full replace server list → ghost/loss | Keep mergeByRecency + tombstones |
| **Dual job paths** | Client SSE + server jobs diverge | Converge later pack; don’t mix into write kill-switch |
| **Repo fork (`-2` vs `-6`)** | Two origins, ambiguous ship target | One shipping repo; Desktop truth until push |
| **Overclaim COMPLETE** | “Infrastructure fixed” without gate | ≤6 IDs + assert exit 0 |

---

## 4. Optimized target architecture (near-term)

```text
Firebase Auth          → identity only (50k MAU class limits; no app-data writes)
Supabase Postgres      → thin rows: food_logs, biomarker_logs, profiles, agent_jobs (status only)
Cloudflare R2          → photos, debug JSON, mealBuild blobs, backend logs
Cloud Run (Express)    → AI + sync proxies + job workers (in-process → optional later split)
Local IDB              → chat transcripts, offline cache, in-flight jobs
```

**One writer per entity** (binding):

| Entity | Writer |
|--------|--------|
| Food / biomarker logs | Supabase only |
| Profile + tombstone maps + dashboard blobs | Supabase only (debounced) |
| Jobs (thin status) | Supabase via server |
| Blobs | R2 only |
| Chat | **IDB primary** (cloud optional rare export — off by default) |
| Telemetry | Local only (no free-tier DB) |

**Deferred “forever free hardcore”:** Cloudflare D1 + Pages only if **after** packs below, measured egress/writes still threaten free tiers.

---

## 5. Optimized pack program (ship order)

| Pack | Name | Goal | Class | ≤6 IDs |
|------|------|------|-------|--------|
| **M23** | Firestore write kill-switch | Stop chat + telemetry free-tier write storms; assert food/bio remain Supabase-only | L | 6 |
| **M24** | Profile single-writer | Profile/dashboard/reports/foodImages → Supabase-only; Firestore profile writes off | X | 6 |
| **M25** | Supabase payload diet | Projected SELECT + keyset pagination on pull; no full `SELECT *` history | L | 6 |
| **M26** | Thin agent_jobs | mealBuild/scratchpad off JSONB; progress flush throttle; R2 URLs only | L | 5 |
| **M27** | Authn on proxies | Firebase ID token on sync/job routes; drop trust-client-uid | X | 5 |
| **M28** | Gemini resilience | Retry/backoff wrapper; timeout → failed job; candidate cap audit | M | 4 |
| **M29** | Job path unify | Prefer server submit+poll; document/disable dead SSE path | L | later |
| **M30** | Optional CDN / D1 study | Pages for static; D1 only if metrics demand | — | research |

**Do not** open M24–M26 until M23 gate green.  
**Do not** open M27 until M24 green (auth on dual-write is worse than auth on single writer).

---

## 6. Success metrics (measure each pack)

| Metric | Before (re-baseline) | After M23–M26 target |
|--------|----------------------|----------------------|
| Firestore writes / active day | Often hits 20k | **≪ 1k** (ideally ~0 app-data writes) |
| Supabase egress / day | Spike risk | Dominated by intentional image CDN (R2), not JSON dumps |
| Login pull payload | Full `SELECT *` | Projected page ≤ N rows |
| `resource-exhausted` incidents | Daily risk | None under normal personal use |
| Food/bio multi-device | Must stay correct | merge + tombstone soak |

---

## 7. Explicit non-goals (this program)

- Rewriting nutrient math / food-calc pipeline  
- Temporal/LangGraph  
- Full `server.ts` Controller-Service rewrite  
- knip-only dead code as a milestone  
- E2E Playwright before M25  
- Migrating primary DB to D1 in M23–M28  

---

## 8. Studio ship path

### Preferred: one continuous master pack

```text
plan/RELIABILITY_FREE_TIER_PLAN.md
  → studio/M23_FULL_FREE_TIER_RELIABILITY.md   ← upload THIS for full program
  → Studio iterates M23→M28 until:
       node scripts/assert-free-tier-complete.mjs  exit 0
  → tsc + sync vitest
  → AI Studio commit/push
  → archive + AI_HANDOVER update
```

### Optional: single-phase only

```text
studio/M23_FIRESTORE_WRITE_KILL_SWITCH.md  → m23 gate only (not full program)
```

Local Grok/Claude/Cursor: prepare only; **no git push**.

### After master COMPLETE — still optional later

| Item | When |
|------|------|
| Cloudflare Pages CDN | Global static latency matters |
| Playwright E2E | After soak of M23–M28 |
| server.ts router extract | On touch / maintainability |
| D1 investigation | Only if measured free-tier still fails |
