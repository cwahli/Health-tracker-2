import { doc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { BiomarkerLog, UserProfile } from '../types';

export const runCleanupMigration = async (email: string) => {
  const norm = email.toLowerCase().trim();
  const migrationKey = 'migration_july05_cleanup_done';
  if (localStorage.getItem(migrationKey) === 'true') {
    return;
  }
  
  try {
    console.log("Checking migration status in Firestore for", norm);
    const profileRef = doc(db, 'users', norm);
    const profileSnap = await getDoc(profileRef);
    let isAlreadyDone = false;
    
    if (profileSnap.exists()) {
      const profileData = profileSnap.data() as any;
      if (profileData.migration_july05_cleanup_done === true) {
        isAlreadyDone = true;
      }
    }

    if (isAlreadyDone) {
      localStorage.setItem(migrationKey, 'true');
      console.log("Migration already completed in Firestore. Skipping.");
      return;
    }

    console.log("Running cleanup migration for", norm);
    
    // Clean history logs
    const historyRef = collection(db, 'users', norm, 'biomarkerHistory');
    const snapshot = await getDocs(historyRef);
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as BiomarkerLog;
      let madeChanges = false;
      const newBiomarkers = { ...data.biomarkers };
      
      const toDelete = [
        { key: 'basophil_count', val: 1 },
        { key: 'platelet_distribution_width', val: 5 },
        { key: 'audit_c_total_score', val: 5.5 },
        { key: 'sodium', val: 85.5 },
        { key: 'hematocrit', val: 5 },
      ];
      
      for (const t of toDelete) {
        if (newBiomarkers[t.key] === t.val) {
          delete newBiomarkers[t.key];
          madeChanges = true;
        }
      }
      
      // Also delete duplicates trapped in the US template keys
      if ('hgb' in newBiomarkers) { delete newBiomarkers['hgb']; madeChanges = true; }
      if ('wbc' in newBiomarkers) { delete newBiomarkers['wbc']; madeChanges = true; }
      if ('creatinine' in newBiomarkers) { delete newBiomarkers['creatinine']; madeChanges = true; }

      if (madeChanges) {
        await updateDoc(docSnap.ref, { biomarkers: newBiomarkers });
        console.log("Cleaned doc", docSnap.id);
      }
    }
    
    // Clean custom biomarkers and mark as done in Firestore
    if (profileSnap.exists()) {
      const profileData = profileSnap.data() as UserProfile;
      const custom = { ...(profileData.customBiomarkers || {}) };
      let profileChanges = false;
      
      const keysToRemove = ['hgb', 'wbc', 'creatinine', 'basophil_count', 'platelet_distribution_width', 'audit_c_total_score'];
      for (const k of keysToRemove) {
        if (custom[k]) {
          delete custom[k];
          profileChanges = true;
        }
      }
      
      await updateDoc(profileRef, { 
        customBiomarkers: custom,
        migration_july05_cleanup_done: true
      });
      console.log("Cleaned profile customs and set migration completed flag.");
    } else {
      // If profile doesn't exist yet, we still mark it as done in a minimal doc
      await updateDoc(profileRef, { 
        migration_july05_cleanup_done: true
      });
    }
    
    localStorage.setItem(migrationKey, 'true');
    console.log("Migration complete!");
    window.location.reload();
  } catch (error) {
    console.error("Migration failed:", error);
  }
};
