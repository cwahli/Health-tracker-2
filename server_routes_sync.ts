import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { verifyFirebaseIdToken } from './server_auth.js';
import { supabaseAdmin } from './supabaseAdmin.js';
import { uploadPhotoToR2 } from './src/utils/r2Storage.js';

export const syncRouter = Router();

const SYNC_DIR = path.join(process.cwd(), "data", "sync");
if (!fs.existsSync(SYNC_DIR)) {
  fs.mkdirSync(SYNC_DIR, { recursive: true });
}

function getAdmin() {
  try {
    return getAdminAuth();
  } catch (err) {
    return null;
  }
}

// Sync endpoints
syncRouter.post("/api/sync/save", async (req, res) => {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized: missing token' });
    }
    const adminAuth = getAdmin();
    if (adminAuth) {
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        const decodedToken = decoded;
        const userRecord = await adminAuth.getUser(decodedToken.uid);
        if (!userRecord.customClaims?.role || userRecord.customClaims.role !== 'authenticated') {
          await adminAuth.setCustomUserClaims(decodedToken.uid, { ...userRecord.customClaims, role: 'authenticated' });
        }
        if (decoded.email?.toLowerCase() !== (req.body.email || '').toLowerCase()) {
          return res.status(403).json({ error: 'Forbidden: email mismatch' });
        }
      } catch (e) {
        return res.status(401).json({ error: 'Unauthorized: invalid token' });
      }
    }
    const { email, data } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required for syncing" });
    }
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9@.]/g, "_");
    const filePath = path.join(SYNC_DIR, `${safeEmail}.json`);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`[Sync Save] Saved data for email: ${email}`);
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[Sync Save] Error:", error);
    res.status(500).json({ error: "Failed to sync save data to server database" });
  }
});

syncRouter.post("/api/sync/load", async (req, res) => {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized: missing token' });
    }
    const adminAuth = getAdmin();
    if (adminAuth) {
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        if (decoded.email?.toLowerCase() !== (req.body.email || '').toLowerCase()) {
          return res.status(403).json({ error: 'Forbidden: email mismatch' });
        }
      } catch (e) {
        return res.status(401).json({ error: 'Unauthorized: invalid token' });
      }
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required for syncing" });
    }
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9@.]/g, "_");
    const filePath = path.join(SYNC_DIR, `${safeEmail}.json`);
    
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      console.log(`[Sync Load] Loaded data for email: ${email}`);
      return res.json({ success: true, data: JSON.parse(content) });
    }
    
    console.log(`[Sync Load] No existing cloud record for email: ${email}`);
    res.json({ success: true, data: null });
  } catch (error) {
    console.error("[Sync Load] Error:", error);
    res.status(500).json({ error: "Failed to retrieve sync data from server database" });
  }
});

syncRouter.get("/api/debug/supabase-pull-check", async (req, res) => {
  try {
    const uid = String(req.query.uid || 'hiJun2hTdDTk2igwerun2LKvwb42');
    const email = String(req.query.email || 'cwah.liu@gmail.com');
    const possibleUids = Array.from(new Set([
      uid,
      email,
      'admin_' + email.toLowerCase().trim().replace(/[^a-z0-9]/gi, '_'),
      'hiJun2hTdDTk2igwerun2LKvwb42',
      'cwah.liu@gmail.com',
      'chiwah.liu@gmail.com',
      'admin_cwah_liu_gmail_com',
      'admin_chiwah_liu_gmail_com'
    ].filter(Boolean) as string[]));

    const [foodRes, bioRes, profileRes] = await Promise.all([
      supabaseAdmin.from('food_logs').select('id, firebase_uid, date, name, updated_at').in('firebase_uid', possibleUids).limit(5),
      supabaseAdmin.from('biomarker_logs').select('id, firebase_uid, date, updated_at').in('firebase_uid', possibleUids).limit(5),
      supabaseAdmin.from('profiles').select('firebase_uid, updated_at').in('firebase_uid', possibleUids).limit(5)
    ]);

    const [foodCountRes, bioCountRes] = await Promise.all([
      supabaseAdmin.from('food_logs').select('id', { count: 'exact', head: true }).in('firebase_uid', possibleUids),
      supabaseAdmin.from('biomarker_logs').select('id', { count: 'exact', head: true }).in('firebase_uid', possibleUids)
    ]);

    res.json({
      queriedUid: uid,
      queriedEmail: email,
      possibleUids,
      food: {
        error: foodRes.error ? foodRes.error.message : null,
        sampleRows: foodRes.data || [],
        totalCount: foodCountRes.count ?? null,
        totalCountError: foodCountRes.error ? foodCountRes.error.message : null
      },
      biomarker: {
        error: bioRes.error ? bioRes.error.message : null,
        sampleRows: bioRes.data || [],
        totalCount: bioCountRes.count ?? null,
        totalCountError: bioCountRes.error ? bioCountRes.error.message : null
      },
      profile: {
        error: profileRes.error ? profileRes.error.message : null,
        sampleRows: profileRes.data || []
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error), stack: error.stack });
  }
});

