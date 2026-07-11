import admin from 'firebase-admin';
import { readFileSync } from 'fs';
const serviceAccount = JSON.parse(readFileSync('./firebase-adminsdk.json', 'utf-8'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
async function run() {
  const users = await db.collection('users').get();
  for (const doc of users.docs) {
    const data = doc.data();
    if (data.email === 'cwah.liu@gmail.com') {
      console.log('UID:', doc.id);
      const foodLogsV2 = await db.collection('users').doc(doc.id).collection('metadata').doc('foodLogs_v2').get();
      if (foodLogsV2.exists) {
        console.log('Food logs count:', foodLogsV2.data().logs.length);
        console.log('Last food log:', foodLogsV2.data().logs[foodLogsV2.data().logs.length - 1]);
      } else {
        console.log('foodLogs_v2 does not exist');
      }
      const bioV2 = await db.collection('users').doc(doc.id).collection('metadata').doc('biomarkers_v2').get();
      if (bioV2.exists) {
        console.log('Biomarker logs count:', bioV2.data().logs.length);
      } else {
        console.log('biomarkers_v2 does not exist');
      }
    }
  }
}
run().catch(console.error);
