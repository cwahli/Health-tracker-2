# FULL PROGRAM — Free-tier reliability COMPLETE (continuous Studio pack)

**Status:** **ACTIVE MASTER** — upload **this one file** (+ plan) for AI Studio to iterate until done  
**Who commits/pushes:** **AI Studio only** (after **master gate exit 0**)  
**Architecture:** `plan/RELIABILITY_FREE_TIER_PLAN.md`  
**Domain:** `docs/agent/domains/sync.md` (merge/tombstones **must not break**)  
**Nested gates:** `scripts/assert-free-tier-m23.mjs` … `m28.mjs`  
**Master gate:** `scripts/assert-free-tier-complete.mjs`  

---

## 0. Answer: Is there more after M23_kill_switch?

**Yes.** M23 alone stops chat + telemetry write storms. The full reliability core is:

| Phase | Name | Stops / delivers |
|-------|------|------------------|
| **M23** | Write kill-switch | Chat + API telemetry off Firestore |
| **M24** | Profile single-writer | Profile/dashboard/foodImages off Firestore dual-write |
| **M25** | Payload diet | Projected pull + keyset pagination (egress) |
| **M26** | Thin agent_jobs | Fat mealBuild out of JSONB; slower progress writes |
| **M27** | Proxy authn | Firebase ID token on sync/job writes |
| **M28** | Gemini retry | Backoff wrapper for rate limits / flakes |

**Explicitly NOT in this COMPLETE** (do not implement in this pack):

- Cloudflare D1 migration  
- Full `server.ts` → routers rewrite  
- Playwright/Cypress E2E  
- Cloudflare Pages CDN  
- knip dead-code campaign  
- Re-migrating R2 images (already done)

Those are optional later work after master gate green.

---

## A. User prompt (copy-paste to AI Studio — continuous)

```text
You are AI Studio implementing the FULL free-tier reliability program.
Follow studio/M23_FULL_FREE_TIER_RELIABILITY.md ONLY.
Architecture: plan/RELIABILITY_FREE_TIER_PLAN.md
Domain laws: docs/agent/domains/sync.md — never treat server absence as delete; keep mergeByRecency + tombstones.

CONTINUOUS MODE (binding):
1. Implement phases in order: M23 → M24 → M25 → M26 → M27 → M28.
2. After EACH phase, run that phase assert. If FAIL, fix that phase before next.
3. Do NOT stop after M23 and claim done. Do NOT skip phases.
4. When all phases green, run master gate:
     node scripts/assert-free-tier-complete.mjs
5. Also: npx tsc --noEmit
   And: npx vitest run src/utils/syncUtils.regression.test.ts src/utils/firestoreUtils.test.ts
6. COMPLETE only if master gate exit 0 AND tsc 0 AND named vitest 0.
7. Commit/push ONLY after master gate exit 0.

Preflight now:
  node scripts/assert-free-tier-complete.mjs
Expect FAIL until all phases implemented. First FAIL = start there.

Forbidden until master exit 0:
  "all done", "fully verified", "nothing left", "firestore fixed", "reliability complete"

Do not rebuild DONE work in §C.
Do not open D1 / full server split / Playwright.
If scope grows beyond this pack: stop, note INCOMPLETE, do not invent Phase 7.
```

---

## B. Anti-miss (binding for entire program)

1. **Partial COMPLETE = FAIL.** Master gate must exit 0. Phase assert alone is not enough.  
2. **Import without call site = FAIL.**  
3. **Do not re-add Firestore food/biomarker dual-write.**  
4. **Do not full-replace local logs with server list** (`setFoodLogs(serverOnly)` without merge).  
5. **Do not re-migrate R2 images** or remove base64→R2 interceptor.  
6. **Do not weaken any assert-free-tier-*.mjs.**  
7. Prefer small helpers + FIND→REPLACE over rewriting `App.tsx` / `server.ts` wholesale.  
8. On overclaim mid-flight: mark INCOMPLETE, continue from **first FAIL** phase.  
9. Known product tradeoff M23: chat is **device-local** (IDB). Multi-device chat is out of scope.  
10. M24 must keep **tombstone maps** (`deletedFoodLogIds`, etc.) flowing through **Supabase profile** path.

---

## C. Already DONE (do not rebuild)

