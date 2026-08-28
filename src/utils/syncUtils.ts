import { auth } from '../firebase';
import { trackApiCall } from './apiTracker';
import { doc, getDoc, setDoc, collection, getDocs, Firestore } from 'firebase/firestore';
import { FoodLog, BiomarkerLog, HealthAction, DailyBenefit, FoodIdea, RecommendationReport, UserProfile } from '../types';
import { toYYYYMMDD, formatToDDMMYYYY } from './dateUtils';
import { sanitizeForFirestore } from './firestoreUtils';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { isCatalogBuiltIn } from './biomarkers';

export const toYYYYMM = (dateStr: string): string => {
  if (!dateStr) return 'unknown';
  const ymd = toYYYYMMDD(dateStr);
  const parts = ymd.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}_${parts[1]}`;
  }
  return 'unknown';
};

/**
 * Merges local and server copies of a log array by recency, never by replacement.
 * - Items only in local (not returned by server) are KEPT — absence from a server
 *   response is never treated as "this was deleted."
 * - Items only in server are ADDED (e.g. synced from another device).
 * - Items in both are resolved by updated_at: the server version only wins if it
 *   is STRICTLY newer than the local version. Equal or older server data never
 *   overwrites local data.
 */
export function mergeByRecency<T extends { id: string; updated_at?: number }>(
  localItems: T[],
  serverItems: T[]
): T[] {
  const localMap = new Map(localItems.map(item => [item.id, item]));
  const mergedMap = new Map<string, T>(localMap);

  serverItems.forEach(serverItem => {
    const localItem = localMap.get(serverItem.id);
    if (!localItem) {
      mergedMap.set(serverItem.id, serverItem);
    } else if ((serverItem.updated_at || 0) > (localItem.updated_at || 0)) {
      mergedMap.set(serverItem.id, serverItem);
    }
    // else: local is newer or same age — keep the local version already in mergedMap
  });

  return Array.from(mergedMap.values());
}

/**
 * Max-merge two tombstone maps (id → deleted-at ms).
 * Shared by profile merge and tests — never drop the other device's deletes.
 */
export function mergeDeleteMaps(
  a: Record<string, number> | string[] | any = {},
  b: Record<string, number> | string[] | any = {}
): Record<string, number> {
  const merged: Record<string, number> = {};
  const add = (source: any) => {
    if (!source) return;
    if (Array.isArray(source)) {
      for (const item of source) {
        if (typeof item === 'string') {
          const k = item.trim();
          if (k && k !== 'undefined' && k !== 'null') {
            merged[k] = Math.max(merged[k] || 0, Date.now());
          }
        } else if (item && typeof item === 'object') {
          const k = String((item as any).id || (item as any).key || '').trim();
          const ts = Number((item as any).ts ?? (item as any).updated_at ?? (item as any).deleted_at) || Date.now();
          if (k && k !== 'undefined' && k !== 'null') {
            merged[k] = Math.max(merged[k] || 0, ts);
          }
        }
      }
    } else if (typeof source === 'object') {
      for (const [k, v] of Object.entries(source)) {
        const cleanK = String(k ?? '').trim();
        if (!cleanK || cleanK === 'undefined' || cleanK === 'null') continue;
        if (/^\d+$/.test(cleanK) && typeof v === 'string') {
          const valK = v.trim();
          if (valK && valK !== 'undefined' && valK !== 'null') {
            merged[valK] = Math.max(merged[valK] || 0, Date.now());
          }
          continue;
        }
        const num = typeof v === 'number' ? v : Number(v);
        if (!Number.isFinite(num) || num <= 0) continue;
        merged[cleanK] = Math.max(merged[cleanK] || 0, num);
      }
    }
  };
  add(a);
  add(b);
  return merged;
}

/** presence = id in map (any positive ts); recency = tombstoneTs >= updated_at */
export type TombstoneMode = 'presence' | 'recency';

/**
 * Whether a log id is tombstoned.
 * Tombstone value 0 is treated as "no tombstone" (falsy trap; do not store 0).
 */
export function isLogTombstoned(
  id: string | undefined,
  updated_at: number | undefined,
  deletedMap: Record<string, number> | undefined,
  mode: TombstoneMode = 'recency'
): boolean {
  if (!id || !deletedMap) return false;
  const t = deletedMap[id];
  if (t == null || t === 0) return false;
  if (mode === 'presence') return true;
  return t >= (updated_at || 0);
}

/** Filter logs by sync_state delete + tombstone map. */
export function filterLogsByTombstone<
  T extends { id: string; updated_at?: number; sync_state?: string }
>(
  items: T[],
  deletedMap: Record<string, number> = {},
  mode: TombstoneMode = 'recency'
): T[] {
  return (items || []).filter(
    (item) =>
      item &&
      item.sync_state !== 'delete' &&
      !isLogTombstoned(item.id, item.updated_at, deletedMap, mode)
  );
}

export function foodLogToSupabaseRow(food: FoodLog, uid: string) {
  return {
    id: food.id,
    firebase_uid: uid,
    date: toYYYYMMDD(food.date),
    name: food.name || '',
    composition: food.composition || '',
    weight_grams: food.weightGrams || 0,
    quantity: food.quantity || '',
    consumed_amount: food.consumedAmount ?? 1,
    benefits: food.benefits || '',
    risks: food.risks || '',
    health_impact: food.healthImpact || '',
    recommendation: food.recommendation || 'good',
    verdict: food.verdict || null,
    description: food.description || '',
    message: food.message || '',
    debug_url: food.debugUrl || '',
    chat_transcript: food.chatTranscript || [],
    calories: food.nutrients?.calories || 0,
    saturated_fat: food.nutrients?.saturatedFat || 0,
    sodium: food.nutrients?.sodium || 0,
    added_sugar: food.nutrients?.addedSugar || 0,
    nutrients: food.nutrients || {},
    items_breakdown: food.itemsBreakdown || [],
    scout_items: food.scoutItems || [],
    image_urls: food.imageUrls || (food.imageUrl ? [food.imageUrl] : []),
    updated_at: food.updated_at ? new Date(food.updated_at).toISOString() : new Date().toISOString()
  };
}

export function supabaseRowToFoodLog(row: any): FoodLog {
  let imageUrls: string[] = [];
  if (Array.isArray(row.image_urls)) {
    imageUrls = row.image_urls;
  } else if (typeof row.image_urls === 'string' && row.image_urls.trim()) {
    try {
      imageUrls = JSON.parse(row.image_urls);
    } catch {
      imageUrls = [row.image_urls];
    }
  }

  const imageUrl = row.image_url || (imageUrls.length > 0 ? imageUrls[0] : undefined);

  return {
    id: row.id,
    date: row.date || '',
    name: row.name || '',
    composition: row.composition || '',
    weightGrams: Number(row.weight_grams) || 0,
    quantity: row.quantity || '',
    consumedAmount: row.consumed_amount ?? 1,
    benefits: row.benefits || '',
    risks: row.risks || '',
    healthImpact: row.health_impact || '',
    recommendation: row.recommendation || 'good',
    verdict: row.verdict || undefined,
    description: row.description || '',
    message: row.message || '',
    debugUrl: row.debug_url || undefined,
    chatTranscript: Array.isArray(row.chat_transcript) ? row.chat_transcript : (typeof row.chat_transcript === 'string' ? JSON.parse(row.chat_transcript || '[]') : []),
    nutrients: typeof row.nutrients === 'object' && row.nutrients !== null ? row.nutrients : {
      calories: Number(row.calories) || 0,
      saturatedFat: Number(row.saturated_fat) || 0,
      sodium: Number(row.sodium) || 0,
      addedSugar: Number(row.added_sugar) || 0
    },
    itemsBreakdown: Array.isArray(row.items_breakdown) ? row.items_breakdown : (typeof row.items_breakdown === 'string' ? JSON.parse(row.items_breakdown || '[]') : []),
    scoutItems: Array.isArray(row.scout_items) ? row.scout_items : (typeof row.scout_items === 'string' ? JSON.parse(row.scout_items || '[]') : []),
    imageUrls: imageUrls,
    imageUrl: imageUrl,
    sync_state: 'synced',
    updated_at: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  };
}

/**
 * Lazy-fetch the heavy blob columns for a single food log.
 * Returns the raw detail fields or null on failure.
 */
export async function fetchFoodLogDetail(
  logId: string,
  uid: string,
  email?: string
): Promise<{
  composition?: string;
  items_breakdown?: any[];
  scout_items?: any[];
  chat_transcript?: any[];
} | null> {
  try {
    const res = await fetch('/api/sync/food-log-detail', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {})
      },
      body: JSON.stringify({ uid, email, logId })
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.detail : null;
  } catch (e) {
    console.warn('[fetchFoodLogDetail] Failed:', e);
    return null;
  }
}

export function biomarkerLogToSupabaseRow(bio: BiomarkerLog, uid: string) {
  return {
    id: bio.id,
    firebase_uid: uid,
    date: toYYYYMMDD(bio.date),
    biomarkers: bio.biomarkers || {},
    note: bio.note || '',
    summary: bio.summary || '',
    tests: bio.tests || [],
    updated_at: bio.updated_at ? new Date(bio.updated_at).toISOString() : new Date().toISOString()
  };
}

export function supabaseRowToBiomarkerLog(row: any): BiomarkerLog {
  return {
    id: row.id,
    date: formatToDDMMYYYY(row.date) || row.date || '',
    biomarkers: row.biomarkers || {},
    observationMeta: row.observation_meta || row.observationMeta || undefined,
    note: row.note || '',
    summary: row.summary || '',
    tests: Array.isArray(row.tests) ? row.tests : [],
    sync_state: 'synced',
    updated_at: row.updated_at ? new Date(row.updated_at).getTime() : Date.now()
  };
}

export function profileToSupabaseRow(profile: any, uid: string) {
  return {
    id: uid,
    firebase_uid: uid,
    data: profile || {},
    updated_at: new Date().toISOString()
  };
}


let lastDbOpId = 0;
export const dispatchDbInteraction = (
  type,
  path,
  data,
  database,
  docCount = 1
) => {
  const id = `${database.toLowerCase()}_op_${++lastDbOpId}_${Date.now()}`;
  window.dispatchEvent(new CustomEvent('db_op_start', {
    detail: { id, type, path, data, database, docCount }
  }));
  return id;
};

export const completeDbInteraction = (
  id, 
  success, 
  sizeBytes, 
  errorMsg, 
  finalDocCount
) => {
  window.dispatchEvent(new CustomEvent('db_op_complete', {
    detail: { id, success, sizeBytes, errorMsg, finalDocCount }
  }));
};

async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delayMs = 1000): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if ((res.status >= 500 || res.status === 429) && i < retries) {
        const retryAfterHeader = res.headers?.get('Retry-After');
        const retryAfterSec = retryAfterHeader ? parseFloat(retryAfterHeader) : NaN;
        const waitTime = !isNaN(retryAfterSec) && retryAfterSec > 0
          ? retryAfterSec * 1000
          : delayMs * Math.pow(2, i) + Math.random() * 400;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      return res;
    } catch (err: any) {
      if (i < retries) {
        await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, i) + Math.random() * 400));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Network request failed');
}

const sanitizeFoodsForSync = (foods: FoodLog[], opts?: { stripAllDataImages?: boolean }): FoodLog[] => {
  // R2 AUTO-UPLOAD PRESERVATION (Aug 2026):
  // We must NOT strip base64 "data:" URLs of images because the server needs them
  // to upload to R2 storage! Stripping them on the client-side prevents R2 uploads
  // and permanently replaces the images with "[image_removed_for_snapshot]" in the database,
  // causing them to be lost upon pull. We only strip if the image URL is abnormally large
  // (e.g. > 10MB) to protect against network overflow.
  const shouldStrip = (url: string | undefined) => {
    if (!url || !url.startsWith('data:')) return false;
    return url.length > 10000000;
  };
  return foods.map(food => {
    if (food.sync_state === 'delete') {
      return {
        id: food.id,
        date: food.date || '',
        name: food.name || '',
        sync_state: 'delete' as const,
        updated_at: food.updated_at || Date.now()
      } as any;
    }
    let imageUrl = food.imageUrl;
    let imageUrls = food.imageUrls;
    if (shouldStrip(imageUrl)) {
      imageUrl = '[image_removed_for_snapshot]';
    }
    if (Array.isArray(imageUrls)) {
      imageUrls = imageUrls.map(url => (shouldStrip(url) ? '[image_removed_for_snapshot]' : url));
    }
    return {
      ...food,
      imageUrl,
      imageUrls
    };
  });
};

let profilePushTimeout: any = null;
let latestProfilePushArgs: { profile: any; uid: string; extras?: any } | null = null;

export const upsertProfileToSupabase = async (
  profile: any, 
  uid: string,
  extras?: { actions?: HealthAction[]; dailyBenefits?: DailyBenefit[]; report?: RecommendationReport | null; email?: string; forceOverwrite?: boolean }
) => {
  if (!uid || !profile) return;
  latestProfilePushArgs = { profile, uid, extras };

  if (profilePushTimeout) {
    clearTimeout(profilePushTimeout);
  }

  return new Promise<void>((resolve) => {
    profilePushTimeout = setTimeout(async () => {
      if (!latestProfilePushArgs) {
        resolve();
        return;
      }
      const { profile: currentProf, uid: currentUid, extras: currentExtras } = latestProfilePushArgs;
      latestProfilePushArgs = null;

      try {
        const payload: any = {
          uid: currentUid,
          profile: currentProf,
          email: currentExtras?.email || currentProf?.email
        };
        if (currentExtras?.actions) payload.actions = currentExtras.actions;
        if (currentExtras?.dailyBenefits) payload.dailyBenefits = currentExtras.dailyBenefits;
        if (currentExtras?.report) payload.report = currentExtras.report;
        if (currentExtras?.forceOverwrite) payload.forceOverwrite = true;

        const res = await fetchWithRetry('/api/sync/supabase-push', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {})
          },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.warn('[Supabase Profile Sync] Failed to upsert profile:', res.status, errText);
        } else {
          console.log('[Supabase Profile Sync] Successfully updated profile & dashboard on Supabase');
        }
      } catch (err: any) {
        console.warn('[Supabase Profile Sync] Network error during profile push:', err?.message || err);
      } finally {
        resolve();
      }
    }, 600);
  });
};

export const syncLogsWithTimeBuckets = async (
  db: Firestore | null | undefined, 
  uid: string, 
  localFoods: FoodLog[], 
  localBiomarkers: BiomarkerLog[],
  deletedFoodLogIds: Record<string, number> = {},
  deletedBiomarkerLogIds: Record<string, number> = {},
  onSyncComplete: (syncedFoods: FoodLog[], syncedBiomarkers: BiomarkerLog[]) => void,
  options?: { forceAll?: boolean; forceAllBiomarkers?: boolean; forceAllFoods?: boolean }
) => {
  const forceAllFoods = !!options?.forceAllFoods;
  const forceAllBiomarkers = !!(options?.forceAllBiomarkers || options?.forceAll);

  const deletedFoodLogsFromMap: FoodLog[] = Object.keys(deletedFoodLogIds || {}).map(id => ({
    id,
    date: '',
    name: '',
    sync_state: 'delete' as const,
    updated_at: deletedFoodLogIds[id]
  } as any));

  const unsyncedFoods = forceAllFoods
    ? [
        ...localFoods.filter(f => f && f.id),
        ...deletedFoodLogsFromMap.filter(d => !localFoods.some(f => f.id === d.id))
      ]
    : [
        ...localFoods.filter(f => f && f.id && f.sync_state !== 'synced'),
        ...deletedFoodLogsFromMap.filter(d => !localFoods.some(f => f.id === d.id))
      ];

  const deletedBioLogsFromMap: BiomarkerLog[] = Object.keys(deletedBiomarkerLogIds || {}).map(id => ({
    id,
    date: '',
    sync_state: 'delete' as const,
    updated_at: deletedBiomarkerLogIds[id]
  } as any));

  const unsyncedBiomarkers = forceAllBiomarkers
    ? [
        ...localBiomarkers.filter(b => b && b.id),
        ...deletedBioLogsFromMap.filter(d => !localBiomarkers.some(b => b.id === d.id))
      ]
    : [
        ...localBiomarkers.filter(b => b && b.id && b.sync_state !== 'synced'),
        ...deletedBioLogsFromMap.filter(d => !localBiomarkers.some(b => b.id === d.id))
      ];
  
  if (unsyncedFoods.length === 0 && unsyncedBiomarkers.length === 0) {
    onSyncComplete(
      localFoods.filter(f => f.sync_state !== 'delete' && (!deletedFoodLogIds[f.id] || (f.updated_at || 0) > deletedFoodLogIds[f.id])),
      localBiomarkers.filter(b => b.sync_state !== 'delete' && (!deletedBiomarkerLogIds[b.id] || (b.updated_at || 0) > deletedBiomarkerLogIds[b.id]))
    );
    return;
  }

  const updatedLocalFoods = [...localFoods];
  const updatedLocalBiomarkers = [...localBiomarkers];

  // 1. Supabase Sync via Server Proxy (bypasses RLS using service_role key)
  const trackId = dispatchDbInteraction('upload', `users/${uid} (Food & Biomarker Logs)`, { foods: unsyncedFoods, bios: unsyncedBiomarkers }, 'Supabase', unsyncedFoods.length + unsyncedBiomarkers.length);
  try {
    const sanitizedFoods = sanitizeFoodsForSync(unsyncedFoods, { stripAllDataImages: forceAllFoods });
    const cleanDeletedFoods = mergeDeleteMaps(deletedFoodLogIds);
    const cleanDeletedBios = mergeDeleteMaps(deletedBiomarkerLogIds);
    const pushRes = await fetchWithRetry('/api/sync/supabase-push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {}) },
      body: JSON.stringify({
        uid,
        foods: sanitizedFoods,
        biomarkers: unsyncedBiomarkers,
        deletedFoodLogIds: cleanDeletedFoods,
        deletedBiomarkerLogIds: cleanDeletedBios
      })
    });

    if (pushRes.ok) {
      const pushResult = await pushRes.clone().json().catch(() => null);
      if (pushResult && Array.isArray(pushResult.errors) && pushResult.errors.length > 0) {
        console.warn('[Supabase Sync Push] Server reported partial failure:', pushResult.errors);
        window.dispatchEvent(new CustomEvent('sync_push_failed', {
          detail: {
            reason: pushResult.errors.map((e: any) => `${e.table} ${e.op}: ${e.message}`).join('; '),
            foodCount: unsyncedFoods.length,
            biomarkerCount: unsyncedBiomarkers.length
          }
        }));
      }
      // Update local state flags ONLY on successful response
      const syncedFoodIds = new Set(unsyncedFoods.map(f => f.id));
      for (let i = updatedLocalFoods.length - 1; i >= 0; i--) {
        const item = updatedLocalFoods[i];
        if (item.sync_state === 'delete' || (deletedFoodLogIds[item.id] && (item.updated_at || 0) <= deletedFoodLogIds[item.id])) {
          updatedLocalFoods.splice(i, 1);
        } else if (syncedFoodIds.has(item.id)) {
          updatedLocalFoods[i] = { ...item, sync_state: 'synced' };
        }
      }

      const syncedBioIds = new Set(unsyncedBiomarkers.map(b => b.id));
      for (let i = updatedLocalBiomarkers.length - 1; i >= 0; i--) {
        const item = updatedLocalBiomarkers[i];
        if (item.sync_state === 'delete' || (deletedBiomarkerLogIds[item.id] && (item.updated_at || 0) <= deletedBiomarkerLogIds[item.id])) {
          updatedLocalBiomarkers.splice(i, 1);
        } else if (syncedBioIds.has(item.id)) {
          updatedLocalBiomarkers[i] = { ...item, sync_state: 'synced' };
        }
      }
      completeDbInteraction(trackId, true, JSON.stringify(sanitizedFoods).length + JSON.stringify(unsyncedBiomarkers).length, undefined, unsyncedFoods.length + unsyncedBiomarkers.length);
    } else {
      const errText = await pushRes.text().catch(() => '');
      completeDbInteraction(trackId, false, 0, `Server returned ${pushRes.status}: ${errText}`, 1);
      console.warn('[Supabase Sync Push] Server error status:', pushRes.status, errText);
      window.dispatchEvent(new CustomEvent('sync_push_failed', {
        detail: {
          reason: `Server returned ${pushRes.status}`,
          foodCount: unsyncedFoods.length,
          biomarkerCount: unsyncedBiomarkers.length
        }
      }));
    }
  } catch (supabaseErr: any) {
    completeDbInteraction(trackId, false, 0, supabaseErr.message || String(supabaseErr), 1);
    console.warn('[Supabase Sync] Could not reach server, keeping local unsynced state for retry:', supabaseErr.message || String(supabaseErr));
    window.dispatchEvent(new CustomEvent('sync_push_failed', {
      detail: {
        reason: supabaseErr.message || String(supabaseErr),
        foodCount: unsyncedFoods.length,
        biomarkerCount: unsyncedBiomarkers.length
      }
    }));
  }

  // Firebase backup writes for food/biomarker logs removed — Supabase is now
  // the sole store for these two tables. Firestore `consolidated_logs` is left
  // read-only (see fetchAllConsolidatedLogs fallback) as a historical safety net.
  
  onSyncComplete(
    updatedLocalFoods.filter(f => f.sync_state !== 'delete' && (!deletedFoodLogIds[f.id] || (f.updated_at || 0) > deletedFoodLogIds[f.id])), 
    updatedLocalBiomarkers.filter(b => b.sync_state !== 'delete' && (!deletedBiomarkerLogIds[b.id] || (b.updated_at || 0) > deletedBiomarkerLogIds[b.id]))
  );
};

export const fetchAllConsolidatedLogs = async (
  db: Firestore | null | undefined, 
  uid: string, 
  deletedFoodLogIds: Record<string, number> = {}, 
  deletedBiomarkerLogIds: Record<string, number> = {},
  // API compat only — do NOT use to strip keys inside biomarker history rows
  _deletedCustomBiomarkerKeys: Record<string, number> = {},
  userEmail?: string,
  options?: { timeoutMs?: number; skipFirebaseFallback?: boolean; lastSyncTime?: number }
) => {
  const pullTimeoutMs = options?.timeoutMs ?? 60000;
  const skipFirebaseFallback = !!options?.skipFirebaseFallback;
  const lastSyncTime = options?.lastSyncTime;

  let serverFoods: FoodLog[] = [];
  let serverBiomarkers: BiomarkerLog[] = [];
  let serverProfile: UserProfile | null = null;
  let serverActions: HealthAction[] = [];
  let serverBenefits: DailyBenefit[] = [];
  let serverReport: RecommendationReport | null = null;

  const possibleUids = Array.from(new Set([
    uid,
    userEmail,
    'cwah.liu@gmail.com',
    'chiwah.liu@gmail.com'
  ].filter(Boolean) as string[]));

  // Primary: Fetch from Supabase via server-side proxy (bypasses RLS using service_role key)
  const trackId = dispatchDbInteraction('download', `users/${uid} (All Logs)`, null, 'Supabase');
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), pullTimeoutMs);
    const proxyRes = await fetch('/api/sync/supabase-pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth.currentUser ? { Authorization: `Bearer ${await auth.currentUser.getIdToken()}` } : {}) },
      body: JSON.stringify({ uid, email: userEmail, lastSyncTime, listOnly: true, pageSize: 1000 }),
      signal: controller.signal
    }).finally(() => clearTimeout(timeoutId));
    
    if (proxyRes.ok) {
      const result = await proxyRes.json();
      const cleanDelFoods = mergeDeleteMaps(deletedFoodLogIds, result.profileData?.profile?.deletedFoodLogIds || result.profileData?.deletedFoodLogIds || {});
      const cleanDelBios = mergeDeleteMaps(deletedBiomarkerLogIds, result.profileData?.profile?.deletedBiomarkerLogIds || result.profileData?.deletedBiomarkerLogIds || {});
      const cleanDelBenefits = mergeDeleteMaps(result.profileData?.profile?.deletedDailyBenefitIds || result.profileData?.deletedDailyBenefitIds || {});

      if (result.success && result.foods) {
        const foodMap = new Map<string, FoodLog>();
        result.foods.forEach((row: any) => {
          const t = cleanDelFoods[row.id];
          const rowUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
          if (!t || rowUpdatedAt > t) {
            const foodLog = supabaseRowToFoodLog(row);
            const existing = foodMap.get(foodLog.id);
            if (!existing || (foodLog.updated_at || 0) > (existing.updated_at || 0)) {
              foodMap.set(foodLog.id, foodLog);
            }
          }
        });
        serverFoods = Array.from(foodMap.values());
      }
      if (result.success && result.biomarkers) {
        const bioMap = new Map<string, BiomarkerLog>();
        result.biomarkers.forEach((row: any) => {
          const t = cleanDelBios[row.id];
          const rowUpdatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
          if (!t || rowUpdatedAt > t) {
            const bioLog = supabaseRowToBiomarkerLog(row);
            const cleanedBiomarkers = { ...(bioLog.biomarkers || {}) };
            // Do NOT strip keys via deletedCustomBiomarkerKeys — that map is for dictionary defs only.
            const hasData = Object.keys(cleanedBiomarkers).length > 0 || (bioLog.note && bioLog.note.trim()) || (bioLog.summary && bioLog.summary.trim()) || (bioLog.tests && bioLog.tests.length > 0);
            if (hasData) {
              const existing = bioMap.get(bioLog.id);
              if (!existing || (bioLog.updated_at || 0) > (existing.updated_at || 0)) {
                bioMap.set(bioLog.id, { ...bioLog, biomarkers: cleanedBiomarkers });
              }
            }
          }
        });
        serverBiomarkers = Array.from(bioMap.values());
      }
      if (result.success && result.profileData) {
        const rawP = result.profileData.profile || result.profileData;
        if (rawP && (rawP.email || rawP.nickname !== undefined || rawP.lastUpdatedAt || rawP.customBiomarkers)) {
          serverProfile = {
            ...rawP,
            deletedBiomarkerLogIds: mergeDeleteMaps(rawP.deletedBiomarkerLogIds),
            deletedFoodLogIds: mergeDeleteMaps(rawP.deletedFoodLogIds),
            deletedCustomBiomarkerKeys: mergeDeleteMaps(rawP.deletedCustomBiomarkerKeys),
            deletedNotUsedBiomarkerKeys: mergeDeleteMaps(rawP.deletedNotUsedBiomarkerKeys),
            deletedDailyBenefitIds: mergeDeleteMaps(rawP.deletedDailyBenefitIds)
          };
        }
        if (Array.isArray(result.profileData.actions)) serverActions = result.profileData.actions;
        if (Array.isArray(result.profileData.dailyBenefits)) serverBenefits = result.profileData.dailyBenefits;
        if (result.profileData.report !== undefined) serverReport = result.profileData.report || null;
      }
      const totalBytes = JSON.stringify(serverFoods).length + JSON.stringify(serverBiomarkers).length + (serverProfile ? JSON.stringify(serverProfile).length : 0);
      completeDbInteraction(trackId, true, totalBytes, undefined, serverFoods.length + serverBiomarkers.length);
      console.log(`[Supabase Proxy] Pulled ${serverFoods.length} foods, ${serverBiomarkers.length} biomarkers, profile=${!!serverProfile}, actions=${serverActions.length}, benefits=${serverBenefits.length}`);
    } else {
      const errText = await proxyRes.text().catch(() => '');
      completeDbInteraction(trackId, false, 0, `Server proxy error: ${proxyRes.status} ${errText}`, 1);
      console.warn('[Supabase Proxy] Server returned status:', proxyRes.status, errText);
    }
  } catch (err: any) {
    const isAbort = err.name === 'AbortError';
    const msg = isAbort ? `Request timed out after ${pullTimeoutMs}ms` : (err.message || String(err));
    completeDbInteraction(trackId, false, 0, msg, 1);
    console.warn('[Supabase Proxy] Server pull unavailable, falling back to local/Firebase:', msg);
  }

  // Secondary/Fallback: Fetch from Firebase if Supabase returned nothing and db is available.
  // Only logged to the activity feed when it actually fires, so the feed shows a true
  // "Supabase empty -> Firebase resolved it" story instead of staying silent.
  if (!skipFirebaseFallback && serverFoods.length === 0 && serverBiomarkers.length === 0 && db) {
    const fbTrackId = dispatchDbInteraction('download', `users/${uid}/consolidated_logs (Fallback)`, null, 'Firebase');
    try {
      const bucketsSnap = await getDocs(collection(db, 'users', uid, 'consolidated_logs'));
      bucketsSnap.docs.forEach(docSnap => {
        const data = docSnap.data();
        if (data && data.logs) {
          Object.values(data.logs).forEach((logInfo: any) => {
            if (logInfo.type === 'food') {
              const isDeletedInMap = !!deletedFoodLogIds[logInfo.data.id];
              const isDeletedInLog = logInfo.data.sync_state === 'delete';
              if (!isDeletedInMap && !isDeletedInLog) {
                serverFoods.push({ ...logInfo.data, sync_state: 'synced' });
              }
            } else if (logInfo.type === 'biomarker') {
              const t = deletedBiomarkerLogIds[logInfo.data.id];
              if (!t || (logInfo.data.updated_at || 0) > t) {
                const bioLog = logInfo.data;
                const cleanedBiomarkers = { ...bioLog.biomarkers };
                // Keep biomarkers intact (do not strip)
                const hasData = Object.keys(cleanedBiomarkers).length > 0 || (bioLog.note && bioLog.note.trim()) || (bioLog.summary && bioLog.summary.trim()) || (bioLog.tests && bioLog.tests.length > 0);
                if (hasData) {
                  serverBiomarkers.push({ ...bioLog, biomarkers: cleanedBiomarkers, sync_state: 'synced' });
                }
              }
            }
          });
        }
      });
      completeDbInteraction(fbTrackId, true, JSON.stringify(serverFoods).length + JSON.stringify(serverBiomarkers).length, undefined, serverFoods.length + serverBiomarkers.length);
    } catch (fbErr: any) {
      console.warn('[Firebase Fallback Fetch] Failed:', fbErr);
      completeDbInteraction(fbTrackId, false, 0, fbErr.message || String(fbErr), 0);
    }
  }

  return { serverFoods, serverBiomarkers, serverProfile, serverActions, serverBenefits, serverReport };
};

/**
 * Subscribes to instant Supabase real-time database changes for a user's food and biomarker logs.
 */
export const subscribeToSupabaseLogs = (uid: string, onChange: (payload?: any) => void) => {
  if (!uid || !isSupabaseConfigured) return () => {};
  try {
    const channel = supabase
      .channel(`user_logs_${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'food_logs', filter: `firebase_uid=eq.${uid}` },
        (payload) => onChange(payload)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'biomarker_logs', filter: `firebase_uid=eq.${uid}` },
        (payload) => onChange(payload)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
        (payload) => onChange(payload)
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel).catch(() => {});
      } catch (_) {}
    };
  } catch (err) {
    console.warn('[Supabase Sync] Failed to subscribe to realtime logs:', err);
    return () => {};
  }
};

