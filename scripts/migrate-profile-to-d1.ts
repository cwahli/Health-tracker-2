import 'dotenv/config';
import { db } from '../src/firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import { d1UpsertProfile, d1GetProfile } from '../server_db_d1.js';

async function migrateProfileFromFirebase() {
  console.log('--- Checking Firebase user doc for hiJun2hTdDTk2igwerun2LKvwb42 ---');
  const snap = await getDoc(doc(db, 'users', 'hiJun2hTdDTk2igwerun2LKvwb42'));
  if (!snap.exists()) {
    console.log('Doc does not exist!');
    process.exit(1);
  }

  const rawData = snap.data();
  console.log('Firebase user doc keys:', Object.keys(rawData));
  console.log('Nickname:', rawData.nickname);
  console.log('Age:', rawData.age);
  console.log('Weight:', rawData.weight);
  console.log('Height:', rawData.height);
  console.log('Ethnicity:', rawData.ethnicity);
  console.log('Gender:', rawData.gender);

  // Package into the standard profile structure expected by Health-tracker
  // In Health-tracker, profiles.data contains { profile, actions, dailyBenefits, report }
  const profilePayload = {
    profile: {
      ...rawData,
      nickname: rawData.nickname || 'C. Liu',
      email: 'cwah.liu@gmail.com',
      userType: rawData.userType || 'Admin'
    },
    actions: rawData.actions || [],
    dailyBenefits: rawData.dailyBenefits || [],
    report: {
      dailyNutrientTargets: rawData.dailyNutrientTargets || rawData.targets || {},
      weeklyNutrientTargets: rawData.weeklyNutrientTargets || {},
      topWeeklyNutrientTargets: rawData.topWeeklyNutrientTargets || {},
      generalNutrientTargets: rawData.generalNutrientTargets || {}
    }
  };

  const targetUids = [
    'hiJun2hTdDTk2igwerun2LKvwb42',
    'cwah.liu@gmail.com',
    'chiwah.liu@gmail.com',
    'admin_cwah_liu_gmail_com',
    'admin_chiwah_liu_gmail_com'
  ];

  for (const uid of targetUids) {
    console.log(`Upserting profile into D1 for ${uid}...`);
    const res = await d1UpsertProfile(uid, profilePayload);
    console.log(`  Result for ${uid}:`, res);
  }

  console.log('Verifying D1 profile for hiJun2hTdDTk2igwerun2LKvwb42:');
  const verified = await d1GetProfile('hiJun2hTdDTk2igwerun2LKvwb42');
  console.log('Verified nickname:', verified?.data?.profile?.nickname);
  console.log('Verified age:', verified?.data?.profile?.age);
  console.log('Verified targets:', verified?.data?.profile?.targets);
  process.exit(0);
}

migrateProfileFromFirebase().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
