import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';

const serviceAccount = JSON.parse(fs.readFileSync(process.env.FIREBASE_ADMIN_CREDENTIALS || '', 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function run() {
  const usersRef = db.collection('users');
  const userQuery = await usersRef.where('email', '==', 'Cwah.Liu@gmail.com').get();
  
  if (userQuery.empty) {
    console.log("No user found");
    return;
  }
  
  const userId = userQuery.docs[0].id;
  console.log("User ID:", userId);
  
  const doc = await db.collection('users').doc(userId).get();
  const data = doc.data();
  
  if (!data?.foodLogs) {
    console.log("No food logs");
    return;
  }
  
  const foodLogs = data.foodLogs;
  const targetMeal = foodLogs.find((f: any) => f.name && f.name.toLowerCase().includes('rolled oat'));
  
  console.log(JSON.stringify(targetMeal, null, 2));
}

run().catch(console.error);
