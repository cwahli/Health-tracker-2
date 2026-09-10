import 'dotenv/config';
import { db } from '../src/firebase.js';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import {
  d1UpsertProfile,
  d1UpsertFoods,
  d1UpsertBiomarkers,
  D1FoodRow,
  D1BiomarkerRow
} from '../server_db_d1.js';

function normalizeToISOYMD(dateStr: any): string {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 10);
}

async function migrateAll() {
  console.log('=== Starting full Firebase to Cloudflare D1 Migration ===');
  const uid = 'hiJun2hTdDTk2igwerun2LKvwb42';

  // 1. Profile Migration
  console.log('\n1. Fetching Profile from Firestore...');
  const userDocSnap = await getDoc(doc(db, 'users', uid));
  if (!userDocSnap.exists()) {
    console.error('User doc not found in Firestore!');
    process.exit(1);
  }

  const rawUser = userDocSnap.data();
  console.log(`Found user: ${rawUser.nickname} (${rawUser.email || 'cwah.liu@gmail.com'})`);

  const profilePayload = {
    profile: {
      ...rawUser,
      nickname: rawUser.nickname || 'C. Liu',
      email: rawUser.email || 'cwah.liu@gmail.com',
      userType: rawUser.userType || 'Admin'
    },
    actions: rawUser.actions || [],
    dailyBenefits: rawUser.dailyBenefits || [],
    report: {
      dailyNutrientTargets: rawUser.dailyNutrientTargets || rawUser.targets || {},
      weeklyNutrientTargets: rawUser.weeklyNutrientTargets || {},
      topWeeklyNutrientTargets: rawUser.topWeeklyNutrientTargets || {},
      generalNutrientTargets: rawUser.generalNutrientTargets || {}
    }
  };

  const targetUids = [
    uid,
    'cwah.liu@gmail.com',
    'chiwah.liu@gmail.com',
    'admin_cwah_liu_gmail_com',
    'admin_chiwah_liu_gmail_com'
  ];

  for (const u of targetUids) {
    const res = await d1UpsertProfile(u, profilePayload);
    console.log(`Upserted profile for ${u}: ${res.success ? 'OK' : res.error}`);
  }

  // 2. Fetch Consolidated Logs
  console.log('\n2. Fetching Consolidated Logs from Firestore...');
  const logsSnap = await getDocs(collection(db, 'users', uid, 'consolidated_logs'));
  console.log(`Fetched ${logsSnap.size} bucket documents.`);

  const rawFoods: any[] = [];
  const rawBiomarkers: any[] = [];

  logsSnap.forEach(snap => {
    const data = snap.data();
    if (data && data.logs) {
      Object.values(data.logs).forEach((logInfo: any) => {
        if (!logInfo || !logInfo.data) return;
        if (logInfo.type === 'food') {
          rawFoods.push(logInfo.data);
        } else if (logInfo.type === 'biomarker') {
          rawBiomarkers.push(logInfo.data);
        }
      });
    }
  });

  console.log(`Extracted ${rawFoods.length} food logs and ${rawBiomarkers.length} biomarker logs.`);

  // 3. Map & Upsert Food Logs
  const foodRows: D1FoodRow[] = rawFoods.map((f: any) => ({
    id: String(f.id),
    firebase_uid: uid,
    date: normalizeToISOYMD(f.date),
    name: f.name || '',
    composition: f.composition || '',
    weight_grams: typeof f.weightGrams === 'number' ? f.weightGrams : (typeof f.weight_grams === 'number' ? f.weight_grams : 0),
    quantity: f.quantity || '',
    consumed_amount: typeof f.consumedAmount === 'number' ? f.consumedAmount : (typeof f.consumed_amount === 'number' ? f.consumed_amount : 1),
    benefits: f.benefits || '',
    risks: f.risks || '',
    health_impact: f.healthImpact || f.health_impact || '',
    recommendation: f.recommendation || 'good',
    verdict: f.verdict || null,
    description: f.description || '',
    message: f.message || '',
    debug_url: f.debugUrl || f.debug_url || '',
    calories: f.calories || f.nutrients?.calories || 0,
    saturated_fat: f.saturatedFat || f.nutrients?.saturatedFat || 0,
    sodium: f.sodium || f.nutrients?.sodium || 0,
    added_sugar: f.addedSugar || f.nutrients?.addedSugar || 0,
    nutrients: f.nutrients || {},
    items_breakdown: f.itemsBreakdown || f.items_breakdown || [],
    scout_items: f.scoutItems || f.scout_items || [],
    image_urls: f.imageUrls || f.image_urls || (f.imageUrl ? [f.imageUrl] : []),
    chat_transcript: f.chatTranscript || f.chat_transcript || [],
    updated_at: f.updated_at ? (typeof f.updated_at === 'number' ? new Date(f.updated_at).toISOString() : new Date(f.updated_at).toISOString()) : new Date().toISOString()
  }));

  console.log(`\n3. Upserting ${foodRows.length} Food Logs to D1...`);
  const foodRes = await d1UpsertFoods(foodRows);
  console.log(`Food upsert result: count=${foodRes.count}, success=${foodRes.success}${foodRes.error ? ', error=' + foodRes.error : ''}`);

  // 4. Map & Upsert Biomarker Logs
  const bioRows: D1BiomarkerRow[] = rawBiomarkers.map((b: any) => ({
    id: String(b.id),
    firebase_uid: uid,
    date: normalizeToISOYMD(b.date),
    biomarkers: b.biomarkers || {},
    note: b.note || '',
    summary: b.summary || '',
    tests: b.tests || [],
    updated_at: b.updated_at ? (typeof b.updated_at === 'number' ? new Date(b.updated_at).toISOString() : new Date(b.updated_at).toISOString()) : new Date().toISOString()
  }));

  console.log(`\n4. Upserting ${bioRows.length} Biomarker Logs to D1...`);
  const bioRes = await d1UpsertBiomarkers(bioRows);
  console.log(`Biomarker upsert result: count=${bioRes.count}, success=${bioRes.success}${bioRes.error ? ', error=' + bioRes.error : ''}`);

  console.log('\n=== Migration Completed Successfully ===');
  process.exit(0);
}

migrateAll().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
