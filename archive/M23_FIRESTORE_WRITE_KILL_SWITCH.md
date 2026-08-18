# M23 — Free-tier Firestore write kill-switch

**Status:** ACTIVE — first pack of `plan/RELIABILITY_FREE_TIER_PLAN.md`  
**Who commits/pushes:** **AI Studio only**  
**Class:** L (multi-file; no tombstone contract change)  
**Depends on:** Existing IDB chat save path already present in `LogChat.tsx`; food/biomarker Supabase-only already in `syncUtils.ts`  
**Do not:** migrate R2 images again · rewrite sync merge · touch food-calc · open M24 profile dual-write · D1 · big `server.ts` split  

**Goal:** Permanently stop the two highest-frequency Firestore write storms that burn the free-tier 20k writes/day and trigger `resource-exhausted`:

1. **Chat session auto-save** (`LogChat` → `users/{uid}/conversations/{id}` on every message)  
2. **API call telemetry cloud sync** (`ApiCallTrackerModal` → `api_events` batch)

Also **assert** (do not re-implement) that food/biomarker log push does **not** write Firestore.

**Product decision (binding):** Chat history is **device-local (IndexedDB primary)**. Durable multi-device product data remains **food logs + biomarker logs + profile** (profile still dual-written until M24). Users keep chat across reloads on the same browser; cross-device chat history is **explicitly out of scope** for M23 (known product tradeoff documented in STATUS).

---

## A. User prompt (copy-paste to AI Studio)

```text
Follow studio/M23_FIRESTORE_WRITE_KILL_SWITCH.md only.
Architecture: plan/RELIABILITY_FREE_TIER_PLAN.md.
Domain: docs/agent/domains/sync.md (do not change merge/tombstone laws).

You are AI Studio. Commit/push ONLY after master gate exit 0.

M23 kills free-tier Firestore write storms:
R1 Chat: never auto setDoc/updateDoc conversations to Firestore; IDB+local index only
R2 Chat load: prefer IDB/local conversation list; Firestore list is optional one-shot migration only (or skip entirely)
R3 ApiCallTracker: handleSyncToCloud must NOT writeBatch to Firestore; local-only
R4 Marker logs for kill-switch paths
R5 Food/biomarker remain Supabase-only (assert existing comment + no new Firestore log writes)
R6 Gate + unit tests green; sync regression still green

Preflight: node scripts/assert-free-tier-m23.mjs — expect FAIL before fixes, PASS after.
Also run: npx tsc --noEmit
Also run: npx vitest run src/utils/syncUtils.regression.test.ts src/utils/firestoreUtils.test.ts
Paste GATE LOG. Do not weaken asserts.
Forbidden until exit 0: "all done", "fully verified", "firestore fixed", "nothing left".
```

---

## B. Anti-miss (binding)

1. **Dead flag = FAIL** — setting `localStorage auto_sync_disabled` alone without removing the `setDoc` path is FAIL. Production path must not call `setDoc` for conversations on normal save.  
2. Import without call site = FAIL.  
3. **Do not** break guest IDB save or logged-in IDB save (already exists).  
4. **Do not** change `mergeByRecency` / tombstones / food push to Firestore “for cleanup.”  
5. **Do not** weaken `assert-free-tier-m23.mjs`.  
6. Telemetry “Sync to cloud” button must either be removed/disabled with honest UI, or succeed as **local mark-synced** without network/Firestore.  
7. If multi-device chat is requested later: new pack (Supabase thin sessions or R2) — **not** silent re-enable of Firestore spam.  
8. COMPLETE only if §G every row PASS + §F exit 0.

---

## C. Already DONE (do not rebuild)

| Done | Notes |
|------|--------|
| Food/biomarker Supabase-only push | `syncUtils.ts` — keep comment; do not re-add Firestore backup |
| R2 photo migration + push interceptor | Keep |
| Debug payload to R2 / strip base64 | Keep |
| UI page size 15 + lazy images | Keep (server pagination = M25) |
| `sanitizeForFirestore` / quota flag helpers | Keep; still used if any residual reads |
| IDB save for chat messages | Already in `saveConversationToFirestore` before cloud write — **keep and promote** |

---

## D. Mode / path matrix

| Behavior | Food Mode A | Food Mode D | Medical chat | Guest chat |
|----------|:-----------:|:-----------:|:------------:|:----------:|
| Chat persist no Firestore write | N/A or via LogChat | N/A or via LogChat | **PASS required** | **PASS (IDB only)** |
| Telemetry no Firestore | N/A | N/A | N/A | N/A (global UI) |
| Food log sync still Supabase | PASS | PASS | N/A | N/A |