export function mergeActions(cloudActions: HealthAction[] = [], localActions: HealthAction[] = []): HealthAction[] {
  const map = new Map<string, HealthAction>();
  (localActions || []).forEach(act => {
    if (!act) return;
    const key = act.id || (act as any).title || (act as any).action || (act as any).recommendation;
    if (key) {
      map.set(key, { ...act, id: act.id || key });
    }
  });
  (cloudActions || []).forEach(cloudAct => {
    if (!cloudAct) return;
    const key = cloudAct.id || (cloudAct as any).title || (cloudAct as any).action || (cloudAct as any).recommendation;
    if (key) {
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...cloudAct, id: cloudAct.id || key });
      } else {
        const localTime = existing.updated_at || existing.createdAt || 0;
        const cloudTime = cloudAct.updated_at || cloudAct.createdAt || 0;
        const isCompleted = existing.completed || cloudAct.completed;
        if (localTime > cloudTime) {
          map.set(key, { ...cloudAct, ...existing, completed: isCompleted, id: existing.id || key });
        } else {
          map.set(key, { ...existing, ...cloudAct, completed: isCompleted, id: cloudAct.id || key });
        }
      }
    }
  });
  return Array.from(map.values());
}

export function mergeBenefits(cloudBenefits: DailyBenefit[] = [], localBenefits: DailyBenefit[] = [], tombstoneIds: Record<string, number> = {}): DailyBenefit[] {
  const map = new Map<string, DailyBenefit>();
  (localBenefits || []).forEach(ben => {
    if (!ben) return;
    const key = ben.id || (ben as any).title || (ben as any).benefit;
    if (key) {
      if (tombstoneIds[key] && tombstoneIds[key] >= (ben.updated_at || 0)) return;
      map.set(key, { ...ben, id: ben.id || key });
    }
  });
  (cloudBenefits || []).forEach(cloudBen => {
    if (!cloudBen) return;
    const key = cloudBen.id || (cloudBen as any).title || (cloudBen as any).benefit;
    if (key) {
      if (tombstoneIds[key] && tombstoneIds[key] >= (cloudBen.updated_at || 0)) return;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...cloudBen, id: cloudBen.id || key });
      } else {
        const localTime = existing.updated_at || 0;
        const cloudTime = cloudBen.updated_at || 0;
        const isCompleted = existing.completed || cloudBen.completed;
        if (localTime > cloudTime) {
          map.set(key, { ...cloudBen, ...existing, completed: isCompleted, id: existing.id || key });
        } else {
          map.set(key, { ...existing, ...cloudBen, completed: isCompleted, id: cloudBen.id || key });
        }
      }
    }
  });
  return Array.from(map.values());
}