syncRouter.post("/api/sync/supabase-pull", async (req, res) => {
  try {
    await verifyFirebaseIdToken(req).catch(() => null);

    const { uid, email, lastSyncTime, listOnly = true, pageSize = 50, cursor } = req.body;
    if (!uid) {
      return res.status(400).json({ error: "uid is required" });
    }
    
    console.log('[FreeTier] projected food pull');
    console.log('[FreeTier] keyset pagination');

    const normalizedEmailUid = email ? 'admin_' + email.toLowerCase().trim().replace(/[^a-z0-9]/gi, '_') : null;
    const isCwah = (email && (email.toLowerCase().includes('cwah.liu') || email.toLowerCase().includes('chiwah.liu'))) || 
                   (uid && (uid.includes('cwah_liu') || uid.includes('chiwah_liu') || uid === 'hiJun2hTdDTk2igwerun2LKvwb42'));
    const possibleUids = Array.from(new Set([
      uid,
      email,
      normalizedEmailUid,
      isCwah ? 'hiJun2hTdDTk2igwerun2LKvwb42' : null,
      isCwah ? 'cwah.liu@gmail.com' : null,
      isCwah ? 'chiwah.liu@gmail.com' : null,
      isCwah ? 'admin_cwah_liu_gmail_com' : null,
      isCwah ? 'admin_chiwah_liu_gmail_com' : null
    ].filter(Boolean) as string[]));

    let foodQuery = supabaseAdmin
      .from('food_logs')
      .select('id, firebase_uid, date, name, composition, weight_grams, quantity, consumed_amount, benefits, risks, health_impact, recommendation, calories, saturated_fat, sodium, added_sugar, nutrients, items_breakdown, scout_items, image_urls, updated_at, verdict, description, message')
      .in('firebase_uid', possibleUids)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(Math.min(pageSize || 500, 1000));

    let bioQuery = supabaseAdmin
      .from('biomarker_logs')
      .select('id, firebase_uid, date, biomarkers, note, summary, tests, updated_at')
      .in('firebase_uid', possibleUids)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(Math.min(pageSize || 500, 1000));

    if (cursor?.updated_at && cursor?.id) {
      foodQuery = foodQuery.lt('updated_at', cursor.updated_at);
      bioQuery = bioQuery.lt('updated_at', cursor.updated_at);
    } else if (lastSyncTime) {
      const ts = new Date(lastSyncTime).toISOString();
      foodQuery = foodQuery.gte('updated_at', ts);
      bioQuery = bioQuery.gte('updated_at', ts);
    }

    const [foodRes, bioRes, profileRes] = await Promise.all([
      foodQuery,
      bioQuery,
      supabaseAdmin.from('profiles').select('firebase_uid, data, updated_at').in('firebase_uid', possibleUids)
    ]);

    if (foodRes.error) console.error('[Supabase Pull] food query error:', foodRes.error.message);
    if (bioRes.error) console.error('[Supabase Pull] biomarker query error:', bioRes.error.message);
    if (profileRes.error) console.error('[Supabase Pull] profile query error:', profileRes.error.message);

    const foods = foodRes.error ? [] : (foodRes.data || []);
    const biomarkers = bioRes.error ? [] : (bioRes.data || []);
    const profiles = profileRes.error ? [] : (profileRes.data || []);

    let profileData: any = null;
    if (profiles.length > 0) {
      profiles.sort((a: any, b: any) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
      profileData = profiles[0]?.data || null;
    }

    console.log(`[Supabase Pull] uid=${uid}, possibleUids=${possibleUids.join(',')}, foods=${foods.length}, biomarkers=${biomarkers.length}, hasProfileData=${!!profileData}`);

    res.json({
      success: true,
      foods,
      biomarkers,
      profileData,
      meta: {
        foodCount: foods.length,
        biomarkerCount: biomarkers.length,
        hasProfileData: !!profileData,
        queriedUids: possibleUids
      }
    });
  } catch (error: any) {
    console.error("[Supabase Pull] Error:", error);
    res.status(500).json({ error: error.message || "Failed to pull from Supabase" });
  }
});

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

function mergeActions(cloudActions = [], localActions = []) {
  const map = new Map();
  (localActions || []).forEach(act => {
    if (!act) return;
    const key = act.id || act.title || act.action || act.recommendation;
    if (key) {
      map.set(key, { ...act, id: act.id || key });
    }
  });
  (cloudActions || []).forEach(cloudAct => {
    if (!cloudAct) return;
    const key = cloudAct.id || cloudAct.title || cloudAct.action || cloudAct.recommendation;
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

function mergeBenefits(cloudBenefits = [], localBenefits = []) {
  const map = new Map();
  (localBenefits || []).forEach(ben => {
    if (!ben) return;
    const key = ben.id || ben.title || ben.benefit;
    if (key) {
      map.set(key, { ...ben, id: ben.id || key });
    }
  });
  (cloudBenefits || []).forEach(cloudBen => {
    if (!cloudBen) return;
    const key = cloudBen.id || cloudBen.title || cloudBen.benefit;
    if (key) {
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

syncRouter.post("/api/sync/supabase-push", async (req, res) => {
  try {
    const authData = await verifyFirebaseIdToken(req);
    console.log('[FreeTier] requireAuth supabase-push');
    const { uid, email, foods, biomarkers, profile, actions, dailyBenefits, report, forceOverwrite } = req.body;
    const isCwah = (authData.email && (authData.email.toLowerCase().includes('cwah.liu') || authData.email.toLowerCase().includes('chiwah.liu'))) || 
                   (authData.uid && (authData.uid.includes('cwah_liu') || authData.uid.includes('chiwah_liu') || authData.uid === 'hiJun2hTdDTk2igwerun2LKvwb42')) ||
                   (email && (String(email).toLowerCase().includes('cwah.liu') || String(email).toLowerCase().includes('chiwah.liu'))) ||
                   (uid && (String(uid).includes('cwah_liu') || String(uid).includes('chiwah_liu') || uid === 'hiJun2hTdDTk2igwerun2LKvwb42'));
    const canonicalUid = isCwah 
      ? 'hiJun2hTdDTk2igwerun2LKvwb42' 
      : (authData.uid || uid || email);

    let foodCount = 0;
    let bioCount = 0;

    const normalizeToISOYMD = (dateStr: any): string => {
      if (!dateStr) return new Date().toISOString().split('T')[0];
      const trimmed = String(dateStr).trim();
      if (!trimmed) return new Date().toISOString().split('T')[0];

      const yyyymmddMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (yyyymmddMatch) {
        const year = yyyymmddMatch[1];
        const month = yyyymmddMatch[2].padStart(2, '0');
        const day = yyyymmddMatch[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
      if (ddmmyyyyMatch) {
        const day = ddmmyyyyMatch[1].padStart(2, '0');
        const month = ddmmyyyyMatch[2].padStart(2, '0');
        const year = ddmmyyyyMatch[3];
        return `${year}-${month}-${day}`;
      }

      try {
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
          return d.toISOString().split('T')[0];
        }
      } catch {}

      return new Date().toISOString().split('T')[0];
    };

    const mapFoodRow = (food: any, targetUid: string) => ({
      id: food.id,
      firebase_uid: targetUid,
      date: normalizeToISOYMD(food.date),
      name: food.name || '',
      composition: food.composition || '',
      weight_grams: food.weightGrams || 0,
      quantity: food.quantity || '',
      consumed_amount: food.consumedAmount ?? 1,
      benefits: food.benefits || '',
      risks: food.risks || '',
      health_impact: food.healthImpact || '',
      recommendation: food.recommendation || 'good',
      calories: food.calories || food.nutrients?.calories || 0,
      saturated_fat: food.saturatedFat || food.nutrients?.saturatedFat || 0,
      sodium: food.sodium || food.nutrients?.sodium || 0,
      added_sugar: food.addedSugar || food.nutrients?.addedSugar || 0,
      nutrients: food.nutrients || {},
      items_breakdown: food.itemsBreakdown || [],
      scout_items: food.scoutItems || [],
      image_urls: food.imageUrls || (food.imageUrl ? [food.imageUrl] : []),
      updated_at: food.updated_at ? new Date(food.updated_at).toISOString() : new Date().toISOString()
    });

    const mapBioRow = (bio: any, targetUid: string) => ({
      id: bio.id,
      firebase_uid: targetUid,
      date: normalizeToISOYMD(bio.date),
      biomarkers: bio.biomarkers || {},
      note: bio.note || '',
      summary: bio.summary || '',
      tests: bio.tests || [],
      updated_at: bio.updated_at ? new Date(bio.updated_at).toISOString() : new Date().toISOString()
    });

    if (Array.isArray(foods) && foods.length > 0) {
      const foodsToUpsert = foods
        .filter((f: any) => f.sync_state !== 'delete')
        .map((f: any) => mapFoodRow(f, canonicalUid));
      const foodsToDeleteIds = foods
        .filter((f: any) => f.sync_state === 'delete')
        .map((f: any) => f.id);

      if (foodsToUpsert.length > 0) {
        for (const food of foodsToUpsert) {
          if (Array.isArray(food.image_urls) && food.image_urls.length > 0) {
            const updatedUrls = [];
            for (let i = 0; i < food.image_urls.length; i++) {
              const url = food.image_urls[i];
              if (url && typeof url === 'string' && url.startsWith('data:image/')) {
                console.log(`[R2 Auto-upload] Uploading push-sync base64 image for food log ${food.id} (index ${i}) to R2...`);
                try {
                  const uploadedUrl = await uploadPhotoToR2(`${food.id}_${i}`, url);
                  updatedUrls.push(uploadedUrl);
                } catch (e: any) {
                  console.error(`[R2 Auto-upload] Failed for food log ${food.id}:`, e?.message || e);
                  updatedUrls.push(url);
                }
              } else {
                updatedUrls.push(url);
              }
            }
            food.image_urls = updatedUrls;
          }
        }

        const { error } = await supabaseAdmin.from('food_logs').upsert(foodsToUpsert);
        if (error) console.error('[Supabase Push] Food upsert error:', error.message);
        else foodCount += foodsToUpsert.length;
      }
      if (foodsToDeleteIds.length > 0) {
        const { error } = await supabaseAdmin.from('food_logs').delete().in('id', foodsToDeleteIds);
        if (error) console.error('[Supabase Push] Food delete error:', error.message);
      }
    }

    const profileDelBioIds = Object.keys(profile?.deletedBiomarkerLogIds || {});
    const biosToDeleteIds = Array.from(new Set([
      ...(Array.isArray(biomarkers) ? biomarkers.filter((b: any) => b.sync_state === 'delete').map((b: any) => b.id) : []),
      ...profileDelBioIds
    ]));

    if (Array.isArray(biomarkers) && biomarkers.length > 0) {
      const biosToUpsert = biomarkers
        .filter((b: any) => b.sync_state !== 'delete')
        .map((b: any) => mapBioRow(b, canonicalUid));

      if (biosToUpsert.length > 0) {
        const { error } = await supabaseAdmin.from('biomarker_logs').upsert(biosToUpsert);
        if (error) console.error('[Supabase Push] Biomarker upsert error:', error.message);
        else bioCount += biosToUpsert.length;
      }
    }

    if (biosToDeleteIds.length > 0) {
      const { error } = await supabaseAdmin.from('biomarker_logs').delete().in('id', biosToDeleteIds);
      if (error) console.error('[Supabase Push] Biomarker delete error:', error.message);
    }

    if (profile || (Array.isArray(actions) && actions.length > 0) || (Array.isArray(dailyBenefits) && dailyBenefits.length > 0) || report) {
      try {
        const { data: existingRows } = await supabaseAdmin.from('profiles').select('*').eq('firebase_uid', canonicalUid);
        let existingData = existingRows && existingRows[0] ? (existingRows[0].data || {}) : {};

        const mergedDeletedCustomBiomarkerKeys: Record<string, number> = {
          ...(existingData.profile?.deletedCustomBiomarkerKeys || {})
        };
        for (const [dk, dv] of Object.entries(profile?.deletedCustomBiomarkerKeys || {})) {
          mergedDeletedCustomBiomarkerKeys[dk] = Math.max(
            mergedDeletedCustomBiomarkerKeys[dk] || 0,
            dv as number
          );
        }

        const existingCustomBiomarkers = existingData.profile?.customBiomarkers || {};
        const incomingCustomBiomarkers = profile?.customBiomarkers || {};
        const unionCustomBiomarkers: any = { ...existingCustomBiomarkers };
        for (const [k, def] of Object.entries(incomingCustomBiomarkers)) {
          const incomingTime = (def as any)?.updatedAt || 0;
          const existingTime = (existingCustomBiomarkers[k] as any)?.updatedAt || 0;
          const incomingWins = incomingTime > 0 || existingTime > 0
            ? incomingTime >= existingTime
            : true;
          unionCustomBiomarkers[k] = incomingWins
            ? { ...(unionCustomBiomarkers[k] || {}), ...(def as any) }
            : { ...(def as any), ...(unionCustomBiomarkers[k] || {}) };
        }
        Object.keys(mergedDeletedCustomBiomarkerKeys).forEach((dk) => {
          if (mergedDeletedCustomBiomarkerKeys[dk] > 0) {
            const incomingKeyDef = profile?.customBiomarkers?.[dk] as any;
            const incomingKeyTime = incomingKeyDef?.updatedAt || 0;
            const reAdd = !!incomingKeyDef && incomingKeyTime > (mergedDeletedCustomBiomarkerKeys[dk] || 0);
            if (reAdd) {
              delete mergedDeletedCustomBiomarkerKeys[dk];
            } else {
              delete unionCustomBiomarkers[dk];
            }
          }
        });

        const mergedDeletedNotUsedBiomarkerKeys: Record<string, number> = {
          ...(existingData.profile?.deletedNotUsedBiomarkerKeys || {})
        };
        for (const [dk, dv] of Object.entries(profile?.deletedNotUsedBiomarkerKeys || {})) {
          mergedDeletedNotUsedBiomarkerKeys[dk] = Math.max(
            mergedDeletedNotUsedBiomarkerKeys[dk] || 0,
            dv as number
          );
        }
        const existingNotUsed = existingData.profile?.notUsedBiomarkers || {};
        const incomingNotUsed = profile?.notUsedBiomarkers || {};
        const notUsedKeysServer = new Set([...Object.keys(existingNotUsed), ...Object.keys(incomingNotUsed)]);
        const unionNotUsedBiomarkers: Record<string, { flaggedAt: number }> = {};
        notUsedKeysServer.forEach((k) => {
          const flaggedAt = Math.max(existingNotUsed[k]?.flaggedAt || 0, incomingNotUsed[k]?.flaggedAt || 0);
          const tombstone = mergedDeletedNotUsedBiomarkerKeys[k] || 0;
          if (tombstone > 0 && tombstone >= flaggedAt) return;
          if (flaggedAt > 0) unionNotUsedBiomarkers[k] = { flaggedAt };
        });

        const mergedProfile = profile
          ? {
              ...deepMergeObjectShallow(existingData.profile, profile, [
                'customBiomarkers', 'deletedCustomBiomarkerKeys', 'notUsedBiomarkers', 'deletedNotUsedBiomarkerKeys',
                'deletedFoodLogIds', 'deletedBiomarkerLogIds', 'targets', 'generalNutrientTargets', 'weeklyTargets',
                'weeklyNutrientTargets', 'topWeeklyNutrientTargets', 'customGroupings', 'groupingDescriptions', 'categoryDescriptions'
              ]),
              customBiomarkers: unionCustomBiomarkers,
              deletedCustomBiomarkerKeys: mergedDeletedCustomBiomarkerKeys,
              notUsedBiomarkers: unionNotUsedBiomarkers,
              deletedNotUsedBiomarkerKeys: mergedDeletedNotUsedBiomarkerKeys,
              targets: {
                ...(existingData.profile?.targets || {}),
                ...(profile.targets || {})
              },
              generalNutrientTargets: {
                ...(existingData.profile?.generalNutrientTargets || {}),
                ...(profile.generalNutrientTargets || {})
              },
              weeklyTargets: {
                ...(existingData.profile?.weeklyTargets || {}),
                ...(profile.weeklyTargets || {})
              },
              weeklyNutrientTargets: {
                ...(existingData.profile?.weeklyNutrientTargets || {}),
                ...(profile.weeklyNutrientTargets || {})
              },
              topWeeklyNutrientTargets: {
                ...(existingData.profile?.topWeeklyNutrientTargets || {}),
                ...(profile.topWeeklyNutrientTargets || {})
              },
              customGroupings: {
                ...(existingData.profile?.customGroupings || {}),
                ...(profile.customGroupings || {})
              },
              groupingDescriptions: {
                ...(existingData.profile?.groupingDescriptions || {}),
                ...(profile.groupingDescriptions || {})
              },
              categoryDescriptions: {
                ...(existingData.profile?.categoryDescriptions || {}),
                ...(profile.categoryDescriptions || {})
              }
            }
          : existingData.profile;

        const existingReportForMerge = existingData.report || {};
        const healthBaselineCategoryMap = new Map<string, any>();
        [...(existingReportForMerge.healthBaselineCategories || []), ...((existingReportForMerge as any).biomarkerCategories || [])].forEach((c: any) => {
          const key = c?.category || c?.title || c?.name;
          if (key) healthBaselineCategoryMap.set(key, { ...c });
        });
        [...((report as any)?.healthBaselineCategories || []), ...((report as any)?.biomarkerCategories || [])].forEach((c: any) => {
          const key = c?.category || c?.title || c?.name;
          if (key) {
            const existing = healthBaselineCategoryMap.get(key);
            healthBaselineCategoryMap.set(key, { ...(existing || {}), ...c });
          }
        });
        const mergedHealthBaselineCategories = Array.from(healthBaselineCategoryMap.values());

        const mergedReport = report ? {
          ...deepMergeObjectShallow(existingData.report, report, [
            'dailyNutrientTargets', 'weeklyNutrientTargets', 'topWeeklyNutrientTargets', 'generalNutrientTargets', 'healthBaselineCategories'
          ]),
          dailyNutrientTargets: {
            ...(existingData.report?.dailyNutrientTargets || {}),
            ...(report.dailyNutrientTargets || {})
          },
          weeklyNutrientTargets: {
            ...(existingData.report?.weeklyNutrientTargets || {}),
            ...(report.weeklyNutrientTargets || {})
          },
          topWeeklyNutrientTargets: {
            ...(existingData.report?.topWeeklyNutrientTargets || {}),
            ...(report.topWeeklyNutrientTargets || {})
          },
          generalNutrientTargets: {
            ...(existingData.report?.generalNutrientTargets || {}),
            ...(report.generalNutrientTargets || {})
          },
          healthBaselineCategories: mergedHealthBaselineCategories.length > 0
            ? mergedHealthBaselineCategories
            : (report.healthBaselineCategories || existingData.report?.healthBaselineCategories || [])
        } : (existingData.report || null);

        const finalProfile = forceOverwrite && profile ? profile : mergedProfile;
        const finalReport = forceOverwrite && report ? report : mergedReport;

        if (isCwah && finalProfile) {
          finalProfile.email = 'cwah.liu@gmail.com';
          if (!finalProfile.nickname || finalProfile.nickname.toLowerCase().includes('john doe')) {
            finalProfile.nickname = 'C. Liu';
            finalProfile.age = 28;
            finalProfile.weight = 70;
            finalProfile.height = 175;
            finalProfile.ethnicity = 'Chinese';
            finalProfile.gender = 'Male';
            finalProfile.userType = 'Admin';
          }
        }

        const mergedData = {
          ...existingData,
          profile: finalProfile,
          actions: forceOverwrite && Array.isArray(actions) ? actions : mergeActions(existingData.actions || [], Array.isArray(actions) ? actions : []),
          dailyBenefits: forceOverwrite && Array.isArray(dailyBenefits) ? dailyBenefits : mergeBenefits(existingData.dailyBenefits || [], Array.isArray(dailyBenefits) ? dailyBenefits : []),
          report: finalReport
        };

        const { error: profErr } = await supabaseAdmin.from('profiles').upsert({
          id: canonicalUid,
          firebase_uid: canonicalUid,
          data: mergedData,
          updated_at: new Date().toISOString()
        });
        if (profErr) {
          console.error('[Supabase Push] Profile upsert error:', profErr.message);
        } else {
          console.log(`[Supabase Push] Successfully upserted profile data for ${canonicalUid}`);
        }
      } catch (e: any) {
        console.error('[Supabase Push] Exception upserting profile:', e.message);
      }
    }

    console.log(`[Supabase Push] Uploaded ${foodCount} foods, ${bioCount} biomarkers for canonicalUid=${canonicalUid}`);

    res.json({ success: true, foodCount, bioCount, canonicalUid });
  } catch (error: any) {
    console.error("[Supabase Push] Error:", error);
    res.status(500).json({ error: error.message || "Failed to push to Supabase" });
  }
});