Food modes need no new food-calc wiring — only that M23 does not regress sync.

---

## E. Implementation (exact)

### R1 — Chat save: kill Firestore auto-write

**File:** `src/components/LogChat.tsx`

**Function:** `saveConversationToFirestore` (keep name for call-site stability OR rename to `saveConversationLocal` and update all call sites in same task).

**Required behavior after change:**

1. Always save full messages to IndexedDB (existing block with `safeIdbSet(\`${chatStorageKey}_${userId}_${id}\`, msgs)` — keep).  
2. Maintain a **local conversation index** in localStorage/IDB so the sidebar can list sessions without Firestore (see R2).  
3. **Do not** execute:

```ts
await setDoc(docRef, sanitizeForFirestore(prunedObject), { merge: true });
```

on the normal save path.

4. Prefer **delete** the entire progressive 650KB pruning → `setDoc` block, **or** guard permanently:

```ts
// M23 free-tier kill-switch: chat is device-local only (IDB).
// Cross-device chat is out of scope until a dedicated non-Firestore design.
const CLOUD_CHAT_DISABLED = true;
if (CLOUD_CHAT_DISABLED) {
  console.log('[FreeTier] chat cloud write disabled');
  // update local index (R2) then return
  return;
}
```

**Gate requires** string: `[FreeTier] chat cloud write disabled` present in `LogChat.tsx` **and** production call that logs it (or at least the constant path is live before any setDoc).

**Stronger (preferred):** remove `setDoc` for conversations entirely from this function so grep finds **zero** `setDoc` under conversation save.

Also update any `trackApiCall('firebase_write', ... Save Chat Session` on that path — either remove or change to a non-firebase local track type if you only have existing types; simplest: **delete** that trackApiCall on the disabled path so write counts drop.

### R2 — Chat load / list: local-first

**File:** `src/components/LogChat.tsx`  
**Functions:** `loadConversationsFromFirestore` and any sidebar list loader.

**Required:**

1. Build/list conversations from **local index + IDB keys** first.  
2. Suggested local index key: `chat_index_${userId}_${type}_${agentType||'none'}` → JSON array of `{ id, title, updatedAt, type, agentType }` updated on every save (R1).  
3. Firestore `getDocs` conversation query:  
   - **Option A (preferred):** do not call on open.  
   - **Option B:** one-time migration if `localStorage.chat_migrated_v1_${uid}` unset — pull up to 30 sessions into IDB, set flag, never write back.  
4. Must not fail open with empty chat if IDB has data (load IDB message body as today).

**Gate requires:** either no `getDocs` for conversations on open, or a clear migration flag pattern `chat_migrated_v1` in source.

**Delete conversation:** local index + IDB delete; Firestore `deleteDoc` optional only if migration Option B left orphans — prefer local-only delete with log:

```ts
console.log('[FreeTier] chat local delete');
```

### R3 — ApiCallTracker: no Firestore batch

**File:** `src/components/ApiCallTrackerModal.tsx`  
**Function:** `handleSyncToCloud`

**Replace** the `writeBatch` / `batch.commit()` path with local-only:

```ts
// M23: telemetry stays local — free-tier kill-switch (no api_events Firestore writes)
console.log('[FreeTier] telemetry cloud write disabled');
const updatedEvents = events.map(e => ({ ...e, syncStatus: 'synced' as const }));
localStorage.setItem('local_api_events', JSON.stringify(updatedEvents));
setEvents(updatedEvents);
setSyncStatusMsg('success'); // or a clearer 'local_only' if UI supports it
// Optional UI copy: "Saved on this device only"
```

Remove unused imports (`writeBatch`, `collection`, `doc` from firestore) if no longer used in file.

**UI honesty:** If button still says “Sync to cloud”, change label to **“Mark synced (local)”** or disable with tooltip “Cloud telemetry disabled (free tier)”. Gate checks for log marker and absence of `writeBatch` commit to `api_events` in this file.

### R4 — Markers (required strings)

| Marker | File |
|--------|------|
| `[FreeTier] chat cloud write disabled` | `LogChat.tsx` |
| `[FreeTier] telemetry cloud write disabled` | `ApiCallTrackerModal.tsx` |

Optional: `[FreeTier] chat local delete`

### R5 — Food/biomarker Supabase-only (assert only)

**No code change required** if still true:

In `src/utils/syncUtils.ts` keep:

```ts
// Firebase backup writes for food/biomarker logs removed — Supabase is now
// the sole store for these two tables.
```