export function mergeFoodIdeas(cloudIdeas: FoodIdea[] = [], localIdeas: FoodIdea[] = []): FoodIdea[] {
  const map = new Map<string, FoodIdea>();
  (localIdeas || []).forEach(item => {
    if (item && item.id) map.set(item.id, { ...item });
  });
  (cloudIdeas || []).forEach(cloudItem => {
    if (cloudItem && cloudItem.id) {
      const existing = map.get(cloudItem.id);
      map.set(cloudItem.id, { ...(existing || {}), ...cloudItem });
    }
  });
  return Array.from(map.values());
}

// --- Generic future-proof merge helpers (mirrors server.ts logic for the client-side pull merge) ---
function deepMergeFieldValue(existingVal: any, incomingVal: any): any {
  if (incomingVal === undefined) return existingVal;
  if (existingVal === undefined || existingVal === null) return incomingVal;

  if (Array.isArray(incomingVal)) {
    if (!Array.isArray(existingVal)) return incomingVal;
    const idOf = (item: any) => (item && typeof item === 'object')
      ? (item.id ?? item.key ?? item.category ?? item.title ?? item.name)
      : undefined;
    const allObjects = incomingVal.every((i: any) => i && typeof i === 'object')
      && existingVal.every((i: any) => i && typeof i === 'object');
    const allHaveIdentity = allObjects
      && [...incomingVal, ...existingVal].every((item: any) => idOf(item) !== undefined);
    if (allHaveIdentity) {
      const map = new Map<any, any>();
      existingVal.forEach((item: any) => map.set(idOf(item), item));
      incomingVal.forEach((item: any) => {
        const k = idOf(item);
        map.set(k, { ...(map.get(k) || {}), ...item });
      });
      return Array.from(map.values());
    }
    return incomingVal;
  }

  if (typeof incomingVal === 'object' && typeof existingVal === 'object' && !Array.isArray(existingVal)) {
    const merged: any = { ...existingVal };
    for (const k of Object.keys(incomingVal)) {
      merged[k] = deepMergeFieldValue(existingVal[k], incomingVal[k]);
    }
    return merged;
  }

  return incomingVal;
}

