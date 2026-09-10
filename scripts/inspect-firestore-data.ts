import 'dotenv/config';
import { db } from '../src/firebase.js';
import { collection, getDocs } from 'firebase/firestore';

async function checkData() {
  const rootCollections = ['food_logs', 'foods', 'biomarker_logs', 'biomarkers', 'meals'];
  for (const col of rootCollections) {
    try {
      const snap = await getDocs(collection(db, col));
      console.log(`Root collection '${col}': ${snap.size} documents`);
      if (snap.size > 0) {
        console.log(`  Sample doc:`, snap.docs[0].id, snap.docs[0].data()?.name || snap.docs[0].data()?.date);
      }
    } catch (e: any) {
      console.log(`Root collection '${col}' error:`, e.message);
    }
  }
}

checkData().catch(console.error);