| Done | Keep |
|------|------|
| Food/biomarker Supabase-only push | `syncUtils` comment + no setDoc in `syncLogsWithTimeBuckets` |
| R2 photos + push interceptor | `uploadBase64ToR2` on supabase-push |
| Debug/cold logs to R2 | debug_url patterns |
| UI page 15 + lazy images | B13 — server pagination still required in M25 |
| Job recovery stub | `recoverInterruptedServerJobs` — do not delete |
| Meal build / food-calc | Out of scope except stripping fat blobs in M26 |
| M23 pack detail | Nested file `studio/M23_FIRESTORE_WRITE_KILL_SWITCH.md` — same R1–R5 rules apply |

---

## D. Continuous loop (how Studio iterates alone)

```text
loop:
  run: node scripts/assert-free-tier-complete.mjs
  if exit 0 → go FINAL (tsc + vitest + STATUS + commit)
  else:
    identify first FAIL phase (M23..M28)
    implement that phase only (this pack §E)
    run phase assert until PASS
    re-run master gate
    repeat
```

**Do not** implement M25 while M23 still FAIL.  
**Do not** commit mid-loop unless human asks; default = one commit after master PASS.

---

## E. Phase implementations

---

### PHASE M23 — Firestore write kill-switch (chat + telemetry)

**Detail pack (same rules):** `studio/M23_FIRESTORE_WRITE_KILL_SWITCH.md`  
**Gate:** `node scripts/assert-free-tier-m23.mjs`  
**Files:** `src/components/LogChat.tsx`, `src/components/ApiCallTrackerModal.tsx`

#### M23.1 Chat — no auto Firestore write

In `saveConversationToFirestore` (or rename to `saveConversationLocal`):

1. Keep IDB `safeIdbSet` for full messages.  
2. Maintain local index: `chat_index_${userId}_${type}_${agentType||'none'}`.  
3. **Remove** `await setDoc(docRef, sanitizeForFirestore(prunedObject), …)`.  
4. Log: `console.log('[FreeTier] chat cloud write disabled');`  
5. Remove `trackApiCall('firebase_write', ... Save Chat Session ...)`.

#### M23.2 Chat load — local-first

- List from local index + IDB first.  
- Optional one-shot Firestore migration only if `chat_migrated_v1_${uid}` unset; never write back.  
- Prefer no hot-path `getDocs` every open.

#### M23.3 Telemetry — no api_events batch

In `ApiCallTrackerModal.handleSyncToCloud`:

```ts
console.log('[FreeTier] telemetry cloud write disabled');
// mark events synced locally only; no writeBatch(db)
```

Remove `writeBatch` → `api_events`. UI label: “Mark synced (local)” or disable cloud wording.

**Markers required:**  
`[FreeTier] chat cloud write disabled` · `[FreeTier] telemetry cloud write disabled`

---

### PHASE M24 — Profile single-writer (Supabase only)

**Gate:** `node scripts/assert-free-tier-m24.mjs`  
**Files:** `src/App.tsx` (cloud save / sync function — search `profileForCloud`, `upsertProfileToSupabase`, `setDoc(doc(db, 'users', uid)`), keep `src/utils/syncUtils.ts` upsert  

#### M24 rules

1. **Primary cloud write for profile** = `upsertProfileToSupabase(profileForCloud, uid, { actions, dailyBenefits, report, email })` only.  
2. **Disable** full profile `setDoc(doc(db, 'users', uid), sanitizeForFirestore(profileForCloud)…)` on automatic and specific-update paths.  
3. **Disable** routine writes to:
   - `users/{uid}/metadata/dashboard`
   - `users/{uid}/reports/latest`
   - `users/{uid}/foodImages/{id}`  
   Prefer store dashboard/actions/benefits/report **inside Supabase profile payload** (already supported by push handler extras).  
4. Log once per save path:  
   `console.log('[FreeTier] profile single-writer');`  
   and/or  
   `console.log('[FreeTier] profile firestore write disabled');`  
5. **Reads:** keep Firestore profile **read fallback** only if Supabase empty (temporary), or skip if pull already returns profile — do not break login.  
6. **Tombstones must still sync** via Supabase profile fields (`deletedFoodLogIds`, etc.).  
7. Optional: `setDoc` for `agentAnalyses` subcollection — disable or move into profile blob; prefer disable with local+Supabase.  
8. Marker for foodImages if any residual path: `[FreeTier] foodImages firestore write disabled`

#### M24 FIND pattern (illustrative)

Whenever you see:

```ts
setDoc(doc(db, 'users', uid), sanitizeForFirestore(profileForCloud), { merge: true })
```

Replace with:

```ts
console.log('[FreeTier] profile firestore write disabled');
// Supabase is sole profile writer
upsertProfileToSupabase(profileForCloud, uid, {
  actions: currActions,
  dailyBenefits: currBenefits,
  report: currReport,
  email: updatedProfile?.email || profile?.email || auth.currentUser?.email
});
```

Remove **duplicate** upsert+setDoc pairs — **one** upsert call.

**Risk if wrong:** multi-device profile/tombstones break. After M24, manually smoke: delete a food log on device A → still tombstoned on B after pull.

---

### PHASE M25 — Supabase payload diet (projection + keyset)

**Gate:** `node scripts/assert-free-tier-m25.mjs`  
**Files:** `server.ts` (`/api/sync/supabase-pull`), `src/utils/syncUtils.ts` (`fetchAllConsolidatedLogs`)

#### M25.1 List projection

Default pull for history list must **not** dump unbounded fat JSON when a lighter mode works.

Define list columns (adjust to real schema):

```ts
const FOOD_LIST_SELECT =
  'id, firebase_uid, date, name, composition, weight_grams, quantity, consumed_amount, recommendation, calories, saturated_fat, sodium, added_sugar, image_urls, updated_at';
// Exclude or lazy-load: full nutrients blob, items_breakdown, scout_items when listOnly=true
const BIO_LIST_SELECT =
  'id, firebase_uid, date, note, summary, updated_at'; // biomarkers map may stay if small; avoid SELECT * if possible
```

Body flags:

```ts
// req.body
listOnly?: boolean;      // default true for initial pull
pageSize?: number;       // default 50, max 100
cursor?: { updated_at: string; id: string } | null;
includeDetailIds?: string[]; // optional expand
```

Log: `console.log('[FreeTier] projected food pull');`  
Log: `console.log('[FreeTier] keyset pagination');`

#### M25.2 Keyset pagination

```ts
let foodQuery = supabaseAdmin
  .from('food_logs')
  .select(listOnly ? FOOD_LIST_SELECT : '*')
  .in('firebase_uid', possibleUids)
  .order('updated_at', { ascending: false })
  .order('id', { ascending: false })
  .limit(Math.min(pageSize || 50, 100));

if (cursor?.updated_at && cursor?.id) {
  // keyset: rows strictly older than cursor
  foodQuery = foodQuery.or(
    `updated_at.lt.${cursor.updated_at},and(updated_at.eq.${cursor.updated_at},id.lt.${cursor.id})`
  );
  // If PostgREST or() is painful, use RPC or simplified: .lt('updated_at', cursor.updated_at)
}
```

Return:

```ts
res.json({
  success: true,
  foods,
  biomarkers,
  profileData,
  nextCursor: foods.length ? { updated_at: foods[foods.length-1].updated_at, id: foods[foods.length-1].id } : null,
  meta: { ... }
});
```

#### M25.3 Client

`fetchAllConsolidatedLogs` / pull callers:

- Pass `listOnly: true`, `pageSize: 50`.  
- Keep `lastSyncTime` incremental when available.  
- If UI needs full `items_breakdown` for one card, fetch detail by id later (optional thin endpoint or `listOnly:false` + id filter) — **not** full history dump every login.  
- **Merge** pages with `mergeByRecency` — never replace entire local state with one page.

#### M25.4 Keep

- Base64 interceptor on push.  
- Firebase fallback only when Supabase returns empty (existing).

---

### PHASE M26 — Thin agent_jobs

**Gate:** `node scripts/assert-free-tier-m26.mjs`  
**Files:** `src/jobs/SupabaseJobSync.ts`, `serverJobs.ts`, optionally `server.ts` job upsert

#### M26.1 Strip fat from clean_result before DB

When upserting jobs:

```ts
console.log('[FreeTier] thin clean_result');
// Remove or R2-offload:
// - mealBuild full object → mealBuildUrl / debug_url already
// - dietitianScratchpad, scoutScratchpad, backendLogs text
// - base64 images
const thin = {
  ...cleanResult,
  mealBuild: undefined,
  mealBuildUrl: cleanResult?.mealBuildUrl || existingUrl,
  // keep: pendingFoodLog summary fields, status flags, photoUrl, comparisonSet ids only if small
};
```

Prefer existing R2 debug upload path; store URL only in `debug_url` / `clean_result.is_r2` pattern already used in serverJobs.

#### M26.2 Progress throttle

In `serverJobs.ts` change:

```ts
const progressThrottleMs = 5000; // was 1500 — free-tier + realtime diet
```

Prefer status transitions (queued → running → awaiting_user → succeeded) always flush; intermediate % throttled.