function deepMergeObjectShallow(existingObj: any, incomingObj: any, excludeKeys: string[]): any {
  const result: any = { ...(existingObj || {}) };
  const excludeSet = new Set(excludeKeys);
  Object.keys(incomingObj || {}).forEach((k) => {
    if (excludeSet.has(k)) return;
    result[k] = deepMergeFieldValue(existingObj ? existingObj[k] : undefined, incomingObj[k]);
  });
  return result;
}

export function mergeReports(cloudReport: RecommendationReport | null, localReport: RecommendationReport | null): RecommendationReport | null {
  if (!cloudReport && !localReport) return null;
  if (!cloudReport) return localReport;
  if (!localReport) return cloudReport;

  const cloudTime = cloudReport.timestamp ? new Date(cloudReport.timestamp).getTime() : 0;
  const localTime = localReport.timestamp ? new Date(localReport.timestamp).getTime() : 0;

  const primary = localTime >= cloudTime ? localReport : cloudReport;
  const secondary = localTime >= cloudTime ? cloudReport : localReport;

  const mergedDailyTargets = {
    ...(secondary.dailyNutrientTargets || {}),
    ...(primary.dailyNutrientTargets || {})
  };

  const mergedWeeklyTargets = {
    ...((secondary as any).topWeeklyNutrientTargets || (secondary as any).weeklyNutrientTargets || {}),
    ...((primary as any).topWeeklyNutrientTargets || (primary as any).weeklyNutrientTargets || {})
  };

  const mergedGeneralTargets = {
    ...((secondary as any).generalNutrientTargets || {}),
    ...((primary as any).generalNutrientTargets || {})
  };

  const mergedActionsList = mergeActions(cloudReport.actions || [], localReport.actions || []);
  const mergedBenefitsList = mergeBenefits(cloudReport.dailyBenefits || [], localReport.dailyBenefits || []);

  // Merge healthBaselineCategories / biomarkerCategories
  const categoryMap = new Map<string, any>();
  [...(secondary.healthBaselineCategories || []), ...((secondary as any).biomarkerCategories || [])].forEach((c: any) => {
    const key = c?.category || c?.title || c?.name;
    if (key) categoryMap.set(key, { ...c });
  });
  [...(primary.healthBaselineCategories || []), ...((primary as any).biomarkerCategories || [])].forEach((c: any) => {
    const key = c?.category || c?.title || c?.name;
    if (key) {
      const existing = categoryMap.get(key);
      categoryMap.set(key, { ...(existing || {}), ...c });
    }
  });
  const mergedCategories = Array.from(categoryMap.values());

  return {
    ...deepMergeObjectShallow(secondary, primary, [
      'dailyNutrientTargets', 'weeklyNutrientTargets', 'topWeeklyNutrientTargets', 'generalNutrientTargets',
      'actions', 'dailyBenefits', 'mostImportantNextStep', 'healthBaselineCategories'
    ]),
    dailyNutrientTargets: mergedDailyTargets,
    weeklyNutrientTargets: mergedWeeklyTargets,
    topWeeklyNutrientTargets: mergedWeeklyTargets,
    generalNutrientTargets: mergedGeneralTargets,
    actions: mergedActionsList,
    dailyBenefits: mergedBenefitsList,
    mostImportantNextStep: primary.mostImportantNextStep || secondary.mostImportantNextStep || '',
    healthBaselineCategories: mergedCategories.length > 0 ? mergedCategories : (primary.healthBaselineCategories || secondary.healthBaselineCategories || [])
  } as RecommendationReport;
}

