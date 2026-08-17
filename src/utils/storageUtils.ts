import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import { UserProfile, FoodLog, BiomarkerLog, HealthAction, DailyBenefit, RecommendationReport, FoodIdea } from '../types';
import { migrateMealSchema } from '../mealBuild';

export const pruneLocalStorageToFreeSpace = () => {
  try {
    localStorage.removeItem('agent1_batch_results');
    localStorage.removeItem('batch_analysis_results');
    // DO NOT remove 'agent_request_logs' here; it is safely managed by agentLogsTracker and needed for the log viewer filter
    localStorage.removeItem('local_api_events');
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        if (key.startsWith('health_cockpit_snapshots_')) {
          try {
            const snaps = JSON.parse(localStorage.getItem(key) || '[]');
            if (snaps.length > 1) {
              localStorage.setItem(key, JSON.stringify(snaps.slice(0, 1)));
            }
          } catch {}
        } else if (key.startsWith('health_cockpit_app_data_')) {
          // DO NOT delete imageUrl or imageUrls from app data!
          // If localStorage is full, remove key from localStorage so get() seamlessly uses high-capacity IndexedDB.
          try {
            localStorage.removeItem(key);
          } catch {}
        } else if (key.startsWith('chat_messages_') || key.startsWith('chat_payload_')) {
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    // Silent catch - IndexedDB holds primary authority
  }
};

export const get = async (key: string): Promise<any> => {
  const isHeavyKey = key.startsWith('health_cockpit_app_data_') || key.startsWith('health_cockpit_snapshots_');
  try {
    const result = await Promise.race([
      idbGet(key),
      new Promise((_, reject) => setTimeout(() => reject(new Error("IndexedDB timeout")), 8000))
    ]);
    if (result !== undefined) {
      return result;
    }
    // Fall back to localStorage if IDB doesn't have it or returned undefined
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : undefined;
  } catch (e) {
    console.log("get timeout/error (falling back to localStorage):", e);
    if (typeof window !== 'undefined') (window as any)._idbFailed = true;
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : undefined;
    } catch {
      return undefined;
    }
  }
};

export const sanitizeForIdb = (val: any): any => {
  try {
    return JSON.parse(JSON.stringify(val, (key, value) => {
      if (typeof value === 'function' || typeof value === 'symbol') return undefined;
      if (value && typeof value === 'object' && (value instanceof Element || value instanceof HTMLElement || value.$$typeof)) return undefined;
      return value;
    }));
  } catch (e) {
    try {
      const cleanObj: any = Array.isArray(val) ? [] : {};
      for (const k of Object.keys(val || {})) {
        if (typeof val[k] !== 'function' && typeof val[k] !== 'symbol') {
          cleanObj[k] = val[k];
        }
      }
      return cleanObj;
    } catch {
      return val;
    }
  }
};

export const safeIdbSet = async (key: string, val: any): Promise<void> => {
  const sanitized = sanitizeForIdb(val);
  await idbSet(key, sanitized);
};

export const set = async (key: string, val: any): Promise<void> => {
  const isHeavyKey = key.startsWith('health_cockpit_app_data_') || key.startsWith('health_cockpit_snapshots_');
  
  if (!isHeavyKey) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  }
  
  try {
    await Promise.race([
      safeIdbSet(key, val),
      new Promise((_, reject) => setTimeout(() => reject(new Error("IndexedDB timeout")), 8000))
    ]);
    if (typeof window !== 'undefined') (window as any)._idbFailed = false;
    // On success, clean up localStorage for heavy keys to save quota
    if (isHeavyKey) {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  } catch (idbError) {
    console.warn("IndexedDB set failed once, retrying:", idbError);
    try {
      await Promise.race([
        safeIdbSet(key, val),
        new Promise((_, reject) => setTimeout(() => reject(new Error("IndexedDB timeout (retry)")), 8000))
      ]);
      if (typeof window !== 'undefined') (window as any)._idbFailed = false;
      if (isHeavyKey) {
        try {
          localStorage.removeItem(key);
        } catch {}
      }
    } catch (retryError) {
      console.error("IndexedDB set failed twice, giving up on this write:", retryError);
      if (typeof window !== 'undefined') (window as any)._idbFailed = true;
      // Fallback to localStorage for heavy keys if they fit within quota
      if (isHeavyKey) {
        try {
          const stringified = JSON.stringify(val);
          if (stringified.length < 4.5 * 1024 * 1024) {
            localStorage.setItem(key, stringified);
          }
        } catch (e) {
          console.error("localStorage fallback failed:", e);
        }
      }
    }
  }
};