#### M26.3 Client JobQueueRunner

Do not re-upsert full mealBuild into Supabase on every tick. Upsert thin status; attach mealBuild in memory / IDB.

---

### PHASE M27 — Firebase ID token on write proxies

**Gate:** `node scripts/assert-free-tier-m27.mjs`  
**Files:** new `server_auth.ts` (preferred extract) or helpers in `server.ts`; clients `syncUtils.ts`, `SupabaseJobSync.ts`

#### M27.1 Server helper

```ts
// server_auth.ts
import { getAuth } from 'firebase-admin/auth';

export async function verifyFirebaseIdToken(req): Promise<{ uid: string; email?: string }> {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) {
    const err: any = new Error('Missing Authorization Bearer token');
    err.status = 401;
    throw err;
  }
  const decoded = await getAuth().verifyIdToken(token);
  console.log('[FreeTier] requireAuth');
  return { uid: decoded.uid, email: decoded.email };
}
```

#### M27.2 Protect at minimum

- `POST /api/sync/supabase-push`  
- `POST /api/jobs/upsert`  
- `POST /api/jobs/delete`  

Optional same-session: supabase-pull (recommended).

**UID rule:** after verify, set `canonicalUid` from **token uid** (plus existing admin alias map if required for this product). **Do not** trust body.uid alone for writes. Body.uid may match token for multi-account alias — if alias needed, only allow known alias map for the verified email.

Log: `[FreeTier] requireAuth supabase-push` near handler (or shared requireAuth log).

#### M27.3 Client

```ts
const token = await auth.currentUser?.getIdToken();
headers: {
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {})
}
```

On all supabase-push and jobs upsert/delete fetches.

**Dev note:** if local anonymous mode exists, allow bypass only when `process.env.ALLOW_UNAUTH_SYNC === '1'` — document; production default deny.

---

### PHASE M28 — Gemini retry / backoff

**Gate:** `node scripts/assert-free-tier-m28.mjs`  
**Files:** new `server_gemini_retry.ts`; wire in `server.ts` (and any hot `generateContent` paths)

```ts
// server_gemini_retry.ts
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  opts?: { retries?: number; baseMs?: number; label?: string }
): Promise<T> {
  const retries = opts?.retries ?? 3;
  const baseMs = opts?.baseMs ?? 500;
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) console.log('[FreeTier] gemini retry', attempt, opts?.label || '');
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      const retriable = /429|5\d\d|resource.exhausted|unavailable|timeout|ECONNRESET/i.test(msg);
      if (!retriable || attempt === retries) throw e;
      const delay = baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
```

Wrap **at least 2** production `generateContent` call sites used by food pipeline (or the shared helper all paths use).  
Do not infinite-retry; surface failed job status after exhaustion.

Optional unit test: pure backoff counter — nice but not required if gate + tsc pass.

---

## F. Machine gates (order)

```bash
# After each phase:
node scripts/assert-free-tier-m23.mjs
node scripts/assert-free-tier-m24.mjs
node scripts/assert-free-tier-m25.mjs
node scripts/assert-free-tier-m26.mjs
node scripts/assert-free-tier-m27.mjs
node scripts/assert-free-tier-m28.mjs

# Master (required for COMPLETE):
node scripts/assert-free-tier-complete.mjs

# Always before COMPLETE:
npx tsc --noEmit
npx vitest run src/utils/syncUtils.regression.test.ts src/utils/firestoreUtils.test.ts
```

Optional extra if food path touched:

```bash
npx vitest run src/utils/foodLogDedupe.test.ts
```

---

## G. Master STATUS table

| Phase | Requirement | Assert | PASS/FAIL |
|-------|-------------|--------|-----------|
| M23 | Chat + telemetry no Firestore spam | m23 | |
| M24 | Profile single-writer Supabase | m24 | |
| M25 | Projected pull + pagination | m25 | |
| M26 | Thin jobs + progress ≥5s | m26 | |
| M27 | ID token on push/job writes | m27 | |
| M28 | Gemini retry helper + call site | m28 | |
| MASTER | complete.mjs exit 0 | complete | |
| REG | tsc + sync vitest | — | |

---

## H. IMPACT (whole program)

