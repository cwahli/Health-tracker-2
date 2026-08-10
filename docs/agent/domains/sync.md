# Domain rulebook: Multi-device sync

**Load when:** delete/reappear, duplicates across devices, Firebase/Firestore, Supabase rows, R2 photos/debug, job realtime, merge, tombstones, backup/restore, login pull.  
**Class:** almost always **L or X**. Prefer IMPACT + no silent contract changes.

**Architecture:** `plan/HYBRID_SUPABASE_CLOUDFLARE_R2.md`  
**WIP status:** `AI_HANDOVER.md`  
**Core code:** `src/utils/syncUtils.ts`, `SyncService.ts`, `firestoreUtils.ts`, `jobs/SupabaseJobSync.ts`, `jobs/JobStore.ts`, `utils/r2Storage.ts`, profile tombstone fields on `UserProfile`.

**How to use this book:** Prevent data loss and ghost reappearance.  
**Evolution allowed:** new stores, migrate off Firestore, change merge policy — but only with explicit design, tests, and rulebook update (protected-doc confirmation). Never “fix dupes” by wiping the other device’s rows without tombstones.

---

## 1. What goes where (current default roles)

| System | Owns | Does **not** own |
|--------|------|------------------|
| **Firebase Auth** | Identity | App data blobs |
| **Firestore** | Profile, time-bucket logs, legacy/consolidated user docs | Heavy photos / 70KB debug dumps |
| **Supabase** | `agent_jobs` realtime, clean food/biomarker rows (as implemented) | Authoritative “absence = deleted” without tombstones |
| **Cloudflare R2** | Photos + heavy debug JSON | Source of truth for log identity |
| **Local (IDB / memory / JobStore)** | In-flight UX, cache, offline buffer | Final multi-device authority without merge rules |

**Law:** Every durable entity needs a **stable `id`**, **`updated_at`**, and a defined **delete protocol**. Ad-hoc local-only deletes cause reappearance.

---

## 2. Merge laws (default — replace only with a designed policy + tests)

From `mergeByRecency` and related comments in `syncUtils.ts`:

1. **Never treat server absence as delete** unless a real tombstone says so.  
2. **Union by id:** local-only kept; server-only added; both → **strictly newer `updated_at` wins**.  
3. **Equal or older server data never overwrites local.**  
4. Prefer shared helpers (`mergeByRecency`, `filterLogsByTombstone`, `mergeDeleteMaps`) over ad-hoc “set state = server list”.  
5. **Dedupe by id** (and food fingerprint helpers), not display name alone.

Violating (1) is the #1 cause of multi-device data loss / ghosts.

---

## 3. Delete / tombstone protocol

Profile maps (timestamps):

| Map | Meaning |
|-----|---------|
| `deletedFoodLogIds` | Food log id → deleted-at |
| `deletedBiomarkerLogIds` | Biomarker log id → deleted-at |
| `deletedCustomBiomarkerKeys` | Custom biomarker key tombstones |
| `deletedNotUsedBiomarkerKeys` | Not-used flag removals |

Plus per-item `sync_state` including `'delete'` where used.

**Laws:**

1. User delete ⇒ write **tombstone** (and sync it) **and** mark/remove local item. UI hide alone is a bug.  
2. Tombstone wins if `tombstoneTs >= item.updated_at` (see existing filters in `App.tsx` / fetch paths).  
3. **Revive** only via explicit user action that clears tombstone **and** writes a newer `updated_at`.  
4. Merge of two profiles: **merge delete maps** (`mergeDeletes`) — do not drop the other device’s tombstones.  
5. Medical/food executors that send history must **filter** tombstoned ids (already patterned in `MedicalAgentExecutor`).

**Reappearance after delete** almost always means: tombstone not synced, merge ignored tombstone, or server write revived old `updated_at`.

---

## 4. Jobs & images (multi-device analyze)

| Step | Expectation |
|------|-------------|
| Photo | R2 (or agreed proxy path) — URL stored on job/log |
| Job status | Supabase `agent_jobs` (or JobStore sync layer) realtime |
| Clean result | Small JSON for UI |
| Debug payload | R2 on demand — not full dump in every sync row |