export const getStorageKey = (email?: string | null, fallbackEmail?: string | null) => {
  let norm = (email || fallbackEmail || 'guest').toLowerCase().trim();
  if (norm.includes('cwah.liu') || norm.includes('chiwah.liu') || norm.includes('admin_cwah_liu') || norm.includes('admin_chiwah_liu')) {
    norm = 'cwah.liu@gmail.com';
  }
  return `health_cockpit_app_data_${norm}`;
};

export const getSnapshotKey = (email?: string | null, fallbackEmail?: string | null) => {
  let norm = (email || fallbackEmail || 'guest').toLowerCase().trim();
  if (norm.includes('cwah.liu') || norm.includes('chiwah.liu') || norm.includes('admin_cwah_liu') || norm.includes('admin_chiwah_liu')) {
    norm = 'cwah.liu@gmail.com';
  }
  return `health_cockpit_snapshots_${norm}`;
};

export const MAX_SNAPSHOTS = 5;

export const saveLocalSnapshot = async (
  label: string,
  email: string | null | undefined,
  bundle: {
    profile: any;
    foodLogs: any[];
    biomarkers: Record<string, any>;
    biomarkerHistory: any[];
    actions?: any[];
    dailyBenefits?: any[];
    report?: any;
  },
  fallbackEmail?: string | null
) => {
  try {
    const key = getSnapshotKey(email, fallbackEmail);
    let existing: any[] = [];
    try {
      existing = (await get(key)) || [];
    } catch {}

    const lightFoodLogs = (bundle.foodLogs || []).map((f: any) => {
      if (!f.imageUrl || !f.imageUrl.startsWith('data:image/')) return f;
      return { ...f, imageUrl: '[image_removed_for_snapshot]' };
    });

    const snapshot = {
      id: `snap_${Date.now()}`,
      timestamp: new Date().toISOString(),
      label,
      data: {
        profile: bundle.profile,
        foodLogs: lightFoodLogs,
        biomarkers: bundle.biomarkers,
        biomarkerHistory: bundle.biomarkerHistory,
        actions: bundle.actions || [],
        dailyBenefits: bundle.dailyBenefits || [],
        report: bundle.report || null
      }
    };

    const updated = [snapshot, ...existing].slice(0, MAX_SNAPSHOTS);
    await set(key, updated);
    return true;
  } catch (e) {
    console.warn('[Snapshot] Could not save snapshot:', e);
    return false;
  }
};

export const loadLocalSnapshots = async (email?: string | null, fallbackEmail?: string | null): Promise<any[]> => {
  try {
    return (await get(getSnapshotKey(email, fallbackEmail))) || [];
  } catch { return []; }
};

export const deleteLocalSnapshot = async (email: string | null | undefined, id: string, fallbackEmail?: string | null) => {
  try {
    const key = getSnapshotKey(email, fallbackEmail);
    const existing = await loadLocalSnapshots(email, fallbackEmail);
    await set(key, existing.filter((s: any) => s.id !== id));
  } catch (e) {}
};

export const safeSaveToLocalStorage = async (key: string, bundle: any) => {
  try {
    const existing = await get(key) || {};
    const mergedBundle = {
      ...bundle,
      lastSyncedAt: bundle.lastSyncedAt !== undefined ? bundle.lastSyncedAt : existing.lastSyncedAt
    };
    await set(key, mergedBundle);
  } catch (e) {
    console.error("Failed to save to IndexedDB:", e);
  }
};

/**
 * Retrieves app data for the current user.
 * If the primary key has food logs, returns it directly — no legacy merging.
 * Only performs a one-time migration from legacy keys if the primary key has 0 food logs.
 * This prevents deleted/old items from legacy keys from being continuously resurrected.
 */