```text
IMPACT
class: X
goal: Free-tier reliability core — stop Firestore write storms, cut Supabase egress, thin jobs, auth write proxies, LLM retry — without D1 or monolith rewrite.
files: LogChat.tsx, ApiCallTrackerModal.tsx, App.tsx, syncUtils.ts, SupabaseJobSync.ts, serverJobs.ts, server.ts, server_auth.ts (new), server_gemini_retry.ts (new), scripts/assert-free-tier-*.mjs
paths: chat | telemetry | profile sync | food/bio pull | jobs | gemini
fields/contracts: tombstones, mergeByRecency, food/bio ids, R2 URLs
domain docs read: sync, RELIABILITY_FREE_TIER_PLAN
out of scope: D1, full router split, Playwright, Pages CDN, food-calc math, re-R2 migration
risk if wrong: multi-device data loss, 401 lockout on sync, empty history, orphan jobs
plan: continuous M23→M28 until master gate 0
```

---

## I. SELF-CHECK (before master COMPLETE)

```text
SELF-CHECK
- [ ] Every phase assert PASS
- [ ] Master assert PASS
- [ ] tsc 0
- [ ] syncUtils.regression + firestoreUtils vitest 0
- [ ] No new setFoodLogs(serverOnly) without merge
- [ ] Tombstones still on Supabase profile path
- [ ] Base64→R2 interceptor still present
- [ ] No assert scripts weakened
- [ ] Chat IDB still works after reload
- [ ] Food log create → appears after pull (smoke if possible)
```

---

## J. GATE LOG template

```text
GATE LOG
m23:      exit ?
m24:      exit ?
m25:      exit ?
m26:      exit ?
m27:      exit ?
m28:      exit ?
master:   exit ?   (assert-free-tier-complete.mjs)
tsc:      exit ?
vitest:   exit ?   (syncUtils.regression + firestoreUtils)
notes:    D1/Pages/E2E/server-split explicitly out of scope
```

---

## K. COMPLETE policy

```text
COMPLETE only if:
  1. Master STATUS all PASS
  2. assert-free-tier-complete.mjs exit 0
  3. tsc exit 0
  4. named vitest exit 0
  5. SELF-CHECK all boxes

Forbidden phrases until then:
  all done · fully verified · nothing left · reliability complete · free tier fixed forever

M23-only green ≠ COMPLETE for this pack.
Import without call site = FAIL
Weakened gate = FAIL
```

---

## L. After master PASS (Studio)

1. Commit + push (AI Studio only) to the **human-chosen shipping repo**.  
2. Archive this pack + M23 detail pack → `archive/studio/completed-2026-08/`.  
3. Update `AI_HANDOVER.md`: free-tier core M23–M28 DONE; remaining optional = D1 study / Pages / E2E / server extract.  
4. Update `studio/ACTIVE_STATUS.md` → no active pack or next optional.

---

## M. Human upload checklist (one go)

Upload / ensure tree has:

- [ ] `studio/M23_FULL_FREE_TIER_RELIABILITY.md` **(this file — primary)**  
- [ ] `studio/M23_FIRESTORE_WRITE_KILL_SWITCH.md` (detail for M23)  
- [ ] `plan/RELIABILITY_FREE_TIER_PLAN.md`  
- [ ] `scripts/assert-free-tier-m23.mjs` … `m28.mjs`  
- [ ] `scripts/assert-free-tier-complete.mjs`  
- [ ] Current app sources (`LogChat`, `App`, `syncUtils`, `server.ts`, jobs, …)

Paste **§A user prompt**. Tell Studio: **continuous until master gate 0**.

---

## N. Honesty about “iterate by himself”

| Works well | Needs human if stuck |
|------------|----------------------|
| Kill switches, strip writes, throttle, retry helper | Auth breaks local demo / alias UID map |
| Projection + simple `.limit` + `.lt` cursor | Exotic PostgREST keyset `or()` syntax |
| Markers + assert-driven loop | Multi-device soak surprises |
| Nested gates prevent early overclaim | Product choice: chat multi-device later |

If Studio fails M25 keyset syntax: allow simplified cursor = `updated_at.lt` only and document in GATE LOG — still require `limit` + projection.

If Studio fails M27 on admin multi-UID: keep alias map **after** verifyIdToken(email/uid), never before.

---

## O. Success definition (product)

After COMPLETE, under normal personal use:

1. Firestore free tier should **not** hit 20k writes/day from chat/telemetry/profile spam.  
2. Supabase pull should transfer **pages of thin rows**, not full fat history every time.  
3. Jobs rows stay small; heavy debug on R2.  
4. Write APIs require real auth token.  
5. LLM flakes retry a few times instead of instant orphan failures.  
6. Food/biomarker multi-device merge laws still hold.

Not guaranteed by this pack alone: zero bugs forever, zero Gemini cost, multi-device chat.
