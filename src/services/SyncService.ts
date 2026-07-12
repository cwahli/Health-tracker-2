import { collection, doc, runTransaction, getDocs, Firestore, setDoc } from 'firebase/firestore';
import { FoodLog, BiomarkerLog, SyncState } from '../types';
import { sanitizeForFirestore } from '../utils/firestoreUtils';

export const toYYYYMM = (dateStr: string): string => {
  if (!dateStr) return 'unknown';
  const parts = dateStr.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}_${parts[1]}`;
  }
  return 'unknown';
};

export class SyncService {
  static async syncLogs(db: Firestore, uid: string, localFoods: FoodLog[], localBiomarkers: BiomarkerLog[], onSyncComplete: (syncedFoods: FoodLog[], syncedBiomarkers: BiomarkerLog[]) => void) {
    // 1. Identify Unsynced Local Data
    const unsyncedFoods = localFoods.filter(f => f.sync_state && f.sync_state !== 'synced');
    const unsyncedBiomarkers = localBiomarkers.filter(b => b.sync_state && b.sync_state !== 'synced');
    
    if (unsyncedFoods.length === 0 && unsyncedBiomarkers.length === 0) {
      // Nothing to sync from local. We can just pull from server.
      await this.pullFromServer(db, uid, localFoods, localBiomarkers, onSyncComplete);
      return;
    }

    const bucketsToSync = new Set<string>();
    unsyncedFoods.forEach(f => bucketsToSync.add(toYYYYMM(f.date)));
    unsyncedBiomarkers.forEach(b => bucketsToSync.add(toYYYYMM(b.date)));

    const updatedLocalFoods = [...localFoods];
    const updatedLocalBiomarkers = [...localBiomarkers];

    // 2. Execute Firebase Transaction (Per Month)
    for (const monthBucket of bucketsToSync) {
      const bucketRef = doc(db, 'users', uid, 'consolidated_logs', monthBucket);
      
      const monthUnsyncedFoods = unsyncedFoods.filter(f => toYYYYMM(f.date) === monthBucket);
      const monthUnsyncedBiomarkers = unsyncedBiomarkers.filter(b => toYYYYMM(b.date) === monthBucket);

      try {
        await runTransaction(db, async (transaction) => {
          const bucketDoc = await transaction.get(bucketRef);
          
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
                serverData.logs[item.id] = { type, data: item, updated_at: item.updated_at || Date.now() };
                changed = true;
              }
            }
          };

          monthUnsyncedFoods.forEach(f => processItem(f, 'food'));
          monthUnsyncedBiomarkers.forEach(b => processItem(b, 'biomarker'));

          if (changed) {
            serverData.last_sync_timestamp = Date.now();
            transaction.set(bucketRef, sanitizeForFirestore(serverData));
          }
        });
        
        // 3. Cleanup Local State for this bucket on success
        monthUnsyncedFoods.forEach(f => {
          const idx = updatedLocalFoods.findIndex(uf => uf.id === f.id);
          if (idx !== -1) {
            if (f.sync_state === 'delete') {
              updatedLocalFoods.splice(idx, 1);
            } else {
              updatedLocalFoods[idx] = { ...f, sync_state: 'synced' };
            }
          }
        });
        monthUnsyncedBiomarkers.forEach(b => {
          const idx = updatedLocalBiomarkers.findIndex(ub => ub.id === b.id);
          if (idx !== -1) {
            if (b.sync_state === 'delete') {
              updatedLocalBiomarkers.splice(idx, 1);
            } else {
              updatedLocalBiomarkers[idx] = { ...b, sync_state: 'synced' };
            }
          }
        });

      } catch (err) {
        console.error(`Transaction failed for bucket ${monthBucket}:`, err);
      }
    }
    
    await this.pullFromServer(db, uid, updatedLocalFoods, updatedLocalBiomarkers, onSyncComplete);
  }

  static async pullFromServer(db: Firestore, uid: string, localFoods: FoodLog[], localBiomarkers: BiomarkerLog[], onSyncComplete: (syncedFoods: FoodLog[], syncedBiomarkers: BiomarkerLog[]) => void) {
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

    // Merge with local unsynced edits that haven't been pushed yet, if any.
    // For simplicity, we assume pullFromServer happens after pushing local changes,
    // so we can just use the server state for synced items and keep local unsynced items.
    
    const finalFoods = [...localFoods.filter(f => f.sync_state !== 'synced')];
    serverFoods.forEach(sf => {
      if (!finalFoods.find(f => f.id === sf.id)) {
        finalFoods.push(sf);
      }
    });

    const finalBiomarkers = [...localBiomarkers.filter(b => b.sync_state !== 'synced')];
    serverBiomarkers.forEach(sb => {
      if (!finalBiomarkers.find(b => b.id === sb.id)) {
        finalBiomarkers.push(sb);
      }
    });

    onSyncComplete(finalFoods, finalBiomarkers);
  }
}
