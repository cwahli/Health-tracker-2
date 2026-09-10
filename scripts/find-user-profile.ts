import 'dotenv/config';
import { supabaseAdmin, isSupabaseConfigured } from '../supabaseAdmin.js';
import { db } from '../src/firebase.js';
import { doc, getDoc } from 'firebase/firestore';

async function findProfile() {
  const possibleUids = [
    'hiJun2hTdDTk2igwerun2LKvwb42',
    'cwah.liu@gmail.com',
    'chiwah.liu@gmail.com',
    'admin_cwah_liu_gmail_com',
    'admin_chiwah_liu_gmail_com'
  ];

  console.log('--- Checking Supabase for user profile ---');
  if (isSupabaseConfigured) {
    try {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .in('firebase_uid', possibleUids);
      console.log('Supabase profiles query error:', error ? error.message : 'none');
      console.log('Supabase profiles found:', data?.length || 0);
      if (data && data.length > 0) {
        console.log('Supabase profile data sample:', JSON.stringify(data[0], null, 2).slice(0, 500));
      }
    } catch (e: any) {
      console.log('Supabase error:', e.message);
    }

    try {
      const { count, error } = await supabaseAdmin
        .from('food_logs')
        .select('id', { count: 'exact', head: true })
        .in('firebase_uid', possibleUids);
      console.log('Supabase food_logs count error:', error ? error.message : 'none');
      console.log('Supabase food_logs count:', count);
    } catch (e: any) {
      console.log('Supabase food count error:', e.message);
    }
  }

  console.log('--- Checking Firebase Firestore for user profile ---');
  if (db) {
    for (const uid of possibleUids) {
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
          console.log(`Firebase user doc exists for ${uid}! Data keys:`, Object.keys(snap.data() || {}));
        }
      } catch (e: any) {
        console.log(`Firebase error for ${uid}:`, e.message);
      }
    }
  }
}

findProfile().catch(console.error);