Gate greps this comment **and** ensures `syncLogsWithTimeBuckets` does not call `setDoc` / `writeBatch`.

**Do not** reintroduce Firestore food writes.

### R6 — Tests + gate script

Add files in pack tree:

1. `scripts/assert-free-tier-m23.mjs` (full source in §F)  
2. Optional small unit test not required if assert covers static paths.

Run:

```bash
node scripts/assert-free-tier-m23.mjs
npx tsc --noEmit
npx vitest run src/utils/syncUtils.regression.test.ts src/utils/firestoreUtils.test.ts
```

### FIND → REPLACE sketches (unique context; adjust if tree drifts)

#### E1 — Kill conversation setDoc (pattern)

**FIND** (unique around save):

```ts
      await setDoc(docRef, sanitizeForFirestore(prunedObject), { merge: true });
    } catch (err) {
      console.error("Error saving conversation to Firestore:", err);
    }
  };
```

**REPLACE:**

```ts
      // M23 free-tier kill-switch: do not write chat to Firestore.
      console.log('[FreeTier] chat cloud write disabled');
      // Local index for sidebar (device-local multi-session)
      try {
        const indexKey = `chat_index_${userId}_${type || 'medical'}_${agentType || 'none'}`;
        const prev = JSON.parse(localStorage.getItem(indexKey) || '[]');
        const title = prunedObject.title || finalDocObject.title;
        const entry = { id, title, updatedAt: new Date().toISOString(), type: type || 'medical', agentType: agentType || null };
        const next = [entry, ...(Array.isArray(prev) ? prev.filter((x: any) => x && x.id !== id) : [])].slice(0, 50);
        localStorage.setItem(indexKey, JSON.stringify(next));
      } catch (indexErr) {
        console.warn('[FreeTier] chat index update failed', indexErr);
      }
    } catch (err) {
      console.error("Error saving conversation locally:", err);
    }
  };
```

**Note:** Studio must ensure `prunedObject` / `finalDocObject` still exist **or** simplify: skip pruning entirely when cloud disabled (preferred smaller patch):

**Alternative REPLACE strategy (cleaner):** Immediately after successful IDB `safeIdbSet` for logged-in user, log `[FreeTier] chat cloud write disabled`, update local index from `msgs`, **`return`**, and leave the old setDoc block **unreachable deleted**.

#### E2 — Telemetry

**FIND:**

```ts
      trackApiCall('firebase_write', 'Firestore Write - Sync API Call Telemetry Batch (saves offline transaction logs to the cloud for system-wide auditing)');
      const batch = writeBatch(db);
```

**REPLACE:** entire function body of successful path with local-only block + marker (see R3). Remove batch loop.

---

## F. Machine gate

**Create** `scripts/assert-free-tier-m23.mjs`:

```js
#!/usr/bin/env node
/**
 * M23 — Free-tier Firestore write kill-switch hard gate.
 *   node scripts/assert-free-tier-m23.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root =
  fs.existsSync(path.join(process.cwd(), 'package.json')) &&
  fs.existsSync(path.join(process.cwd(), 'src/components/LogChat.tsx'))
    ? process.cwd()
    : path.join(__dirname, '..');

let failed = 0;
const failures = [];
function ok(m) { console.log(`  PASS  ${m}`); }
function fail(m) { failed++; failures.push(m); console.error(`  FAIL  ${m}`); }
function read(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

console.log('\n=== M23 Free-tier Firestore write kill-switch ===\n');
console.log(`root=${root}\n`);

const logChat = read('src/components/LogChat.tsx');
const tracker = read('src/components/ApiCallTrackerModal.tsx');
const syncUtils = read('src/utils/syncUtils.ts');
const plan = read('plan/RELIABILITY_FREE_TIER_PLAN.md');
const pack =
  read('studio/M23_FIRESTORE_WRITE_KILL_SWITCH.md') ||
  read('archive/studio/completed-2026-08/M23_FIRESTORE_WRITE_KILL_SWITCH.md');

// 1) Docs present
console.log('1) Pack + plan present');
if (!plan.includes('M23')) fail('plan/RELIABILITY_FREE_TIER_PLAN.md missing M23 program');
else ok('reliability plan mentions M23');
if (!pack.includes('chat cloud write disabled')) fail('M23 pack missing');
else ok('M23 pack present');

// 2) Chat kill-switch
console.log('\n2) Chat Firestore auto-write disabled');
if (!logChat.includes('[FreeTier] chat cloud write disabled')) {
  fail('LogChat missing marker [FreeTier] chat cloud write disabled');
} else ok('chat kill-switch marker');

// Must not still auto-write conversation docs on the save path.
// Allow deleteDoc/getDoc for optional migration, but ban setDoc to conversations collection pattern.
const setDocConversation =
  /setDoc\s*\(\s*docRef\s*,\s*sanitizeForFirestore\s*\(\s*prunedObject/.test(logChat) ||
  /setDoc\s*\(\s*doc\s*\(\s*db\s*,\s*['"]users['"]\s*,\s*userId\s*,\s*['"]conversations['"]/.test(logChat) ||
  /users'\,\s*userId\,\s*'conversations'/.test(logChat) && /setDoc\s*\(\s*docRef/.test(logChat);

// Stronger structural check: if setDoc( exists near conversations save, require kill-switch return before it.
if (logChat.includes("doc(db, 'users', userId, 'conversations'") || logChat.includes('doc(db, "users", userId, "conversations"')) {
  // If conversation doc ref still constructed for writes, ensure setDoc is not used with it for save.
  const hasSetDoc = /await\s+setDoc\s*\(/.test(logChat);
  if (hasSetDoc && logChat.includes('sanitizeForFirestore(prunedObject)')) {
    fail('LogChat still setDocs pruned conversation object to Firestore — remove cloud save path');
  } else if (hasSetDoc) {
    // setDoc may remain for unrelated reasons — flag soft
    const onlyAfterDisabled =
      logChat.includes('[FreeTier] chat cloud write disabled') &&
      !/sanitizeForFirestore\(\s*prunedObject\s*\)/.test(logChat);
    if (!onlyAfterDisabled && /setDoc\s*\(\s*docRef/.test(logChat)) {
      fail('LogChat still has setDoc(docRef) — remove conversation cloud write');
    } else ok('no prunedObject setDoc (conversation write removed)');
  } else ok('no await setDoc in LogChat');
} else {
  ok('no conversations doc() path (fully local)');
}

// trackApiCall firebase_write for Save Chat Session should be gone or not on hot path
if (/trackApiCall\(\s*['"]firebase_write['"]\s*,\s*`Firestore Write - Save Chat Session/.test(logChat) ||
    /trackApiCall\(\s*['"]firebase_write['"]\s*,\s*'Firestore Write - Save Chat Session/.test(logChat)) {
  fail('LogChat still tracks firebase_write Save Chat Session — remove with cloud write');
} else ok('no Save Chat Session firebase_write tracker');

// 3) Telemetry
console.log('\n3) Telemetry Firestore batch disabled');
if (!tracker.includes('[FreeTier] telemetry cloud write disabled')) {
  fail('ApiCallTrackerModal missing telemetry kill-switch marker');
} else ok('telemetry kill-switch marker');
if (/writeBatch\s*\(\s*db\s*\)/.test(tracker) && /api_events/.test(tracker)) {
  fail('ApiCallTrackerModal still writeBatch to api_events');
} else ok('no api_events writeBatch');
if (/Firestore Write - Sync API Call Telemetry Batch/.test(tracker) && /writeBatch/.test(tracker)) {
  fail('telemetry still claims Firestore batch sync with writeBatch present');
} else ok('telemetry cloud batch path cleared');

// 4) Food/biomarker Supabase-only remains
console.log('\n4) Food/biomarker Supabase-only');
if (!syncUtils.includes('Firebase backup writes for food/biomarker logs removed')) {
  fail('syncUtils missing Supabase-only food/biomarker comment — do not reintroduce Firestore backup');
} else ok('food/biomarker Supabase-only comment present');
// Heuristic: syncLogsWithTimeBuckets body should not setDoc
const syncFn = syncUtils.split('export const syncLogsWithTimeBuckets')[1]?.split('export const fetchAllConsolidatedLogs')[0] || '';
if (/setDoc\s*\(/.test(syncFn) || /writeBatch\s*\(/.test(syncFn)) {
  fail('syncLogsWithTimeBuckets appears to write Firestore again');
} else ok('syncLogsWithTimeBuckets has no setDoc/writeBatch');

// 5) IDB still used for chat (do not break local persist)
console.log('\n5) Local chat persist kept');
if (!/safeIdbSet\s*\(/.test(logChat) && !/idbSet\s*\(/.test(logChat)) {
  fail('LogChat must still persist chat to IndexedDB');
} else ok('IndexedDB chat persist present');

console.log('\n=== Result ===');
if (failed) {
  console.error(`\nFAILED ${failed} check(s):`);
  failures.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('\nAll M23 checks passed.\n');
process.exit(0);
```

Studio must add this file to the repo as listed.

---

## G. STATUS table (one row per acceptance ID)

| ID | Requirement | Evidence (fill on COMPLETE) | PASS/FAIL |
|----|-------------|-----------------------------|-----------|
| R1 | Chat save does not `setDoc` conversation to Firestore | path + marker | |
| R2 | Chat list/load local-first (IDB/index); no hot Firestore list spam | path | |
| R3 | Telemetry no `writeBatch`/`api_events` | path + marker | |
| R4 | Markers present | grep | |
| R5 | Food/biomarker still Supabase-only | syncUtils + assert | |
| R6 | `assert-free-tier-m23.mjs` exit 0 + tsc + named vitest | GATE LOG | |

---

## H. Out of scope (next packs)

| Next | Pack |
|------|------|
| Profile dual-write kill + foodImages/dashboard off Firestore | **M24** |
| Projected SELECT + keyset pagination | **M25** |
| Thin `agent_jobs` / mealBuild to R2 only | **M26** |
| Firebase ID token on sync/job APIs | **M27** |
| Gemini retry/backoff | **M28** |
| D1 investigation | **M30** only after metrics |

---

## I. IMPACT (paste before coding)

```text
IMPACT
class: L
goal: Stop free-tier Firestore write storms from chat auto-save and API telemetry cloud sync; keep chat on IDB; assert food/biomarker stay Supabase-only.
files:
  - src/components/LogChat.tsx
  - src/components/ApiCallTrackerModal.tsx
  - scripts/assert-free-tier-m23.mjs
  - studio/M23_FIRESTORE_WRITE_KILL_SWITCH.md (this)
  - plan/RELIABILITY_FREE_TIER_PLAN.md (already authored)
  - AI_HANDOVER.md (session note only)
paths: Medical chat | Guest chat | Food LogChat if shared | ApiCallTracker UI | food/bio sync (assert only)
fields/contracts: food/bio merge+tombstones unchanged; chat no longer multi-device via Firestore
domain docs read: sync (no law change); RELIABILITY_FREE_TIER_PLAN
out of scope: profile dual-write (M24), pull pagination (M25), R2 re-migration, D1, server.ts split, food-calc
risk if wrong: users lose cross-device chat history (accepted); or chat empty on reload if IDB path broken
plan:
  - R1/R2 local chat only
  - R3 local telemetry
  - R5 assert only
  - gate + tsc + sync regression vitest
```

---

## J. SELF-CHECK

```text
SELF-CHECK
- [ ] Every new import has a correct-path call site
- [ ] No placeholders / stubs left
- [ ] No drive-by refactors outside IMPACT.files
- [ ] No dropped food/bio merge fields
- [ ] Sibling paths: guest + logged-in chat both local-persist
- [ ] Detect+repair N/A (kill path, not detect-only)
- [ ] Domain invariants: no new absence=delete
- [ ] No gate script weakened
```

---

## K. GATE LOG (required for COMPLETE)

```text
GATE LOG
tsc:     exit ?   (npx tsc --noEmit)
vitest:  exit ?   (npx vitest run src/utils/syncUtils.regression.test.ts src/utils/firestoreUtils.test.ts)
assert:  exit ?   (node scripts/assert-free-tier-m23.mjs)
notes:   cross-device chat disabled by design; profile dual-write remains until M24 (known)
```

---

## L. COMPLETE policy

```text
COMPLETE only if:
  1. STATUS every row PASS with branch evidence
  2. assert-free-tier-m23.mjs exit 0
  3. named vitest exit 0
  4. tsc exit 0
Forbidden: all done / fully verified / nothing left / firestore completely removed
Import without call site = FAIL
Profile dual-write still present is OK for M23 if noted known-broken → M24
```

Also obey root `AGENTS.md` L10.

---

## M. After gate 0 (Studio only)

1. Commit + push to the **chosen shipping repo** (prefer single origin; reconcile `Health-tracker-2` vs `-6` with human).  
2. Move this pack → `archive/studio/completed-2026-08/`.  
3. Update `AI_HANDOVER.md`: M23 DONE; next **M24 profile single-writer**.  
4. Update `studio/ACTIVE_STATUS.md`.

---

## N. Human upload checklist

Upload to AI Studio:

- [ ] `studio/M23_FIRESTORE_WRITE_KILL_SWITCH.md`  
- [ ] `plan/RELIABILITY_FREE_TIER_PLAN.md`  
- [ ] Tree files if not already on origin: `LogChat.tsx`, `ApiCallTrackerModal.tsx`, `syncUtils.ts` baseline  
- [ ] Do **not** re-upload archived M20–M22 unless missing on target repo  

Then paste §A user prompt.