export function mergeProfiles(cloudProfile: UserProfile | null, localProfile: UserProfile | null): UserProfile | null {
  if (!cloudProfile && !localProfile) return null;
  if (!cloudProfile) return localProfile;
  if (!localProfile) return cloudProfile;

  const cloudTime = cloudProfile.lastUpdatedAt || 0;
  const localTime = localProfile.lastUpdatedAt || 0;

  const primary = localTime >= cloudTime ? localProfile : cloudProfile;
  const secondary = localTime >= cloudTime ? cloudProfile : localProfile;

  const customBiomarkers: Record<string, any> = {};
  const customKeys = new Set([
    ...Object.keys((secondary as any).customBiomarkers || {}),
    ...Object.keys((primary as any).customBiomarkers || {})
  ]);

  const deletedCustomBiomarkerKeys: Record<string, number> = {
    ...(secondary.deletedCustomBiomarkerKeys || {})
  };
  for (const [k, v] of Object.entries(primary.deletedCustomBiomarkerKeys || {})) {
    deletedCustomBiomarkerKeys[k] = Math.max(deletedCustomBiomarkerKeys[k] || 0, v as number);
  }

  customKeys.forEach((k) => {
    const secHasIt = !!(secondary as any).customBiomarkers?.[k];
    const priHasIt = !!(primary as any).customBiomarkers?.[k];
    if (!secHasIt && !priHasIt) return;

    const delTime = deletedCustomBiomarkerKeys[k] || 0;

    // Once a custom biomarker is deleted (delTime > 0), it stays deleted.
    // If a user explicitly re-adds it, App.tsx removes its tombstone from deletedCustomBiomarkerKeys before syncing,
    // so delTime would be 0 in that case.
    if (delTime > 0) {
      return;
    }

    const secDef = (secondary as any).customBiomarkers?.[k] || {};
    const priDef = (primary as any).customBiomarkers?.[k] || {};

    const secRisks = Array.isArray(secDef.riskCategories) ? secDef.riskCategories : [];
    const priRisks = Array.isArray(priDef.riskCategories) ? priDef.riskCategories : [];
    const combinedRisks = Array.from(new Set([...secRisks, ...priRisks]));

    const secConditions = Array.isArray(secDef.potentialMedicalConditions)
      ? secDef.potentialMedicalConditions
      : [];
    const priConditions = Array.isArray(priDef.potentialMedicalConditions)
      ? priDef.potentialMedicalConditions
      : [];
    const combinedConditions = Array.from(new Set([...secConditions, ...priConditions]));

    // Resolve per-key freshness using each definition's own updatedAt when present,
    // falling back to the whole-profile clock only for older data that predates this field.
    const priKeyTime = priDef.updatedAt || primary.lastUpdatedAt || 0;
    const secKeyTime = secDef.updatedAt || secondary.lastUpdatedAt || 0;
    const newerDef = priKeyTime >= secKeyTime ? priDef : secDef;
    const olderDef = priKeyTime >= secKeyTime ? secDef : priDef;

    const dispName = newerDef.display_name || newerDef.displayName || olderDef.display_name || olderDef.displayName;
    const stdGrouping = newerDef.standardMedicalGrouping || olderDef.standardMedicalGrouping;
    const catVal = newerDef.category || olderDef.category;
    const desc = newerDef.description || olderDef.description;
    const descs = newerDef.descriptions || olderDef.descriptions;
    const benRisk = newerDef.benefitRisk || olderDef.benefitRisk;
    const normRange = newerDef.normalRange || olderDef.normalRange;
    const unitVal = newerDef.unit || olderDef.unit;
    const rngCfg = newerDef.rangeConfig || olderDef.rangeConfig;
    const cstRanges = newerDef.customRanges || olderDef.customRanges;
    const rngBrackets = newerDef.rangeBrackets || olderDef.rangeBrackets;
    const optRange = newerDef.optimalRange || olderDef.optimalRange;
    const minR = newerDef.minRange !== undefined ? newerDef.minRange : olderDef.minRange;
    const maxR = newerDef.maxRange !== undefined ? newerDef.maxRange : olderDef.maxRange;
    const optMin = newerDef.optimalMin !== undefined ? newerDef.optimalMin : olderDef.optimalMin;
    const optMax = newerDef.optimalMax !== undefined ? newerDef.optimalMax : olderDef.optimalMax;
    const maxTime = Math.max(priKeyTime, secKeyTime);

    const mergedDef: any = {
      ...olderDef,
      ...newerDef,
      name: newerDef.name || olderDef.name
    };
    if (dispName) mergedDef.display_name = dispName; else delete mergedDef.display_name;
    if (stdGrouping) mergedDef.standardMedicalGrouping = stdGrouping; else delete mergedDef.standardMedicalGrouping;
    if (catVal) mergedDef.category = catVal; else delete mergedDef.category;
    if (desc) mergedDef.description = desc; else delete mergedDef.description;
    if (descs) mergedDef.descriptions = descs; else delete mergedDef.descriptions;
    if (benRisk) mergedDef.benefitRisk = benRisk; else delete mergedDef.benefitRisk;
    if (normRange) mergedDef.normalRange = normRange; else delete mergedDef.normalRange;
    if (unitVal) mergedDef.unit = unitVal; else delete mergedDef.unit;
    if (rngCfg) mergedDef.rangeConfig = rngCfg; else delete mergedDef.rangeConfig;
    if (cstRanges) mergedDef.customRanges = cstRanges; else delete mergedDef.customRanges;
    if (rngBrackets) mergedDef.rangeBrackets = rngBrackets; else delete mergedDef.rangeBrackets;
    if (optRange) mergedDef.optimalRange = optRange; else delete mergedDef.optimalRange;
    if (minR !== undefined) mergedDef.minRange = minR; else delete mergedDef.minRange;
    if (maxR !== undefined) mergedDef.maxRange = maxR; else delete mergedDef.maxRange;
    if (optMin !== undefined) mergedDef.optimalMin = optMin; else delete mergedDef.optimalMin;
    if (optMax !== undefined) mergedDef.optimalMax = optMax; else delete mergedDef.optimalMax;
    if (maxTime > 0) mergedDef.updatedAt = maxTime; else delete mergedDef.updatedAt;
    if (combinedRisks.length > 0) mergedDef.riskCategories = combinedRisks;
    if (combinedConditions.length > 0) mergedDef.potentialMedicalConditions = combinedConditions;

    if (isCatalogBuiltIn(k) || mergedDef.catalogApproved === true || newerDef.catalogApproved === true) {
      delete mergedDef.needsApproval;
      if (mergedDef.catalogApproved !== false) mergedDef.catalogApproved = true;
    } else if (newerDef.needsApproval === true) {
      // Newer side wins. Do not resurrect a stale cloud needsApproval after local approval.
      mergedDef.needsApproval = true;
    } else {
      delete mergedDef.needsApproval;
    }

    Object.keys(mergedDef).forEach(key => {
      if (mergedDef[key] === undefined) delete mergedDef[key];
    });

    customBiomarkers[k] = mergedDef;
  });

  Object.keys(deletedCustomBiomarkerKeys).forEach(k => {
    delete customBiomarkers[k];
  });

  const deletedFoodLogIds = mergeDeleteMaps(secondary.deletedFoodLogIds, primary.deletedFoodLogIds);
  const deletedBiomarkerLogIds = mergeDeleteMaps(secondary.deletedBiomarkerLogIds, primary.deletedBiomarkerLogIds);
  const deletedNotUsedBiomarkerKeys = mergeDeleteMaps(secondary.deletedNotUsedBiomarkerKeys, primary.deletedNotUsedBiomarkerKeys);
  const deletedDailyBenefitIds = mergeDeleteMaps(secondary.deletedDailyBenefitIds, primary.deletedDailyBenefitIds);

  // Union notUsedBiomarkers by key instead of letting the outer object spread clobber one
  // side wholesale. A tombstone (deletedNotUsedBiomarkerKeys) wins over a stale flaggedAt
  // unless the flag itself is newer than the tombstone (i.e. the user re-flagged it after restoring).
  const notUsedKeys = new Set([
    ...Object.keys(secondary.notUsedBiomarkers || {}),
    ...Object.keys(primary.notUsedBiomarkers || {})
  ]);
  const notUsedBiomarkers: Record<string, { flaggedAt: number }> = {};
  notUsedKeys.forEach((k) => {
    const secEntry = (secondary.notUsedBiomarkers || {})[k];
    const priEntry = (primary.notUsedBiomarkers || {})[k];
    const flaggedAt = Math.max(secEntry?.flaggedAt || 0, priEntry?.flaggedAt || 0);
    const tombstone = deletedNotUsedBiomarkerKeys[k] || 0;
    if (tombstone > 0 && tombstone >= flaggedAt) return;
    if (flaggedAt > 0) notUsedBiomarkers[k] = { flaggedAt };
  });

  const targets = {
    ...((secondary as any).targets || {}),
    ...((primary as any).targets || {})
  };

  const generalNutrientTargets = {
    ...((secondary as any).generalNutrientTargets || {}),
    ...((primary as any).generalNutrientTargets || {})
  };

  const weeklyTargets = {
    ...((secondary as any).weeklyTargets ||
      (secondary as any).weeklyNutrientTargets ||
      (secondary as any).topWeeklyNutrientTargets ||
      {}),
    ...((primary as any).weeklyTargets ||
      (primary as any).weeklyNutrientTargets ||
      (primary as any).topWeeklyNutrientTargets ||
      {})
  };

  const customGroupings = {
    ...((secondary as any).customGroupings || {}),
    ...((primary as any).customGroupings || {})
  };

  const groupingDescriptions = {
    ...((secondary as any).groupingDescriptions || {}),
    ...((primary as any).groupingDescriptions || {})
  };

  const categoryDescriptions = {
    ...((secondary as any).categoryDescriptions || {}),
    ...((primary as any).categoryDescriptions || {})
  };

  const actions = mergeActions((secondary as any).actions || [], (primary as any).actions || []);
  const dailyBenefits = mergeBenefits((secondary as any).dailyBenefits || [], (primary as any).dailyBenefits || [], deletedDailyBenefitIds);

  return {
    ...deepMergeObjectShallow(secondary, primary, [
      'customBiomarkers', 'deletedFoodLogIds', 'deletedBiomarkerLogIds', 'deletedCustomBiomarkerKeys',
      'notUsedBiomarkers', 'deletedNotUsedBiomarkerKeys', 'deletedDailyBenefitIds', 'actions', 'dailyBenefits',
      'targets', 'generalNutrientTargets', 'weeklyTargets', 'weeklyNutrientTargets', 'topWeeklyNutrientTargets',
      'customGroupings', 'groupingDescriptions', 'categoryDescriptions'
    ]),
    email: localProfile?.email || primary.email || cloudProfile?.email || '',
    customBiomarkers,
    deletedFoodLogIds,
    deletedBiomarkerLogIds,
    deletedCustomBiomarkerKeys,
    notUsedBiomarkers,
    deletedNotUsedBiomarkerKeys,
    deletedDailyBenefitIds,
    bmiAutoLogged: (primary.bmiAutoLogged !== undefined ? primary.bmiAutoLogged : secondary.bmiAutoLogged) ?? false,
    actions,
    dailyBenefits,
    ...(Object.keys(targets).length > 0 ? { targets } : {}),
    ...(Object.keys(generalNutrientTargets).length > 0 ? { generalNutrientTargets } : {}),
    ...(Object.keys(weeklyTargets).length > 0
      ? {
          weeklyTargets,
          weeklyNutrientTargets: weeklyTargets,
          topWeeklyNutrientTargets: weeklyTargets
        }
      : {}),
    ...(Object.keys(customGroupings).length > 0 ? { customGroupings } : {}),
    ...(Object.keys(groupingDescriptions).length > 0 ? { groupingDescriptions } : {}),
    ...(Object.keys(categoryDescriptions).length > 0 ? { categoryDescriptions } : {})
  } as UserProfile;
}