export const getAggregatedAppData = async (email?: string | null): Promise<any> => {
  const primaryKey = getStorageKey(email);
  const primaryData = (await get(primaryKey)) || {};

  const hasPrimaryFoods = Array.isArray(primaryData.foodLogs) && primaryData.foodLogs.length > 0;
  const hasPrimaryBio = Array.isArray(primaryData.biomarkerHistory) && primaryData.biomarkerHistory.length > 0;
  const hasPrimaryProfile = !!primaryData.profile;

  // If primary key has food logs, biomarker history, or profile, trust it completely — do NOT merge legacy keys.
  if (hasPrimaryFoods || hasPrimaryBio || hasPrimaryProfile) {
    const migratedFoods = (primaryData.foodLogs || []).map((f: any) => {
      if (f.mealBuild) return { ...f, mealBuild: migrateMealSchema(f.mealBuild) };
      return f;
    });
    return { ...primaryData, foodLogs: migratedFoods };
  }

  // One-time migration: primary key is empty or missing data, check legacy and guest keys and migrate their data in.
  const legacyKey = 'health_cockpit_app_data';
  const guestKey = 'health_cockpit_app_data_guest';

  const legacyData = (await get(legacyKey)) || {};
  const guestData = (await get(guestKey)) || {};

  const legacyFoods: any[] = legacyData.foodLogs || [];
  const guestFoods: any[] = guestData.foodLogs || [];
  const legacyBio: any[] = legacyData.biomarkerHistory || [];
  const guestBio: any[] = guestData.biomarkerHistory || [];

  if (legacyFoods.length === 0 && guestFoods.length === 0 && legacyBio.length === 0 && guestBio.length === 0) {
    return primaryData;
  }

  // Merge legacy and guest foods, preserving base64 images
  const allLogsMap = new Map<string, any>();
  const addLogs = (logs: any[]) => {
    logs.forEach(log => {
      if (!log || !log.id) return;
      const existing = allLogsMap.get(log.id);
      if (!existing) {
        allLogsMap.set(log.id, log);
      } else {
        const existingHasImg = existing.imageUrl && existing.imageUrl !== '[image_removed_for_snapshot]';
        const logHasImg = log.imageUrl && log.imageUrl !== '[image_removed_for_snapshot]';
        allLogsMap.set(log.id, {
          ...existing,
          ...log,
          imageUrl: logHasImg ? log.imageUrl : (existingHasImg ? existing.imageUrl : log.imageUrl),
          imageUrls: (log.imageUrls && log.imageUrls.length > 0) ? log.imageUrls : existing.imageUrls
        });
      }
    });
  };

  addLogs(hasPrimaryFoods ? primaryData.foodLogs : []);
  addLogs(legacyFoods);
  addLogs(guestFoods);

  const migratedFoods = Array.from(allLogsMap.values()).filter((f: any) => f.sync_state !== 'delete');

  // Merge biomarker history
  const bioMap = new Map<string, any>();
  const addBio = (logs: any[]) => {
    logs.forEach(log => {
      if (!log || !log.id) return;
      if (!bioMap.has(log.id)) bioMap.set(log.id, log);
    });
  };
  addBio(hasPrimaryBio ? primaryData.biomarkerHistory : []);
  addBio(legacyBio);
  addBio(guestBio);

  const migratedBio = Array.from(bioMap.values()).filter((b: any) => b.sync_state !== 'delete');

  const mergedBiomarkers = {
    ...(legacyData.biomarkers || {}),
    ...(guestData.biomarkers || {}),
    ...(primaryData.biomarkers || {})
  };

  const primaryEmail = email;
  const rawProfile = primaryData?.profile || guestData?.profile || legacyData?.profile || null;
  let cleanProfile = rawProfile ? { ...rawProfile } : null;
  const isCwah = (primaryEmail && (primaryEmail.includes('cwah.liu') || primaryEmail.includes('chiwah.liu'))) ||
                 (cleanProfile?.email && (cleanProfile.email.includes('cwah.liu') || cleanProfile.email.includes('chiwah.liu') || cleanProfile.email.includes('john@mail.com') || cleanProfile.email.includes('john@gmail.com'))) ||
                 (cleanProfile?.nickname && cleanProfile.nickname.toLowerCase().includes('john doe'));

  if (isCwah) {
    cleanProfile = {
      ...(cleanProfile || {}),
      email: 'cwah.liu@gmail.com',
      nickname: 'C. Liu',
      age: 28,
      ethnicity: 'Chinese',
      weight: 70,
      height: 175,
      gender: 'Male',
      userType: 'Admin'
    };
  }

  console.log(`[Storage] One-time migration: merging ${migratedFoods.length} food logs and ${migratedBio.length} biomarker logs from guest/legacy into primary key.`);

  // Once migrated into primary key, clear legacy and guest stores so they are never continuously merged again
  try {
    localStorage.removeItem(legacyKey);
    localStorage.removeItem(guestKey);
    await idbDel(legacyKey).catch(() => {});
    await idbDel(guestKey).catch(() => {});
  } catch {}

  return {
    ...legacyData,
    ...guestData,
    ...primaryData,
    profile: cleanProfile,
    foodLogs: migratedFoods,
    biomarkerHistory: migratedBio,
    biomarkers: mergedBiomarkers
  };
};