**Laws:**

- Job id stable across devices; no second job for same client request without guard (see duplicate job guards).  
- Completing on device A must not create a **duplicate food log** on device B (identity + dedupe).  
- Image URLs must survive sanitize/proxy paths (B11 / B11d family asserts).  
- **In-memory job precedence:** `/api/jobs/status` and `/api/jobs/debug` must check `inMemoryServerJobs` first and gracefully handle DB query failures without throwing HTTP 500/404.
- **Proxy-first R2 log fetching:** Browser fetches of R2 logs must route through the same-origin proxy `/api/r2/log-proxy` (with localStorage fallback) to prevent browser CORS failures.
- **Per-request diagnostic caching:** Diagnostic log viewers must key R2 caches by URL/request ID so dropdown selections dynamically update rather than locking onto the first cached request.

---

## 5. Cross-store consistency checklist

Before COMPLETE on sync-related work:

- [ ] Merge still union-by-id + recency (no full replace)  
- [ ] Deletes write tombstones and respect timestamps  
- [ ] Profile delete maps merged, not clobbered  
- [ ] Food **and** biomarker paths both handled if shared helper changed  
- [ ] Supabase row mappers preserve ids / `updated_at`  
- [ ] Firestore sanitize still strips illegal values without dropping ids  
- [ ] No new “if not on server, remove local” branch  
- [ ] Job/image path still matches hybrid plan roles  

---

## 6. Anti-patterns

- `setFoodLogs(serverFoods)` without merge  
- Delete only in React state  
- Generating new ids on every sync write (duplicates)  
- Using name+date as primary key across devices  
- Storing large debug JSON in Firestore/Supabase rows  
- Fixing “duplicate” by deleting the other device’s copy without tombstone/id analysis  
- Touching only food sync when biomarker uses the same helper  

---

## 7. Testing stance

**Suite (required when touching sync):**

```bash
npx vitest run src/utils/syncUtils.regression.test.ts src/utils/foodLogDedupe.test.ts src/utils/firestoreUtils.test.ts
```

Covers: `mergeByRecency`, `mergeDeleteMaps`, `isLogTombstoned` / `filterLogsByTombstone` (presence vs recency), `mergeProfiles` tombstones, `mergeBiomarkerHistory` key authority, multi-device F1–F3 pure narratives, food row mapper identity.

**Exported helpers (prefer over inline copies):**

| Helper | Use |
|--------|-----|
| `mergeDeleteMaps` | Union tombstone maps with max ts |
| `isLogTombstoned` / `filterLogsByTombstone` | Shared delete filter (`recency` preferred for bio; note food pull still often `presence`) |
| `mergeByRecency` | Log array merge — never replace-with-server |
| `mergeBiomarkerHistory` | Bio logs + tombstones + newer-side biomarker map authority |
| `mergeProfiles` | Profile + customs + all delete maps |

### Known inconsistencies (do not widen)

1. Food tombstones often **presence-only** on pull; bio often **recency** (`ts >= updated_at`).  
2. App food union is not always `mergeByRecency` (local-biased + images).  
3. `SyncService` can pass **empty** delete maps — do not use for production delete safety.  
4. Equal-timestamp `mergeBiomarkerHistory` **unions** biomarker keys (can reintroduce) — avoid equal clocks when correcting keys.

### Still TODO

1. Path-filter CI that fails if new `setFoodLogs(serverOnly)` appears without merge.  
2. E2E multi-device soak.  
3. Align all App filters on one `filterLogsByTombstone` mode policy.

---

## 8. Interaction with other domains

| Domain | Link |
|--------|------|
| Food-calc | Log identity / images / job clean_result — do not recompute nutrition on sync |
| Biomarkers | Dictionary customs + log tombstones must stay aligned with profile maps |
| Modal/jobs | Supabase job sync must not double-apply results into logs |

Sync moves **bytes and identity**. It must not silently rewrite food math or dictionary semantics.