export function mergeBiomarkerHistory(
  cloudHistory: BiomarkerLog[] = [],
  localHistory: BiomarkerLog[] = [],
  deletedBioLogs: Record<string, number> = {}
): BiomarkerLog[] {
  const cleanDeletedMap = mergeDeleteMaps(deletedBioLogs);
  const bioMap = new Map<string, BiomarkerLog>();

  (localHistory || []).forEach(localItem => {
    if (!localItem || !localItem.id) return;
    const isDeleted = cleanDeletedMap[localItem.id] && cleanDeletedMap[localItem.id] >= (localItem.updated_at || 0);
    if (!isDeleted && localItem.sync_state !== 'delete') {
      bioMap.set(localItem.id, { ...localItem });
    }
  });

  (cloudHistory || []).forEach(cloudItem => {
    if (!cloudItem || !cloudItem.id) return;
    const isDeleted = cleanDeletedMap[cloudItem.id] && cleanDeletedMap[cloudItem.id] >= (cloudItem.updated_at || 0);
    if (isDeleted || cloudItem.sync_state === 'delete') {
      bioMap.delete(cloudItem.id);
      return;
    }

    const existingLocal = bioMap.get(cloudItem.id);
    if (!existingLocal) {
      bioMap.set(cloudItem.id, { ...cloudItem });
    } else {
      const localTime = existingLocal.updated_at || 0;
      const cloudTime = cloudItem.updated_at || 0;
      const localBios = existingLocal.biomarkers || {};
      const cloudBios = cloudItem.biomarkers || {};

      let mergedBiomarkers: Record<string, any>;
      if (localTime > cloudTime) {
        // Local is strictly newer: local's biomarkers object is authoritative.
        // (A union here previously let deleted/corrected keys reappear from
        // the older cloud copy on every sync.)
        mergedBiomarkers = { ...localBios };
        bioMap.set(cloudItem.id, {
          ...cloudItem,
          ...existingLocal,
          biomarkers: mergedBiomarkers,
          updated_at: localTime
        });
      } else if (cloudTime > localTime) {
        // Cloud is strictly newer: cloud's biomarkers object is authoritative.
        mergedBiomarkers = { ...cloudBios };
        bioMap.set(cloudItem.id, {
          ...existingLocal,
          ...cloudItem,
          biomarkers: mergedBiomarkers,
          updated_at: cloudTime
        });
      } else {
        // Equal timestamps (rare tie): keep the safer union so nothing is lost.
        mergedBiomarkers = { ...cloudBios, ...localBios };
        bioMap.set(cloudItem.id, {
          ...cloudItem,
          ...existingLocal,
          biomarkers: mergedBiomarkers,
          updated_at: localTime
        });
      }
    }
  });

  // Date-level consolidation to merge redundant duplicate logs on the exact same date
  const logsByDate = new Map<string, BiomarkerLog[]>();
  bioMap.forEach(log => {
    const d = toYYYYMMDD(log.date);
    if (!logsByDate.has(d)) logsByDate.set(d, []);
    logsByDate.get(d)!.push(log);
  });

  const consolidatedList: BiomarkerLog[] = [];
  logsByDate.forEach((group) => {
    if (group.length === 1) {
      consolidatedList.push(group[0]);
      return;
    }

    // Sort by updated_at descending (newest first)
    const sorted = [...group].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    const survivor = { ...sorted[0] };

    let finalBiomarkers: Record<string, any>;
    if (sorted.length > 1 && (sorted[0].updated_at || 0) === (sorted[1].updated_at || 0)) {
      const unionBios: Record<string, any> = {};
      for (let i = sorted.length - 1; i >= 0; i--) {
        Object.assign(unionBios, sorted[i].biomarkers || {});
      }
      finalBiomarkers = unionBios;
    } else {
      const survivorKeys = Object.keys(survivor.biomarkers || {});
      const isWearableOnly = survivorKeys.length === 1 && survivorKeys[0] === 'steps';
      if (isWearableOnly && sorted.length > 1) {
        const baseBios: Record<string, any> = {};
        for (let i = sorted.length - 1; i >= 1; i--) {
          Object.assign(baseBios, sorted[i].biomarkers || {});
        }
        finalBiomarkers = { ...baseBios, steps: survivor.biomarkers.steps };
      } else {
        finalBiomarkers = { ...(survivor.biomarkers || {}) };
      }
    }

    // Merge observationMeta if present
    const unionMeta: Record<string, any> = {};
    for (let i = sorted.length - 1; i >= 0; i--) {
      const meta = (sorted[i] as any).observationMeta;
      if (meta && typeof meta === 'object') {
        Object.assign(unionMeta, meta);
      }
    }

    // Preserve clinical notes if the survivor note is just an auto-sync note or empty
    let finalNote = survivor.note || '';
    if (!finalNote || finalNote.includes('Auto-synced from Google Fit') || finalNote.includes('Auto-logged default BMI')) {
      const clinicalLog = sorted.find(s => s.note && !s.note.includes('Auto-synced from Google Fit') && !s.note.includes('Auto-logged default BMI'));
      if (clinicalLog?.note) {
        finalNote = clinicalLog.note;
      }
    }

    // For any older duplicate IDs that are now absorbed into survivor, record into cleanDeletedMap and deletedBioLogs
    for (let i = 1; i < sorted.length; i++) {
      const dupId = sorted[i].id;
      if (dupId && dupId !== survivor.id) {
        const now = Date.now();
        cleanDeletedMap[dupId] = Math.max(cleanDeletedMap[dupId] || 0, now);
        if (deletedBioLogs && typeof deletedBioLogs === 'object') {
          deletedBioLogs[dupId] = Math.max(deletedBioLogs[dupId] || 0, now);
        }
      }
    }

    const consolidatedItem: any = {
      ...survivor,
      note: finalNote,
      biomarkers: finalBiomarkers
    };
    if (Object.keys(unionMeta).length > 0) {
      consolidatedItem.observationMeta = unionMeta;
    }

    consolidatedList.push(consolidatedItem);
  });

  return consolidatedList;
}



/* mergeBiomarkerHistory */
