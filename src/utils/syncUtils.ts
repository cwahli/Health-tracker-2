import { doc, getDoc, setDoc, collection, getDocs, Firestore } from 'firebase/firestore';
import { FoodLog, BiomarkerLog } from '../types';
import { toYYYYMMDD } from './dateUtils';
import { sanitizeForFirestore } from './firestoreUtils';

export const toYYYYMM = (dateStr: string): string => {
  if (!dateStr) return 'unknown';
  const parts = dateStr.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}_${parts[1]}`;
  }
  return 'unknown';
};

export const syncLogsWithTimeBuckets = async (
  db: Firestore, 
  uid: string, 
  localFoods: FoodLog[], 
  localBiomarkers: BiomarkerLog[],
  onSyncComplete: (syncedFoods: FoodLog[], syncedBiomarkers: BiomarkerLog[]) => void
) => {
  const unsyncedFoods = localFoods.filter(f => f.sync_state && f.sync_state !== 'synced');
  const unsyncedBiomarkers = localBiomarkers.filter(b => b.sync_state && b.sync_state !== 'synced');
  
  if (unsyncedFoods.length === 0 && unsyncedBiomarkers.length === 0) {
    return;
  }

  const bucketsToSync = new Set<string>();
  unsyncedFoods.forEach(f => bucketsToSync.add(toYYYYMM(f.date)));
  unsyncedBiomarkers.forEach(b => bucketsToSync.add(toYYYYMM(b.date)));

  const updatedLocalFoods = [...localFoods];
  const updatedLocalBiomarkers = [...localBiomarkers];

  for (const monthBucket of bucketsToSync) {
    const bucketRef = doc(db, 'users', uid, 'consolidated_logs', monthBucket);
    
    const monthUnsyncedFoods = unsyncedFoods.filter(f => toYYYYMM(f.date) === monthBucket);
    const monthUnsyncedBiomarkers = unsyncedBiomarkers.filter(b => toYYYYMM(b.date) === monthBucket);

    try {
      const bucketDoc = await getDoc(bucketRef);
      
      let serverData: any = { month: monthBucket, logs: {}, last_sync_timestamp: Date.now() };
      if (bucketDoc.exists()) {
        serverData = bucketDoc.data();
      }

      let changed = false;

      const processItem = (item: any, type: 'food' | 'biomarker') => {
        const serverItem = serverData.logs[item.id];
        
        if (item.sync_state === 'delete') {
          if (!serverItem || (item.updated_at || 0) >= (serverItem.updated_at || 0)) {
            delete serverData.logs[item.id];
            changed = true;
          }
        } else {
          if (!serverItem || (item.updated_at || 0) >= (serverItem.updated_at || 0)) {
            // Store basic types. Keep images out of here to save space
            const dataToSave = { ...item };
            delete dataToSave.imageUrl;
            delete dataToSave.imageUrls;
            
            // Clean up chat transcript to avoid exceeding Firestore 1MB document limit
            if (dataToSave.chatTranscript && Array.isArray(dataToSave.chatTranscript)) {
              const rawTranscript = dataToSave.chatTranscript;
              const sliced = rawTranscript.slice(-15);
              dataToSave.chatTranscript = sliced.map((msg: any) => ({
                role: msg.role,
                content: typeof msg.content === 'string' && msg.content.length > 5000 
                  ? msg.content.substring(0, 5000) + '... [truncated for storage]'
                  : msg.content,
                timestamp: msg.timestamp || ''
              }));
            }
            
            serverData.logs[item.id] = { type, data: dataToSave, updated_at: item.updated_at || Date.now() };
            changed = true;
          }
        }
      };

      monthUnsyncedFoods.forEach(f => processItem(f, 'food'));
      monthUnsyncedBiomarkers.forEach(b => processItem(b, 'biomarker'));

      if (changed) {
        serverData.last_sync_timestamp = Date.now();
        await setDoc(bucketRef, sanitizeForFirestore(serverData));
      }
      
      // Process food updates: mark synced
      const syncedFoodIds = new Set(monthUnsyncedFoods.filter(f => f.sync_state !== 'delete').map(f => f.id));
      const deletedFoodIds = new Set(monthUnsyncedFoods.filter(f => f.sync_state === 'delete').map(f => f.id));

      for (let i = updatedLocalFoods.length - 1; i >= 0; i--) {
        if (deletedFoodIds.has(updatedLocalFoods[i].id)) {
          updatedLocalFoods.splice(i, 1);
        } else if (syncedFoodIds.has(updatedLocalFoods[i].id)) {
          updatedLocalFoods[i] = { ...updatedLocalFoods[i], sync_state: 'synced' };
        }
      }

      // Process biomarker updates: mark synced
      const syncedBioIds = new Set(monthUnsyncedBiomarkers.filter(b => b.sync_state !== 'delete').map(b => b.id));
      const deletedBioIds = new Set(monthUnsyncedBiomarkers.filter(b => b.sync_state === 'delete').map(b => b.id));

      for (let i = updatedLocalBiomarkers.length - 1; i >= 0; i--) {
        if (deletedBioIds.has(updatedLocalBiomarkers[i].id)) {
          updatedLocalBiomarkers.splice(i, 1);
        } else if (syncedBioIds.has(updatedLocalBiomarkers[i].id)) {
          updatedLocalBiomarkers[i] = { ...updatedLocalBiomarkers[i], sync_state: 'synced' };
        }
      }

    } catch (err) {
      console.error(`Sync failed for bucket ${monthBucket}:`, err);
    }
  }
  
  onSyncComplete(updatedLocalFoods.filter(f => f.sync_state !== 'delete'), updatedLocalBiomarkers.filter(b => b.sync_state !== 'delete'));
};

export const fetchAllConsolidatedLogs = async (db: Firestore, uid: string) => {
  const bucketsSnap = await getDocs(collection(db, 'users', uid, 'consolidated_logs'));
  
  let serverFoods: FoodLog[] = [];
  let serverBiomarkers: BiomarkerLog[] = [];
  
  bucketsSnap.docs.forEach(docSnap => {
    const data = docSnap.data();
    if (data && data.logs) {
      Object.values(data.logs).forEach((logInfo: any) => {
        if (logInfo.type === 'food') {
          serverFoods.push({ ...logInfo.data, sync_state: 'synced' });
        } else if (logInfo.type === 'biomarker') {
          serverBiomarkers.push({ ...logInfo.data, sync_state: 'synced' });
        }
      });
    }
  });

  return { serverFoods, serverBiomarkers };
};
